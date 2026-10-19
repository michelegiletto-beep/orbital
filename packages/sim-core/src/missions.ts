import { add, scale, dot, norm, cross, type Vec3 } from "./index.js";
import {
  DYNAMICS,
  acceleration,
  applyVectorImpulse,
  createWorkspace,
  defaultVehicle,
  orbitalMetrics,
  propagate,
  validateModel,
  validateVehicle,
  type ForceModel,
  type VehicleSpec,
  type Workspace,
} from "./advanced.js";
import type { Mission } from "../../library/src/index.js";

export type AdvancedMissionScenario = {
  schema: "orbital.scenario.v1";
  id: string;
  revision: number;
  clientId: string;
  title: string;
  family: "docking" | "recovery" | "deorbit";
  epoch: string;
  model: ForceModel;
  chaser: VehicleSpec;
  target: VehicleSpec;
  relativePosition: Vec3;
  relativeVelocity: Vec3;
  holdPoints: number[];
  holdTolerance: number;
  corridorAngle: number;
  capture: {
    distance: number;
    speed: number;
    angle: number;
    angularRate: number;
    collisionDistance: number;
  };
  attitude: {
    angle: number;
    angularRate: number;
    targetRate: number;
    authority: number;
  };
  budget: number;
  deorbit: { perigee: number; entryAltitude: 120; minimumDescentRate: number };
  objectives: string[];
};
export type AdvancedMissionCommand =
  | { type: "advance"; seconds: number }
  | { type: "guide"; waypoint: number }
  | { type: "impulse"; axis: 0 | 1 | 2; deltaV: number }
  | { type: "attitude" }
  | { type: "capture" }
  | { type: "deorbit"; kind: "impulse" | "finite"; thrust?: number }
  | { type: "abort" };
export type MissionJournalEntry = {
  sequence: number;
  time: number;
  command: AdvancedMissionCommand;
};
export type MissionEntry = {
  time: number;
  altitude: number;
  radialVelocity: number;
  position: Vec3;
};
export type AdvancedMissionSession = {
  schema: "orbital.mission.v1";
  scenario: AdvancedMissionScenario;
  initial: Workspace;
  workspace: Workspace;
  journal: MissionJournalEntry[];
  state: {
    checkpoint: number;
    captured: boolean;
    collision: boolean;
    aborted: boolean;
    angle: number;
    angularRate: number;
    attitudeControl: boolean;
    entry: MissionEntry | null;
    holdEvents: {
      waypoint: number;
      time: number;
      distance: number;
      speed: number;
    }[];
    minimumRange: number;
    corridorExcursions: number;
    outsideCorridor: boolean;
    deorbitBurn: boolean;
  };
  track: {
    time: number;
    position: Vec3;
    velocity: Vec3;
    distance: number;
    speed: number;
  }[];
};
const unit = (v: Vec3) => scale(v, 1 / norm(v));
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n));
const angleWrap = (n: number) => ((((n + 180) % 360) + 360) % 360) - 180;
const number = (v: unknown, min: number, max: number) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw Error(`Value must be between ${min} and ${max}`);
  return v;
};
const object = (v: unknown, keys: string[]) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw Error("Invalid scenario fields");
};
const text = (v: unknown, max: number) =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  !/[<>\u0000-\u001f]/.test(v);
const vector = (v: unknown, limit: number): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3)
    throw Error("A three dimensional vector is required");
  return v.map((n) => number(n, -limit, limit)) as Vec3;
};

