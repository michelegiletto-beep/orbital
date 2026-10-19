export type Vec3 = [number, number, number];
export const MODEL = Object.freeze({
  version: "1.1.0",
  mu: 398600.4418,
  radius: 6371,
  step: 2,
  initialAltitude: 400,
  targetAltitude: 900,
  dryMass: 700,
  initialMass: 1000,
  isp: 320,
  g0: 9.80665,
});
export type OrbitState = {
  position: Vec3;
  velocity: Vec3;
  time: number;
  mass: number;
  spent: number;
  burns: number;
  impacted: boolean;
};
export type Command =
  | { type: "advance"; seconds: number }
  | {
      type: "burn";
      deltaV: number;
      direction: "prograde" | "retrograde" | "radial" | "normal";
    };
export type Event = { sequence: number; time: number; command: Command };
export type Configuration = {
  initialAltitude: number;
  targetAltitude: number;
  inclination: number;
  tolerance: number;
  budget: number;
  family: "transfer" | "deorbit";
};
export const DEFAULT_CONFIGURATION: Configuration = {
  initialAltitude: 400,
  targetAltitude: 900,
  inclination: 0,
  tolerance: 15,
  budget: 350,
  family: "transfer",
};
export type Session = {
  initial: OrbitState;
  state: OrbitState;
  events: Event[];
  mode: "guided" | "practice";
  difficulty: "standard" | "precision";
  configuration: Configuration;
};
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const scale = (a: Vec3, k: number): Vec3 => [
  a[0] * k,
  a[1] * k,
  a[2] * k,
];
export const dot = (a: Vec3, b: Vec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3) => Math.hypot(...a);
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Vec3) => scale(v, 1 / norm(v));
const clone = (s: OrbitState): OrbitState => ({
  ...s,
  position: [...s.position],
  velocity: [...s.velocity],
});
export function initialState(
  altitude: number = MODEL.initialAltitude,
  inclination = 0,
): OrbitState {
  const r = MODEL.radius + altitude,
    v = Math.sqrt(MODEL.mu / r),
    i = (inclination * Math.PI) / 180;
  return {
    position: [r, 0, 0],
    velocity: [0, v * Math.sin(i), v * Math.cos(i)],
    time: 0,
    mass: MODEL.initialMass,
    spent: 0,
    burns: 0,
    impacted: false,
  };
}
export function validateConfiguration(input: unknown): Configuration {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Invalid configuration");
  const c = input as Record<string, unknown>;
  for (const [key, min, max] of [
    ["initialAltitude", 200, 2000],
    ["targetAltitude", 40, 2500],
    ["inclination", 0, 180],
    ["tolerance", 0.1, 100],
    ["budget", 1, 1500],
  ] as const) {
    if (
      typeof c[key] !== "number" ||
      !Number.isFinite(c[key]) ||
      Number(c[key]) < min ||
      Number(c[key]) > max
    )
      throw Error("Invalid configuration");
  }
  if (c.family !== "transfer" && c.family !== "deorbit")
    throw Error("Invalid mission family");
  if (
    c.family === "transfer" &&
    Number(c.targetAltitude) <= Number(c.initialAltitude)
  )
    throw Error("Invalid transfer target");
  if (c.family === "deorbit" && Number(c.targetAltitude) >= 120)
    throw Error("Invalid entry target");
  return {
    initialAltitude: Number(c.initialAltitude),
    targetAltitude: Number(c.targetAltitude),
    inclination: Number(c.inclination),
    tolerance: Number(c.tolerance),
    budget: Number(c.budget),
    family: c.family,
  };
}
export function createSession(
  mode: Session["mode"] = "guided",
  difficulty: Session["difficulty"] = "standard",
  configuration: Configuration = DEFAULT_CONFIGURATION,
): Session {
  const config = validateConfiguration(configuration),
    initial = initialState(config.initialAltitude, config.inclination);
  return {
    initial,
    state: clone(initial),
    events: [],
    mode,
    difficulty,
    configuration: config,
  };
}
const gravity = (p: Vec3): Vec3 => scale(p, -MODEL.mu / norm(p) ** 3);
export function step(s: OrbitState, dt = MODEL.step): OrbitState {
  if (!Number.isFinite(dt) || dt <= 0 || dt > MODEL.step)
    throw new Error("Invalid integration step");
  if (s.impacted) return clone(s);
  const p1 = s.velocity,
    v1 = gravity(s.position);
  const p2 = add(s.velocity, scale(v1, dt / 2)),
    v2 = gravity(add(s.position, scale(p1, dt / 2)));
  const p3 = add(s.velocity, scale(v2, dt / 2)),
    v3 = gravity(add(s.position, scale(p2, dt / 2)));
  const p4 = add(s.velocity, scale(v3, dt)),
    v4 = gravity(add(s.position, scale(p3, dt)));
  const combine = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) =>
    scale(add(add(a, scale(b, 2)), add(scale(c, 2), d)), dt / 6);
  const position = add(s.position, combine(p1, p2, p3, p4));
  return {
    ...s,
    position,
    velocity: add(s.velocity, combine(v1, v2, v3, v4)),
    time: s.time + dt,
    impacted: norm(position) <= MODEL.radius,
  };
}
export function propagate(s: OrbitState, seconds: number): OrbitState {
  if (
    !Number.isInteger(seconds) ||
    seconds < 0 ||
    seconds > 86400 ||
    seconds % MODEL.step !== 0
  )
    throw new Error("Invalid duration");
  let result = clone(s);
  for (let t = 0; t < seconds; t += MODEL.step) {
    result = step(result);
    if (result.impacted) break;
  }
  return result;
}
export function elements(s: OrbitState) {
  const r = norm(s.position),
    v = norm(s.velocity),
    h = cross(s.position, s.velocity);
  const energy = (v * v) / 2 - MODEL.mu / r;
  const a = energy < 0 ? -MODEL.mu / (2 * energy) : Infinity;
  const eccentricity = norm(
    add(scale(cross(s.velocity, h), 1 / MODEL.mu), scale(s.position, -1 / r)),
  );
  return {
    altitude: r - MODEL.radius,
    speed: v,
    a,
    eccentricity,
    perigee: Number.isFinite(a)
      ? a * (1 - eccentricity) - MODEL.radius
      : -MODEL.radius,
    apogee: Number.isFinite(a)
      ? a * (1 + eccentricity) - MODEL.radius
      : Infinity,
    period: Number.isFinite(a)
      ? 2 * Math.PI * Math.sqrt(a ** 3 / MODEL.mu)
      : Infinity,
    energy,
    radialSpeed: dot(s.position, s.velocity) / r,
    inclination:
      (Math.acos(Math.max(-1, Math.min(1, -h[1] / norm(h)))) * 180) / Math.PI,
  };
}
export function transferPlan(
  initialAltitude: number = MODEL.initialAltitude,
  targetAltitude: number = MODEL.targetAltitude,
) {
  const r1 = MODEL.radius + initialAltitude,
    r2 = MODEL.radius + targetAltitude,
    a = (r1 + r2) / 2;
  return {
    first:
      1000 *
      (Math.sqrt(MODEL.mu * (2 / r1 - 1 / a)) - Math.sqrt(MODEL.mu / r1)),
    second:
      1000 *
      (Math.sqrt(MODEL.mu / r2) - Math.sqrt(MODEL.mu * (2 / r2 - 1 / a))),
    coast: Math.PI * Math.sqrt(a ** 3 / MODEL.mu),
  };
}
export function applyCommand(s: OrbitState, command: Command): OrbitState {
  if (s.impacted) throw new Error("Vehicle has impacted");
  if (command.type === "advance") return propagate(s, command.seconds);
  if (
    command.type !== "burn" ||
    !Number.isFinite(command.deltaV) ||
    command.deltaV < 0.1 ||
    command.deltaV > 350 ||
    !["prograde", "retrograde", "radial", "normal"].includes(command.direction)
  )
    throw new Error("Invalid burn");
  const mass = s.mass * Math.exp(-command.deltaV / (MODEL.isp * MODEL.g0));
  if (mass < MODEL.dryMass) throw new Error("Insufficient propellant");
  const direction =
    command.direction === "radial"
      ? unit(s.position)
      : command.direction === "normal"
        ? unit(cross(s.position, s.velocity))
        : scale(unit(s.velocity), command.direction === "retrograde" ? -1 : 1);
  return {
    ...clone(s),
    velocity: add(s.velocity, scale(direction, command.deltaV / 1000)),
    mass,
    spent: s.spent + command.deltaV,
    burns: s.burns + 1,
  };
}
export function execute(session: Session, command: Command): Session {
  if (session.events.length >= 10000)
    throw new Error("Session event limit reached");
  const state = applyCommand(session.state, command);
  if (state.spent > session.configuration.budget)
    throw Error("Insufficient mission impulse budget");
  return {
    ...session,
    state,
    events: [
      ...session.events,
      {
        sequence: session.events.length,
        time: session.state.time,
        command: { ...command },
      },
    ],
  };
}
export function replay(
  initial: OrbitState,
  events: Event[],
  through = events.length,
): OrbitState {
  if (!Number.isInteger(through) || through < 0 || through > events.length)
    throw new Error("Invalid replay cursor");
  let state = clone(initial);
  for (let i = 0; i < through; i++) {
    const event = events[i];
    if (event.sequence !== i || event.time !== state.time)
      throw new Error("Invalid event sequence");
    state = applyCommand(state, event.command);
  }
  return state;
}
export function nextApogee(s: OrbitState): number {
  const e = elements(s);
  if (e.eccentricity < 0.001 || !Number.isFinite(e.period))
    throw new Error("No distinct apogee");
  let state = clone(s),
    last = elements(state).radialSpeed;
  for (
    let t = MODEL.step;
    t <= Math.min(86400, e.period + MODEL.step);
    t += MODEL.step
  ) {
    state = step(state);
    const radial = elements(state).radialSpeed;
    if (last > 0 && radial <= 0) return t;
    last = radial;
  }
  throw new Error("Apogee unavailable");
}
export function entryTime(s: OrbitState): number {
  if (elements(s).perigee >= 120) throw Error("Entry interface unavailable");
  let current = clone(s);
  for (let t = 2; t <= 86400; t += 2) {
    current = step(current);
    const e = elements(current);
    if (e.altitude <= 120 && e.radialSpeed < 0) return t;
    if (current.impacted) break;
  }
  throw Error("Entry interface unavailable");
}
export function orbitPoints(s: OrbitState, count = 240): Vec3[] {
  const e = elements(s),
    duration = Number.isFinite(e.period) ? Math.min(20000, e.period) : 6000;
  const stride = Math.max(2, Math.round(duration / count / 2) * 2);
  const points: Vec3[] = [];
  let state = clone(s);
  for (let i = 0; i < count; i++) {
    points.push([...state.position]);
    state = propagate(state, stride);
    if (state.impacted) break;
  }
  return points;
}
export function report(session: Session) {
  const config = session.configuration ?? DEFAULT_CONFIGURATION,
    e = elements(session.state),
    plan = transferPlan(config.initialAltitude, config.targetAltitude),
    tolerance =
      session.difficulty === "precision"
        ? Math.min(3, config.tolerance)
        : config.tolerance;
  const orbitError =
    config.family === "deorbit"
      ? Math.abs(e.perigee - config.targetAltitude)
      : Math.max(
          Math.abs(e.apogee - config.targetAltitude),
          Math.abs(e.perigee - config.targetAltitude),
        );
  const firstBurn = session.events.find((x) => x.command.type === "burn");
  const firstError =
    firstBurn?.command.type === "burn"
      ? Math.abs(firstBurn.command.deltaV - Math.abs(plan.first))
      : Infinity;
  const deorbit = config.family === "deorbit";
  const objective1 =
    firstError <= 10 &&
    firstBurn?.command.type === "burn" &&
    firstBurn.command.direction === (deorbit ? "retrograde" : "prograde");
  const objective2 = deorbit
    ? e.perigee < 120 && orbitError <= tolerance && !session.state.impacted
    : orbitError <= tolerance &&
      e.eccentricity <= 0.003 &&
      !session.state.impacted;
  const objective3 = deorbit
    ? objective2 &&
      e.altitude <= 120 &&
      e.radialSpeed < 0 &&
      !session.state.impacted
    : objective2 &&
      session.state.spent <=
        Math.abs(plan.first) + Math.abs(plan.second) + 20 &&
      session.state.burns <= 3;
  const objectives = deorbit
    ? [
        {
          id: "DEO01",
          competency: "Plan the retrograde impulse",
          achieved: !!objective1,
        },
        {
          id: "DEO02",
          competency: "Lower perigee below 120 km",
          achieved: objective2,
        },
        {
          id: "DEO03",
          competency: "Reach the entry interface on descent",
          achieved: objective3,
        },
      ]
    : [
        {
          id: "ORB01",
          competency: "Interpret the orbital transfer",
          achieved: !!objective1,
        },
        {
          id: "ORB02",
          competency: "Circularize at apogee",
          achieved: objective2,
        },
        {
          id: "ORB03",
          competency: "Manage propellant",
          achieved: objective3,
        },
      ];
  const score = (objectives.filter((o) => o.achieved).length * 100) / 3;
  return {
    model: MODEL.version,
    complete: deorbit ? objective3 : objective2,
    score: Math.round(score),
    objectives,
    metrics: {
      orbitError: Number.isFinite(orbitError) ? orbitError : null,
      deltaV: session.state.spent,
      burns: session.state.burns,
      propellant: MODEL.initialMass - session.state.mass,
      duration: session.state.time,
    },
    recommendation: session.state.impacted
      ? "Keep perigee above the surface."
      : deorbit
        ? objective3
          ? "Atmospheric interface reached on descent."
          : objective2
            ? "Propagate to the 120 km interface."
            : "Plan a retrograde impulse to lower perigee."
        : objective3
          ? "Objectives achieved. Continue with precision practice."
          : objective2
            ? "Reduce correction impulses to conserve propellant."
            : session.state.burns === 0
              ? "A prograde impulse raises apogee. Plan before executing."
              : "Reach apogee and adjust velocity to the circular value.",
    nextDifficulty: objective3 ? "precision" : "standard",
  };
}
