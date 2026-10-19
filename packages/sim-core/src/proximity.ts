import { MODEL, add, scale, norm, type Vec3 } from "./index.js";
import type { Mission } from "../../library/src/index.js";
export type RelativeState = {
  position: Vec3;
  velocity: Vec3;
  time: number;
  spent: number;
  mass: number;
  angle: number;
  angularRate: number;
  attitudeControl: boolean;
  captured: boolean;
  collision: boolean;
  observations: number;
  checkpoint: number;
};
export type RelativeCommand =
  | { type: "advance"; seconds: number }
  | { type: "thrust"; axis: 0 | 1 | 2; deltaV: number }
  | { type: "guide"; waypoint: number }
  | { type: "attitude" }
  | { type: "capture" }
  | { type: "observe" };
export type RelativeSession = {
  mission: Mission;
  initial: RelativeState;
  state: RelativeState;
  events: { sequence: number; time: number; command: RelativeCommand }[];
  track: Vec3[];
};
export function parseRelativeCommand(input: unknown): RelativeCommand {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Invalid relative command");
  const c = input as Record<string, unknown>,
    keys = Object.keys(c);
  if (
    c.type === "advance" &&
    keys.length === 2 &&
    typeof c.seconds === "number" &&
    Number.isInteger(c.seconds) &&
    c.seconds >= 1 &&
    c.seconds <= 3600
  )
    return { type: "advance", seconds: c.seconds };
  if (
    c.type === "thrust" &&
    keys.length === 3 &&
    [0, 1, 2].includes(c.axis as number) &&
    typeof c.deltaV === "number" &&
    Number.isFinite(c.deltaV) &&
    Math.abs(c.deltaV) <= 0.5 &&
    c.deltaV !== 0
  )
    return { type: "thrust", axis: c.axis as 0 | 1 | 2, deltaV: c.deltaV };
  if (
    c.type === "guide" &&
    keys.length === 2 &&
    typeof c.waypoint === "number" &&
    Number.isInteger(c.waypoint) &&
    c.waypoint >= 0 &&
    c.waypoint <= 2
  )
    return { type: "guide", waypoint: c.waypoint };
  if (
    keys.length === 1 &&
    ["attitude", "capture", "observe"].includes(c.type as string)
  )
    return { type: c.type as "attitude" | "capture" | "observe" };
  throw Error("Invalid relative command");
}
export function relativeSession(mission: Mission): RelativeSession {
  const initial: RelativeState = {
    position: [0, -mission.initialRange, 0],
    velocity: [0, 0, 0],
    time: 0,
    spent: 0,
    mass: 1000,
    angle: mission.family === "recovery" ? 25 : 0,
    angularRate: mission.family === "recovery" ? 0.8 : 0,
    attitudeControl: false,
    captured: false,
    collision: false,
    observations: 0,
    checkpoint: 0,
  };
  return {
    mission: structuredClone(mission),
    initial: structuredClone(initial),
    state: initial,
    events: [],
    track: [[...initial.position]],
  };
}
const angular = (altitude: number) =>
  Math.sqrt(MODEL.mu / (MODEL.radius + altitude) ** 3);