export function validateAdvancedMissionScenario(
  input: unknown,
): AdvancedMissionScenario {
  object(input, [
    "schema",
    "id",
    "revision",
    "clientId",
    "title",
    "family",
    "epoch",
    "model",
    "chaser",
    "target",
    "relativePosition",
    "relativeVelocity",
    "holdPoints",
    "holdTolerance",
    "corridorAngle",
    "capture",
    "attitude",
    "budget",
    "deorbit",
    "objectives",
  ]);
  const s = input as AdvancedMissionScenario;
  if (
    s.schema !== "orbital.scenario.v1" ||
    !["docking", "recovery", "deorbit"].includes(s.family) ||
    !text(s.id, 80) ||
    !text(s.clientId, 80) ||
    !/^[-a-zA-Z0-9_]+$/.test(s.id) ||
    !/^[-a-zA-Z0-9_]+$/.test(s.clientId) ||
    !text(s.title, 90) ||
    !Number.isInteger(s.revision) ||
    s.revision < 1 ||
    s.revision > 1e9 ||
    typeof s.epoch !== "string" ||
    !Number.isFinite(Date.parse(s.epoch))
  )
    throw Error("Invalid scenario identity");
  const model = validateModel(s.model),
    chaser = validateVehicle(s.chaser),
    target = validateVehicle(s.target);
  if (chaser.id === target.id)
    throw Error("Target and chaser identifiers must differ");
  const position = vector(s.relativePosition, 50000),
    velocity = vector(s.relativeVelocity, 50);
  object(s.capture, [
    "distance",
    "speed",
    "angle",
    "angularRate",
    "collisionDistance",
  ]);
  object(s.attitude, ["angle", "angularRate", "targetRate", "authority"]);
  object(s.deorbit, ["perigee", "entryAltitude", "minimumDescentRate"]);
  number(s.capture.distance, 0.1, 20);
  number(s.capture.speed, 0.001, 0.5);
  number(s.capture.angle, 0.1, 10);
  number(s.capture.angularRate, 0.001, 1);
  number(s.capture.collisionDistance, 0.001, s.capture.distance * 0.25);
  number(s.attitude.angle, -180, 180);
  number(s.attitude.angularRate, -5, 5);
  number(s.attitude.targetRate, -5, 5);
  number(s.attitude.authority, 0.01, 1);
  number(s.budget, 0.1, 1500);
  number(s.holdTolerance, 0.01, 20);
  number(s.corridorAngle, 1, 45);
  number(s.deorbit.perigee, 40, 119);
  number(s.deorbit.minimumDescentRate, 0.01, 1000);
  if (s.deorbit.entryAltitude !== 120)
    throw Error(
      "The entry boundary is fixed at 120 km; atmospheric flight is outside this model",
    );
  if (
    !Array.isArray(s.holdPoints) ||
    s.holdPoints.length < 1 ||
    s.holdPoints.length > 8
  )
    throw Error("One to eight ordered hold points are required");
  s.holdPoints.forEach((p, i) => {
    number(p, s.capture.collisionDistance * 2, 50000);
    if (i && p >= s.holdPoints[i - 1])
      throw Error("Hold points must decrease toward the target");
  });
  if (
    s.family !== "deorbit" &&
    (s.holdPoints.at(-1)! > s.capture.distance ||
      norm(position) <= s.capture.distance ||
      s.holdPoints[0] >= norm(position))
  )
    throw Error(
      "Hold points must lie between the initial separation and capture envelope",
    );
  if (
    !Array.isArray(s.objectives) ||
    s.objectives.length !== 3 ||
    s.objectives.some((v) => !text(v, 160))
  )
    throw Error("Three learning objectives are required");
  if (s.family === "deorbit" && chaser.eccentricity !== 0)
    throw Error(
      "Deorbit scenario initialization requires a circular chaser orbit",
    );
  return structuredClone({
    ...s,
    epoch: new Date(s.epoch).toISOString(),
    model,
    chaser,
    target,
    relativePosition: position,
    relativeVelocity: velocity,
  });
}

/** Library metadata remains authoritative when a client edits the scenario settings. */
export function scenarioFromMission(
  mission: Mission & { advanced?: AdvancedMissionScenario },
): AdvancedMissionScenario {
  if (!["docking", "recovery", "deorbit"].includes(mission.family))
    throw Error("This mission family uses the orbital or inspection executor");
  const tolerance = clamp(mission.tolerance, 0.1, 20),
    range = mission.initialRange,
    final = Math.max(0.05, Math.min(0.5, tolerance * 0.5, range * 0.03));
  const initial: AdvancedMissionScenario = {
    schema: "orbital.scenario.v1",
    id: mission.id,
    revision: mission.revision,
    clientId: mission.clientId,
    title: mission.title,
    family: mission.family as AdvancedMissionScenario["family"],
    epoch: "2026-10-16T12:00:00.000Z",
    model: { gravity: "j2", drag: true, step: 0.5 },
    chaser: {
      ...defaultVehicle("chaser", "CHASER 01"),
      altitude: mission.initialAltitude,
      eccentricity: 0,
      inclination: mission.inclination,
      raan: 24,
      anomaly: 32,
    },
    target: {
      ...defaultVehicle("target", "TARGET 01"),
      altitude: mission.initialAltitude,
      eccentricity: 0,
      inclination: mission.inclination,
      raan: 24,
      anomaly: 32,
      mass: 1400,
      dryMass: 1200,
      area: 7,
      color: "#53d6bc",
    },
    relativePosition: [0, -range, 0],
    relativeVelocity: [0, 0, 0],
    holdPoints: [Math.min(250, range * 0.6), Math.min(30, range * 0.12), final],
    holdTolerance: Math.max(0.02, Math.min(0.3, tolerance * 0.1)),
    corridorAngle: 15,
    capture: {
      distance: tolerance,
      speed: mission.closingSpeed,
      angle: 3,
      angularRate: 0.1,
      collisionDistance: 0.02,
    },
    attitude: {
      angle: mission.family === "recovery" ? 25 : 0,
      angularRate: 0,
      targetRate: mission.family === "recovery" ? 0.8 : 0,
      authority: 0.25,
    },
    budget: mission.budget,
    deorbit: {
      perigee: clamp(mission.targetAltitude, 40, 119),
      entryAltitude: 120,
      minimumDescentRate: 1,
    },
    objectives: [...mission.objectives],
  };
  // Advanced snapshots are settings. Identity and objective changes always come from the library record.
  const merged = {
    ...initial,
    ...mission.advanced,
    schema: initial.schema,
    id: mission.id,
    revision: mission.revision,
    clientId: mission.clientId,
    title: mission.title,
    family: initial.family,
    objectives: [...mission.objectives],
  };
  return validateAdvancedMissionScenario(merged);
}