function derivative(position: Vec3, velocity: Vec3, n: number): Vec3 {
  return [
    3 * n * n * position[0] + 2 * n * velocity[1],
    -2 * n * velocity[0],
    -n * n * position[2],
  ];
}
export function relativeStep(
  state: RelativeState,
  altitude: number,
  dt = 0.25,
): RelativeState {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 1)
    throw Error("Invalid relative integration step");
  if (state.captured || state.collision) return structuredClone(state);
  const n = angular(altitude),
    p1 = state.velocity,
    v1 = derivative(state.position, state.velocity, n);
  const p2 = add(state.velocity, scale(v1, dt / 2)),
    v2 = derivative(add(state.position, scale(p1, dt / 2)), p2, n);
  const p3 = add(state.velocity, scale(v2, dt / 2)),
    v3 = derivative(add(state.position, scale(p2, dt / 2)), p3, n);
  const p4 = add(state.velocity, scale(v3, dt)),
    v4 = derivative(add(state.position, scale(p3, dt)), p4, n);
  const sum = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) =>
    scale(add(add(a, scale(b, 2)), add(scale(c, 2), d)), dt / 6);
  const position = add(state.position, sum(p1, p2, p3, p4)),
    velocity = add(state.velocity, sum(v1, v2, v3, v4));
  const angularAcceleration = state.attitudeControl
    ? Math.max(
        -0.25,
        Math.min(0.25, -0.05 * state.angle - 0.5 * state.angularRate),
      )
    : 0;
  const angularRate = state.angularRate + angularAcceleration * dt;
  const angle =
    ((((state.angle + angularRate * dt + 180) % 360) + 360) % 360) - 180;
  return {
    ...state,
    position,
    velocity,
    time: state.time + dt,
    angle,
    angularRate,
    collision: norm(position) < 0.02,
  };
}
const burn = (
  s: RelativeState,
  impulse: Vec3,
  budget: number,
): RelativeState => {
  const amount = norm(impulse);
  if (!Number.isFinite(amount) || amount > 1)
    throw Error("Invalid relative burn");
  if (s.spent + amount > budget) throw Error("Delta V budget exhausted.");
  const mass = s.mass * Math.exp(-amount / (MODEL.isp * MODEL.g0));
  if (mass < MODEL.dryMass) throw Error("Insufficient propellant.");
  return {
    ...s,
    velocity: add(s.velocity, impulse),
    spent: s.spent + amount,
    mass,
  };
};
export function waypoints(mission: Mission): Vec3[] {
  if (mission.family === "inspection") {
    const r = mission.initialRange;
    return [
      [r, 0, 0],
      [0, r, 0],
      [-r, 0, 0],
    ];
  }
  if (mission.family === "avoidance")
    return [[0, -Math.max(1000, mission.initialRange * 5), 0]];
  return [
    [0, -Math.min(250, mission.initialRange * 0.6), 0],
    [0, -Math.min(30, mission.initialRange * 0.12), 0],
    [0, -Math.min(0.5, mission.tolerance * 0.5), 0],
  ];
}
export function relativeExecute(
  session: RelativeSession,
  command: RelativeCommand,
): RelativeSession {
  if (session.events.length >= 10000)
    throw Error("Command limit reached.");
  let s = structuredClone(session.state);
  const { mission } = session,
    track = session.track.map((p) => [...p] as Vec3);
  if (s.collision || s.captured) throw Error("Mission terminated.");
  const advance = (seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) {
      s = relativeStep(s, mission.initialAltitude);
      if (i % 16 === 0 && track.length < 5000) track.push([...s.position]);
      if (s.collision) break;
    }
  };
  if (command.type === "thrust") {
    if (
      ![0, 1, 2].includes(command.axis) ||
      !Number.isFinite(command.deltaV) ||
      Math.abs(command.deltaV) > 0.5 ||
      command.deltaV === 0
    )
      throw Error("Invalid relative impulse.");
    const impulse: Vec3 = [0, 0, 0];
    impulse[command.axis] = command.deltaV;
    s = burn(s, impulse, mission.budget);
  } else if (command.type === "advance") {
    if (
      !Number.isInteger(command.seconds) ||
      command.seconds < 1 ||
      command.seconds > 3600
    )
      throw Error("Invalid duration.");
    advance(command.seconds);
  } else if (command.type === "attitude") {
    s.attitudeControl = true;
    advance(60);
  } else if (command.type === "guide") {
    if (
      !Number.isInteger(command.waypoint) ||
      command.waypoint < 0 ||
      command.waypoint >= waypoints(mission).length ||
      command.waypoint > s.checkpoint
    )
      throw Error("Hold point unavailable.");
    const target = waypoints(mission)[command.waypoint];
    for (let i = 0; i < 3600; i++) {
      const error = add(target, scale(s.position, -1)),
        distance = norm(error);
      if (
        distance < Math.max(0.03, mission.tolerance * 0.05) &&
        norm(s.velocity) < 0.02
      )
        break;
      const maxSpeed =
        mission.family === "avoidance"
          ? 2
          : distance > 100
            ? 2
            : distance > 10
              ? 0.5
              : 0.04;
      const desired = scale(
        error,
        Math.min(0.03, maxSpeed / Math.max(0.00001, distance)),
      );
      const acceleration = scale(add(desired, scale(s.velocity, -1)), 0.55),
        amount = norm(acceleration);
      const compensation = scale(
        derivative(s.position, s.velocity, angular(mission.initialAltitude)),
        -1,
      );
      let impulse = add(acceleration, compensation);
      if (norm(impulse) > 0.2) impulse = scale(impulse, 0.2 / norm(impulse));
      s = burn(s, impulse, mission.budget);
      advance(1);
      if (s.collision) break;
    }
    if (
      norm(add(target, scale(s.position, -1))) >
      Math.max(0.5, mission.tolerance)
    )
      throw Error("Hold point not reached.");
    s.checkpoint = Math.max(s.checkpoint, command.waypoint + 1);
  } else if (command.type === "capture") {
    if (
      norm(s.position) > mission.tolerance ||
      norm(s.velocity) > mission.closingSpeed ||
      Math.abs(s.angle) > 3 ||
      Math.abs(s.angularRate) > 0.1
    )
      throw Error("Capture denied. Check separation, velocity and attitude.");
    s.captured = true;
    s.velocity = [0, 0, 0];
  } else if (command.type === "observe") {
    if (
      mission.family !== "inspection" ||
      s.checkpoint !== s.observations + 1 ||
      norm(s.velocity) > 0.05
    )
      throw Error("Stabilize the spacecraft at the next observation point.");
    s.observations++;
  } else throw Error("Invalid command.");
  return {
    ...session,
    state: s,
    track,
    events: [
      ...session.events,
      {
        sequence: session.events.length,
        time: session.state.time,
        command: structuredClone(command),
      },
    ],
  };
}
export function relativeReport(session: RelativeSession) {
  const { state: s, mission: m } = session;
  const distance = norm(s.position),
    speed = norm(s.velocity);
  const achievements =
    m.family === "inspection"
      ? [s.observations >= 1, s.observations >= 2, s.observations >= 3]
      : m.family === "avoidance"
        ? [
            s.spent > 0,
            distance >= Math.max(999, m.initialRange * 5 - 1),
            distance >= Math.max(999, m.initialRange * 5 - 1) &&
              s.spent <= m.budget,
          ]
        : [
            s.checkpoint >= 1,
            s.checkpoint >= 3 && speed <= m.closingSpeed,
            m.family === "recovery"
              ? s.captured && Math.abs(s.angle) <= 3
              : s.captured,
          ];
  const complete = achievements.every(Boolean) && !s.collision;
  return {
    complete,
    score: Math.round((achievements.filter(Boolean).length / 3) * 100),
    objectives: m.objectives.map((title, i) => ({
      id: `REL${i + 1}`,
      title,
      achieved: achievements[i] ?? false,
    })),
    metrics: {
      distance,
      speed,
      deltaV: s.spent,
      mass: s.mass,
      time: s.time,
      angle: s.angle,
      angularRate: s.angularRate,
    },
    recommendation: complete
      ? "Objectives achieved."
      : s.collision
        ? "Uncontrolled contact. Reduce velocity before final approach."
        : m.family === "recovery" && Math.abs(s.angle) > 3
          ? "Synchronize attitude before capture."
          : "Reach the next point and stabilize relative motion.",
  };
}
export function relativeReplay(
  mission: Mission,
  events: RelativeSession["events"],
  through = events.length,
) {
  let s = relativeSession(mission);
  if (!Number.isInteger(through) || through < 0 || through > events.length)
    throw Error("Invalid cursor");
  for (let i = 0; i < through; i++) {
    if (events[i].sequence !== i || events[i].time !== s.state.time)
      throw Error("Invalid event order");
    s = relativeExecute(s, events[i].command);
  }
  return s;
}