function frame(w: Workspace, s: AdvancedMissionScenario) {
  const t = w.vehicles.find((v) => v.spec.id === s.target.id)!;
  const r = t.state.position,
    v = t.state.velocity,
    a = acceleration(t.state, t.spec, w.model),
    h = cross(r, v);
  const R = unit(r),
    N = unit(h),
    T = cross(N, R),
    Rdot = scale(add(v, scale(R, -dot(R, v))), 1 / norm(r));
  const hdot = cross(r, a),
    Ndot = scale(add(hdot, scale(N, -dot(N, hdot))), 1 / norm(h));
  const Tdot = add(cross(Ndot, R), cross(N, Rdot));
  const omega: Vec3 = [dot(N, Tdot), dot(R, Ndot), dot(T, Rdot)];
  const toInertial = (x: Vec3): Vec3 =>
    add(add(scale(R, x[0]), scale(T, x[1])), scale(N, x[2]));
  const toRelative = (x: Vec3): Vec3 => [dot(x, R), dot(x, T), dot(x, N)];
  return { target: t, R, T, N, omega, toInertial, toRelative };
}
export function measureAdvancedMission(session: AdvancedMissionSession) {
  const f = frame(session.workspace, session.scenario),
    c = session.workspace.vehicles.find(
      (v) => v.spec.id === session.scenario.chaser.id,
    )!;
  const position = f.toRelative(
    scale(add(c.state.position, scale(f.target.state.position, -1)), 1000),
  );
  const velocity = add(
    f.toRelative(
      scale(add(c.state.velocity, scale(f.target.state.velocity, -1)), 1000),
    ),
    scale(cross(f.omega, position), -1),
  );
  const distance = norm(position),
    speed = norm(velocity);
  const lateralOffset = Math.hypot(position[0], position[2]),
    corridorLimit = Math.max(
      session.scenario.holdTolerance,
      Math.max(0, -position[1]) *
        Math.tan((session.scenario.corridorAngle * Math.PI) / 180),
    ),
    withinCorridor = position[1] < 0 && lateralOffset <= corridorLimit;
  const limits = session.scenario.capture;
  const captureReady =
    session.scenario.family !== "deorbit" &&
    !session.state.collision &&
    !session.state.aborted &&
    session.state.checkpoint >= session.scenario.holdPoints.length &&
    distance <= limits.distance &&
    distance >= limits.collisionDistance &&
    speed <= limits.speed &&
    Math.abs(session.state.angle) <= limits.angle &&
    Math.abs(session.state.angularRate) <= limits.angularRate &&
    withinCorridor;
  return {
    position,
    velocity,
    distance,
    speed,
    lateralOffset,
    corridorLimit,
    withinCorridor,
    captureReady,
    closingSpeed: distance > 1e-12 ? -dot(position, velocity) / distance : 0,
    angle: session.state.angle,
    angularRate: session.state.angularRate,
    deltaV: c.state.deltaV,
    mass: c.state.mass,
    time: session.workspace.time,
    altitude: orbitalMetrics(c.state).altitude,
    perigee: orbitalMetrics(c.state).perigee,
  };
}
export function createAdvancedMission(
  input: Mission | AdvancedMissionScenario,
  overrides: Partial<AdvancedMissionScenario> = {},
): AdvancedMissionSession {
  const scenario = validateAdvancedMissionScenario({
    ...((input as AdvancedMissionScenario).schema === "orbital.scenario.v1"
      ? input
      : scenarioFromMission(input as Mission)),
    ...overrides,
  });
  const w = createWorkspace(
    [scenario.chaser, scenario.target],
    scenario.epoch,
    scenario.model,
  );
  if (scenario.family !== "deorbit") {
    const f = frame(w, scenario),
      chaser = w.vehicles[0];
    chaser.state.position = add(
      f.target.state.position,
      scale(f.toInertial(scenario.relativePosition), 0.001),
    );
    const rotatingVelocity = add(
      scenario.relativeVelocity,
      cross(f.omega, scenario.relativePosition),
    );
    chaser.state.velocity = add(
      f.target.state.velocity,
      scale(f.toInertial(rotatingVelocity), 0.001),
    );
    if (orbitalMetrics(chaser.state).altitude <= 120)
      throw Error(
        "The chaser must start above the atmospheric entry interface",
      );
  } else {
    // A reference vehicle is retained for the shared scene, on the opposite side of the orbit.
    const target = w.vehicles[1];
    target.state.position = scale(target.state.position, -1);
    target.state.velocity = scale(target.state.velocity, -1);
  }
  w.history = w.vehicles.map((v) => ({
    time: 0,
    vehicleId: v.spec.id,
    position: [...v.state.position],
    velocity: [...v.state.velocity],
    mass: v.state.mass,
    altitude: orbitalMetrics(v.state).altitude,
    deltaV: 0,
  }));
  const session: AdvancedMissionSession = {
    schema: "orbital.mission.v1",
    scenario,
    initial: structuredClone(w),
    workspace: w,
    journal: [],
    state: {
      checkpoint: 0,
      captured: false,
      collision: false,
      aborted: false,
      angle: scenario.attitude.angle,
      angularRate: scenario.attitude.angularRate - scenario.attitude.targetRate,
      attitudeControl: false,
      entry: null,
      holdEvents: [],
      minimumRange: Infinity,
      corridorExcursions: 0,
      outsideCorridor: false,
      deorbitBurn: false,
    },
    track: [],
  };
  const m = measureAdvancedMission(session);
  session.state.minimumRange = m.distance;
  session.track.push({
    time: 0,
    position: m.position,
    velocity: m.velocity,
    distance: m.distance,
    speed: m.speed,
  });
  return session;
}

export function parseAdvancedMissionCommand(
  input: unknown,
): AdvancedMissionCommand {
  const c = input as AdvancedMissionCommand;
  if (!c || typeof c !== "object")
    throw Error("Invalid advanced mission command");
  if (c.type === "advance") {
    object(c, ["type", "seconds"]);
    number(c.seconds, 0.5, 10800);
    return structuredClone(c);
  }
  if (c.type === "guide") {
    object(c, ["type", "waypoint"]);
    number(c.waypoint, 0, 7);
    if (!Number.isInteger(c.waypoint))
      throw Error("Integer hold point required");
    return structuredClone(c);
  }
  if (c.type === "impulse") {
    object(c, ["type", "axis", "deltaV"]);
    if (![0, 1, 2].includes(c.axis)) throw Error("Invalid RTN axis");
    number(c.deltaV, -5, 5);
    if (!c.deltaV) throw Error("Impulse cannot be zero");
    return structuredClone(c);
  }
  if (c.type === "deorbit") {
    object(c, ["type", "kind", "thrust"]);
    if (!["finite", "impulse"].includes(c.kind))
      throw Error("Invalid deorbit burn");
    if (c.thrust !== undefined) number(c.thrust, 10, 20000);
    return structuredClone(c);
  }
  if (["attitude", "capture", "abort"].includes(c.type)) {
    object(c, ["type"]);
    return structuredClone(c);
  }
  throw Error("Unknown advanced mission command");
}
const sampleMission = (s: AdvancedMissionSession) => {
  const m = measureAdvancedMission(s);
  if (
    !s.track.length ||
    s.workspace.time - s.track.at(-1)!.time >= 2 ||
    s.state.entry
  )
    s.track.push({
      time: m.time,
      position: m.position,
      velocity: m.velocity,
      distance: m.distance,
      speed: m.speed,
    });
  if (s.track.length > 3000)
    s.track = [
      ...s.track.slice(0, -1500).filter((_, i) => i % 2 === 0),
      ...s.track.slice(-1500),
    ];
  const recent = s.workspace.history.at(-1)?.time ?? -30;
  if (s.workspace.time - recent >= 30 || s.state.entry) {
    for (const v of s.workspace.vehicles)
      s.workspace.history.push({
        time: s.workspace.time,
        vehicleId: v.spec.id,
        position: [...v.state.position],
        velocity: [...v.state.velocity],
        mass: v.state.mass,
        altitude: orbitalMetrics(v.state).altitude,
        deltaV: v.state.deltaV,
      });
    if (s.workspace.history.length > 2048)
      s.workspace.history = [
        ...s.workspace.history
          .slice(0, -1024)
          .filter((_, i) => Math.floor(i / 2) % 2 === 0),
        ...s.workspace.history.slice(-1024),
      ];
  }
};
function advanceStep(
  s: AdvancedMissionSession,
  seconds: number,
  thrust?: Vec3,
) {
  const before = measureAdvancedMission(s),
    oldTime = s.workspace.time;
  s.workspace = propagate(
    s.workspace,
    seconds,
    false,
    thrust ? [{ vehicleId: s.scenario.chaser.id, thrust }] : [],
    s.scenario.family === "deorbit",
  );
  const dt = s.workspace.time - oldTime;
  if (s.state.attitudeControl) {
    // Bounded one axis tracking of a passively rotating target. No target torque is applied.
    const acc = clamp(
      -0.06 * s.state.angle - 0.55 * s.state.angularRate,
      -s.scenario.attitude.authority,
      s.scenario.attitude.authority,
    );
    s.state.angle = angleWrap(
      s.state.angle + s.state.angularRate * dt + 0.5 * acc * dt * dt,
    );
    s.state.angularRate += acc * dt;
  } else s.state.angle = angleWrap(s.state.angle + s.state.angularRate * dt);
  const after = measureAdvancedMission(s),
    segment = add(after.position, scale(before.position, -1)),
    den = dot(segment, segment);
  const nearest = add(
    before.position,
    scale(segment, den ? clamp(-dot(before.position, segment) / den, 0, 1) : 0),
  );
  s.state.minimumRange = Math.min(s.state.minimumRange, norm(nearest));
  if (s.scenario.family !== "deorbit") {
    if (norm(nearest) < s.scenario.capture.collisionDistance)
      s.state.collision = true;
    if (!after.withinCorridor && !s.state.outsideCorridor)
      s.state.corridorExcursions++;
    s.state.outsideCorridor = !after.withinCorridor;
  }
  const c = s.workspace.vehicles.find(
    (v) => v.spec.id === s.scenario.chaser.id,
  )!;
  if (c.state.entered && !s.state.entry)
    s.state.entry = {
      time:
        s.workspace.events.find(
          (e) => e.type === "entry" && e.vehicleId === c.spec.id,
        )?.time ?? s.workspace.time,
      altitude: orbitalMetrics(c.state).altitude,
      radialVelocity:
        (1000 * dot(c.state.position, c.state.velocity)) /
        norm(c.state.position),
      position: [...c.state.position],
    };
  sampleMission(s);
}
function advanceMission(s: AdvancedMissionSession, seconds: number) {
  const end = s.workspace.time + seconds;
  if (end > 86400) throw Error("Mission horizon is 24 hours");
  while (
    s.workspace.time < end - 1e-8 &&
    !s.state.collision &&
    !s.state.entry
  ) {
    const dt = Math.min(0.5, end - s.workspace.time);
    advanceStep(s, dt);
  }
}
function checkBudget(s: AdvancedMissionSession, amount: number) {
  const c = s.workspace.vehicles.find(
    (v) => v.spec.id === s.scenario.chaser.id,
  )!;
  if (c.state.deltaV + amount > s.scenario.budget + 1e-7)
    throw Error("Mission delta V budget would be exceeded");
  if (
    c.state.mass * Math.exp(-amount / (c.spec.isp * DYNAMICS.g0)) <
    c.spec.dryMass
  )
    throw Error("Insufficient mission propellant");
}

function guide(s: AdvancedMissionSession, waypoint: number) {
  if (
    s.scenario.family === "deorbit" ||
    waypoint >= s.scenario.holdPoints.length ||
    waypoint > s.state.checkpoint
  )
    throw Error("Reach hold points in their configured order");
  const goal: Vec3 = [0, -s.scenario.holdPoints[waypoint], 0],
    end = Math.min(86400, s.workspace.time + 5400);
  const tolerance = Math.min(
    s.scenario.holdTolerance,
    s.scenario.capture.distance * 0.15,
  );
  const terminalSpeed = Math.min(0.015, s.scenario.capture.speed * 0.4);
  let stable = 0;
  while (s.workspace.time < end && !s.state.collision) {
    const m = measureAdvancedMission(s),
      error = add(goal, scale(m.position, -1)),
      distance = norm(error);
    if (distance <= tolerance && m.speed <= terminalSpeed) stable += 0.5;
    else stable = 0;
    if (stable >= 3) {
      if (waypoint === s.state.checkpoint) {
        s.state.checkpoint++;
        s.state.holdEvents.push({
          waypoint,
          time: m.time,
          distance: m.distance,
          speed: m.speed,
        });
      }
      sampleMission(s);
      return;
    }
    const c = s.workspace.vehicles.find(
        (v) => v.spec.id === s.scenario.chaser.id,
      )!,
      f = frame(s.workspace, s.scenario);
    const maxSpeed = Math.min(
      2,
      Math.sqrt(Math.max(0, distance) * 0.035),
      distance * 0.08,
    );
    const desiredVelocity = distance
      ? scale(error, maxSpeed / distance)
      : ([0, 0, 0] as Vec3);
    const relativeAcceleration = scale(
      add(desiredVelocity, scale(m.velocity, -1)),
      0.45,
    );
    const targetAcceleration = acceleration(
        f.target.state,
        f.target.spec,
        s.workspace.model,
      ),
      chaserAcceleration = acceleration(c.state, c.spec, s.workspace.model);
    // Different gravitational/drag accelerations are evaluated at the actual ECI states.
    // Centripetal and Coriolis frame terms are kinematic; no linearized orbital force model is used.
    const feedforward = add(
      scale(add(targetAcceleration, scale(chaserAcceleration, -1)), 1000),
      f.toInertial(
        add(
          scale(cross(f.omega, m.velocity), 2),
          cross(f.omega, cross(f.omega, m.position)),
        ),
      ),
    );
    let required = add(f.toInertial(relativeAcceleration), feedforward);
    if (norm(required) > 0.08)
      required = scale(required, 0.08 / norm(required));
    const remaining = s.scenario.budget - c.state.deltaV;
    if (remaining <= 1e-7) break;
    let thrust = scale(required, c.state.mass);
    // A half second finite thrust interval is capped by remaining rocket equation delta V.
    const allowedMass =
      c.state.mass * (1 - Math.exp(-remaining / (c.spec.isp * DYNAMICS.g0)));
    const maxForce = Math.min(
      50000,
      (allowedMass * c.spec.isp * DYNAMICS.g0) / 0.5,
      ((c.state.mass - c.spec.dryMass) * c.spec.isp * DYNAMICS.g0) / 0.5,
    );
    if (norm(thrust) > maxForce)
      thrust = scale(thrust, maxForce / norm(thrust));
    if (norm(thrust) < 1e-9) break;
    advanceStep(s, 0.5, thrust);
  }
  // A timed out approach remains observable and resumable instead of claiming a hold was reached.
  sampleMission(s);
}
function deorbit(
  s: AdvancedMissionSession,
  command: Extract<AdvancedMissionCommand, { type: "deorbit" }>,
) {
  if (s.scenario.family !== "deorbit" || s.state.deorbitBurn)
    throw Error("Deorbit maneuver unavailable");
  const c = s.workspace.vehicles.find(
      (v) => v.spec.id === s.scenario.chaser.id,
    )!,
    r = norm(c.state.position),
    rp = DYNAMICS.radius + s.scenario.deorbit.perigee;
  const targetSpeed = Math.sqrt(DYNAMICS.mu * (2 / r - 2 / (r + rp))),
    speed = norm(c.state.velocity),
    dv = Math.max(0, (speed - targetSpeed) * 1000);
  if (dv < 0.01)
    throw Error("The current state already meets the requested perigee");
  checkBudget(s, dv);
  if (command.kind === "impulse") {
    s.workspace = applyVectorImpulse(
      s.workspace,
      c.spec.id,
      scale(unit(c.state.velocity), -dv),
    );
    s.state.deorbitBurn = true;
  } else {
    const thrust = command.thrust ?? 800,
      fuel = c.state.mass * (1 - Math.exp(-dv / (c.spec.isp * DYNAMICS.g0))),
      duration = (fuel * c.spec.isp * DYNAMICS.g0) / thrust;
    if (duration > 3600)
      throw Error(
        "Choose a higher thrust for a deorbit burn shorter than one hour",
      );
    // A finite burn is executed continuously, stopping at the requested osculating perigee.
    const end = Math.min(
      86400,
      s.workspace.time + Math.min(3600, duration * 1.5 + 30),
    );
    while (s.workspace.time < end && !s.state.entry) {
      const current = s.workspace.vehicles.find(
        (v) => v.spec.id === s.scenario.chaser.id,
      )!;
      if (orbitalMetrics(current.state).perigee <= s.scenario.deorbit.perigee)
        break;
      const remaining = s.scenario.budget - current.state.deltaV;
      if (remaining <= 0.000001) break;
      const allowedMass =
        current.state.mass *
        (1 - Math.exp(-remaining / (current.spec.isp * DYNAMICS.g0)));
      const force = Math.min(
        thrust,
        (allowedMass * current.spec.isp * DYNAMICS.g0) / 0.5,
        ((current.state.mass - current.spec.dryMass) *
          current.spec.isp *
          DYNAMICS.g0) /
          0.5,
      );
      if (force <= 0) break;
      advanceStep(s, 0.5, scale(unit(current.state.velocity), -force));
    }
    s.state.deorbitBurn = true;
  }
  sampleMission(s);
}
export function advancedMissionCommand(
  session: AdvancedMissionSession,
  input: unknown,
): AdvancedMissionSession {
  const command = parseAdvancedMissionCommand(input);
  if (session.schema !== "orbital.mission.v1" || session.journal.length >= 2000)
    throw Error("Mission command limit reached");
  if (
    session.state.collision ||
    session.state.captured ||
    session.state.aborted ||
    session.state.entry
  )
    throw Error("Mission has terminated");
  if (session.workspace.time >= 86400)
    throw Error("Mission horizon is 24 hours");
  const s = structuredClone(session);
  if (command.type === "advance") {
    if (s.workspace.time + command.seconds > 86400)
      throw Error("Mission horizon is 24 hours");
    advanceMission(s, command.seconds);
  } else if (command.type === "guide") guide(s, command.waypoint);
  else if (command.type === "impulse") {
    checkBudget(s, Math.abs(command.deltaV));
    const f = frame(s.workspace, s.scenario),
      v: Vec3 = [0, 0, 0];
    v[command.axis] = command.deltaV;
    s.workspace = applyVectorImpulse(
      s.workspace,
      s.scenario.chaser.id,
      f.toInertial(v),
    );
    sampleMission(s);
  } else if (command.type === "attitude") {
    if (s.scenario.family === "deorbit")
      throw Error("Target attitude synchronization is a proximity operation");
    s.state.attitudeControl = true;
    advanceMission(s, 60);
  } else if (command.type === "capture") {
    const m = measureAdvancedMission(s);
    if (!m.captureReady)
      throw Error(
        "Capture denied. Reach every hold point and satisfy separation, speed, attitude and rotation limits",
      );
    s.state.captured = true;
  } else if (command.type === "deorbit") deorbit(s, command);
  else if (command.type === "abort") s.state.aborted = true;
  s.journal.push({
    sequence: s.journal.length,
    time: session.workspace.time,
    command,
  });
  const m = measureAdvancedMission(s);
  if (s.track.at(-1)?.time !== m.time)
    s.track.push({
      time: m.time,
      position: m.position,
      velocity: m.velocity,
      distance: m.distance,
      speed: m.speed,
    });
  return s;
}
export function advancedMissionReport(session: AdvancedMissionSession) {
  const m = measureAdvancedMission(session),
    s = session.state,
    scenario = session.scenario;
  const achievements =
    scenario.family === "deorbit"
      ? [
          s.deorbitBurn,
          m.perigee < 120,
          !!s.entry &&
            s.entry.radialVelocity <= -scenario.deorbit.minimumDescentRate,
        ]
      : [
          s.checkpoint >= 1 &&
            (scenario.family !== "docking" || s.corridorExcursions === 0),
          s.checkpoint >= scenario.holdPoints.length &&
            m.speed <= scenario.capture.speed &&
            (scenario.family !== "recovery" ||
              (Math.abs(m.angle) <= scenario.capture.angle &&
                Math.abs(m.angularRate) <= scenario.capture.angularRate)),
          s.captured,
        ];
  const complete =
    achievements.every(Boolean) &&
    !s.collision &&
    !s.aborted &&
    m.deltaV <= scenario.budget + 1e-6;
  return {
    complete,
    score: Math.round((achievements.filter(Boolean).length / 3) * 100),
    status: complete
      ? "complete"
      : s.captured
        ? "captured with deviations"
        : s.collision
          ? "collision"
          : s.aborted
            ? "aborted"
            : s.entry
              ? "entry reached"
              : "in progress",
    objectives: scenario.objectives.map((title, i) => ({
      id: `ADV${i + 1}`,
      title,
      achieved: achievements[i],
    })),
    metrics: {
      ...m,
      minimumRange: s.minimumRange,
      corridorExcursions: s.corridorExcursions,
      propellantUsed: scenario.chaser.mass - m.mass,
      checkpoint: s.checkpoint,
    },
    entry: s.entry,
    holdEvents: structuredClone(s.holdEvents),
    recommendation: complete
      ? "Objectives achieved. Review the command journal and measured safety margins."
      : s.captured
        ? "Capture completed, but the approach corridor objective was not achieved. Review the recorded excursions."
        : s.collision
          ? "Uncontrolled contact detected. Review approach speed and lateral drift."
          : s.aborted
            ? "Mission aborted by the operator."
            : scenario.budget - m.deltaV < 0.001
              ? "The mission delta V budget is exhausted. Review the approach and propulsion allocation."
              : scenario.family === "deorbit"
                ? s.entry
                  ? "Entry was reached outside the configured descent requirement."
                  : s.deorbitBurn
                    ? "Coast to the descending 120 km interface."
                    : "Execute a retrograde burn and verify the resulting perigee."
                : s.checkpoint < scenario.holdPoints.length
                  ? "Reach the next ordered hold point and stabilize relative motion."
                  : Math.abs(m.angle) > scenario.capture.angle ||
                      Math.abs(m.angularRate) > scenario.capture.angularRate
                    ? "Synchronize chaser roll with the passive target before capture."
                    : "Verify capture limits and command soft capture.",
    model: {
      translation:
        "Nonlinear ECI RK4 with configured J2 and co rotating engineering drag; inertial finite thrust and rocket equation mass accounting",
      attitude:
        "Bounded single axis roll tracking; no six degree of freedom contact dynamics",
      boundary:
        "Propagation terminates at the descending 120 km interface; no atmospheric entry or ground impact model",
    },
  };
}
export function replayAdvancedMission(
  scenario: AdvancedMissionScenario,
  journal: MissionJournalEntry[],
  through = journal.length,
): AdvancedMissionSession {
  if (
    !Array.isArray(journal) ||
    journal.length > 2000 ||
    !Number.isInteger(through) ||
    through < 0 ||
    through > journal.length
  )
    throw Error("Invalid mission journal");
  let s = createAdvancedMission(scenario),
    cost = 0;
  for (let i = 0; i < through; i++) {
    const e = journal[i];
    object(e, ["sequence", "time", "command"]);
    if (e.sequence !== i || e.time !== s.workspace.time)
      throw Error("Mission journal order or timestamp mismatch");
    const command = parseAdvancedMissionCommand(e.command);
    const before = s.workspace.time;
    s = advancedMissionCommand(s, command);
    cost += 2 * (s.workspace.time - before) + 1;
    if (cost > 400000) throw Error("Mission replay computation limit exceeded");
  }
  return s;
}
