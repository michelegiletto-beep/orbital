import { add, scale, dot, norm, cross, type Vec3 } from "./index.js";

export const DYNAMICS = Object.freeze({
  version: "2.0.0",
  mu: 398600.4418,
  radius: 6371,
  equatorialRadius: 6378.137,
  j2: 1.08262668e-3,
  rotation: 7.292115e-5,
  g0: 9.80665,
});
export type Direction = "prograde" | "retrograde" | "radial" | "normal";
export type ForceModel = {
  gravity: "two-body" | "j2";
  drag: boolean;
  step: number;
};
export type VehicleSpec = {
  id: string;
  name: string;
  altitude: number;
  eccentricity: number;
  inclination: number;
  raan: number;
  anomaly: number;
  mass: number;
  dryMass: number;
  isp: number;
  area: number;
  cd: number;
  color: string;
};
export type FlightState = {
  position: Vec3;
  velocity: Vec3;
  mass: number;
  deltaV: number;
  entered: boolean;
};
export type Vehicle = { spec: VehicleSpec; state: FlightState };
export type Maneuver = {
  id: string;
  vehicleId: string;
  at: number;
  kind: "impulse" | "finite";
  direction: Direction;
  deltaV: number;
  thrust: number;
  duration: number;
};
export type FlightEvent = {
  time: number;
  type: "maneuver" | "entry" | "configuration";
  vehicleId: string;
  message: string;
};
export type Sample = {
  time: number;
  vehicleId: string;
  position: Vec3;
  velocity: Vec3;
  mass: number;
  altitude: number;
  deltaV: number;
};
export type Workspace = {
  schema: "orbital.flight.v2";
  epoch: string;
  time: number;
  model: ForceModel;
  vehicles: Vehicle[];
  plan: Maneuver[];
  completed: string[];
  events: FlightEvent[];
  history: Sample[];
};
export type FlightCommand =
  | { type: "advance"; seconds: number }
  | { type: "plan"; maneuvers: Maneuver[] }
  | { type: "vehicle"; vehicle: VehicleSpec }
  | { type: "model"; model: ForceModel };
/** An inertial force in newtons, applied by the shared nonlinear integrator. */
export type FlightControl = { vehicleId: string; thrust: Vec3 };
const rad = Math.PI / 180;
const unit = (v: Vec3) => scale(v, 1 / norm(v));
const strictObject = (input: unknown, fields: string[]) => {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !fields.includes(k))
  )
    throw Error("Invalid object fields");
};
const finite = (v: unknown, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw Error(`Value must be between ${min} and ${max}`);
  return v;
};
const identifier = (v: unknown) => {
  if (typeof v !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(v))
    throw Error("Invalid identifier");
  return v;
};
export function validateVehicle(input: unknown): VehicleSpec {
  strictObject(input, [
    "id",
    "name",
    "altitude",
    "eccentricity",
    "inclination",
    "raan",
    "anomaly",
    "mass",
    "dryMass",
    "isp",
    "area",
    "cd",
    "color",
  ]);
  if (!input || typeof input !== "object") throw Error("Invalid spacecraft");
  const v = input as VehicleSpec;
  if (
    typeof v.name !== "string" ||
    !v.name.trim() ||
    v.name.length > 60 ||
    !/^#[a-fA-F0-9]{6}$/.test(v.color)
  )
    throw Error("Invalid spacecraft name or color");
  const mass = finite(v.mass, 1, 100000),
    dryMass = finite(v.dryMass, 0.1, mass);
  const spec = {
    id: identifier(v.id),
    name: v.name.trim(),
    altitude: finite(v.altitude, 160, 42000),
    eccentricity: finite(v.eccentricity, 0, 0.7),
    inclination: finite(v.inclination, 0, 180),
    raan: finite(v.raan, 0, 360),
    anomaly: finite(v.anomaly, 0, 360),
    mass,
    dryMass,
    isp: finite(v.isp, 50, 5000),
    area: finite(v.area, 0.01, 1000),
    cd: finite(v.cd, 0.1, 5),
    color: v.color,
  };
  return spec;
}
export function validateModel(value: unknown): ForceModel {
  strictObject(value, ["gravity", "drag", "step"]);
  const m = value as ForceModel;
  if (
    !m ||
    !["two-body", "j2"].includes(m.gravity) ||
    typeof m.drag !== "boolean"
  )
    throw Error("Invalid force model");
  return { gravity: m.gravity, drag: m.drag, step: finite(m.step, 0.5, 10) };
}
export function stateFromElements(spec: VehicleSpec): FlightState {
  const a = (DYNAMICS.radius + spec.altitude) / (1 - spec.eccentricity),
    e = spec.eccentricity,
    f = spec.anomaly * rad,
    p = a * (1 - e * e),
    r = p / (1 + e * Math.cos(f));
  const i = spec.inclination * rad,
    o = spec.raan * rad;
  const rotate = ([x, y, z]: Vec3): Vec3 => [
    Math.cos(o) * x -
      Math.sin(o) * Math.cos(i) * y +
      Math.sin(o) * Math.sin(i) * z,
    Math.sin(o) * x +
      Math.cos(o) * Math.cos(i) * y -
      Math.cos(o) * Math.sin(i) * z,
    Math.sin(i) * y + Math.cos(i) * z,
  ];
  return {
    position: rotate([r * Math.cos(f), r * Math.sin(f), 0]),
    velocity: rotate(
      scale([-Math.sin(f), e + Math.cos(f), 0], Math.sqrt(DYNAMICS.mu / p)),
    ),
    mass: spec.mass,
    deltaV: 0,
    entered: false,
  };
}
export const defaultVehicle = (
  id = "vehicle01",
  name = "ORBITER 01",
): VehicleSpec => ({
  id,
  name,
  altitude: 520,
  eccentricity: 0.002,
  inclination: 51.6,
  raan: 24,
  anomaly: 32,
  mass: 1000,
  dryMass: 700,
  isp: 320,
  area: 4,
  cd: 2.2,
  color: "#a899ff",
});
export function createWorkspace(
  specs: VehicleSpec[] = [
    defaultVehicle(),
    {
      ...defaultVehicle("vehicle02", "REFERENCE 01"),
      altitude: 560,
      anomaly: 80,
      color: "#53d6bc",
    },
  ],
  epoch = "2026-10-15T12:00:00.000Z",
  model: ForceModel = { gravity: "j2", drag: true, step: 5 },
): Workspace {
  if (
    !Number.isFinite(Date.parse(epoch)) ||
    specs.length < 1 ||
    specs.length > 8 ||
    new Set(specs.map((v) => v.id)).size !== specs.length
  )
    throw Error("Invalid flight workspace");
  const w: Workspace = {
    schema: "orbital.flight.v2",
    epoch: new Date(epoch).toISOString(),
    time: 0,
    model: validateModel(model),
    vehicles: specs.map((v) => {
      const spec = validateVehicle(v);
      return { spec, state: stateFromElements(spec) };
    }),
    plan: [],
    completed: [],
    events: [],
    history: [],
  };
  sample(w);
  return w;
}
// Log interpolation of representative density values, kg/m³. No solar activity model.
export function density(altitude: number): number {
  const table = [
    [120, 2.438e-8],
    [150, 2.07e-9],
    [200, 2.789e-10],
    [250, 7.248e-11],
    [300, 2.418e-11],
    [400, 3.725e-12],
    [500, 6.967e-13],
    [600, 1.454e-13],
    [700, 3.614e-14],
    [800, 1.17e-14],
    [900, 5.245e-15],
    [1000, 3.019e-15],
  ];
  if (altitude > 1000) return 0;
  const h = Math.max(120, altitude);
  for (let i = 1; i < table.length; i++)
    if (h <= table[i][0]) {
      const [a, x] = table[i - 1],
        [b, y] = table[i];
      return Math.exp(Math.log(x) + ((h - a) / (b - a)) * Math.log(y / x));
    }
  return 0;
}
export function acceleration(
  state: FlightState,
  spec: VehicleSpec,
  model: ForceModel,
): Vec3 {
  const r = norm(state.position),
    [x, y, z] = state.position;
  let a = scale(state.position, -DYNAMICS.mu / (r * r * r));
  if (model.gravity === "j2") {
    const k =
        (1.5 * DYNAMICS.j2 * DYNAMICS.mu * DYNAMICS.equatorialRadius ** 2) /
        r ** 5,
      q = (5 * z * z) / (r * r);
    a = add(a, [k * x * (q - 1), k * y * (q - 1), k * z * (q - 3)]);
  }
  if (model.drag) {
    const relative = add(state.velocity, [
      DYNAMICS.rotation * y,
      -DYNAMICS.rotation * x,
      0,
    ]);
    const speed = norm(relative) * 1000,
      rho = density(r - DYNAMICS.radius);
    a = add(
      a,
      scale(
        relative,
        ((-0.5 * rho * spec.cd * spec.area) / state.mass) * speed,
      ),
    );
  }
  return a;
}
export function burnDirection(state: FlightState, direction: Direction): Vec3 {
  if (direction === "radial") return unit(state.position);
  if (direction === "normal")
    return unit(cross(state.position, state.velocity));
  return scale(unit(state.velocity), direction === "retrograde" ? -1 : 1);
}
function integrate(
  state: FlightState,
  spec: VehicleSpec,
  model: ForceModel,
  dt: number,
  burn?: Maneuver,
  control?: Vec3,
): FlightState {
  const available = state.mass > spec.dryMass + 1e-9;
  const thrust = available
    ? control
      ? norm(control)
      : (burn?.thrust ?? 0)
    : 0;
  const derivative = (s: FlightState) => ({
    p: s.velocity,
    v: add(
      acceleration(s, spec, model),
      thrust
        ? scale(
            control ? unit(control) : burnDirection(s, burn!.direction),
            thrust / s.mass / 1000,
          )
        : [0, 0, 0],
    ),
    m: -thrust / (spec.isp * DYNAMICS.g0),
    dv: thrust / s.mass,
  });
  const offset = (
    s: FlightState,
    k: ReturnType<typeof derivative>,
    h: number,
  ): FlightState => ({
    ...s,
    position: add(s.position, scale(k.p, h)),
    velocity: add(s.velocity, scale(k.v, h)),
    mass: s.mass + k.m * h,
  });
  const k1 = derivative(state),
    k2 = derivative(offset(state, k1, dt / 2)),
    k3 = derivative(offset(state, k2, dt / 2)),
    k4 = derivative(offset(state, k3, dt));
  const total = (key: "p" | "v") =>
    scale(
      add(add(k1[key], scale(k2[key], 2)), add(scale(k3[key], 2), k4[key])),
      dt / 6,
    );
  return {
    ...state,
    position: add(state.position, total("p")),
    velocity: add(state.velocity, total("v")),
    mass: Math.max(
      spec.dryMass,
      state.mass + (dt * (k1.m + 2 * k2.m + 2 * k3.m + k4.m)) / 6,
    ),
    deltaV: state.deltaV + (dt * (k1.dv + 2 * k2.dv + 2 * k3.dv + k4.dv)) / 6,
  };
}
function sample(w: Workspace) {
  for (const v of w.vehicles)
    w.history.push({
      time: w.time,
      vehicleId: v.spec.id,
      position: [...v.state.position],
      velocity: [...v.state.velocity],
      mass: v.state.mass,
      altitude: norm(v.state.position) - DYNAMICS.radius,
      deltaV: v.state.deltaV,
    });
  if (w.history.length > 4096) {
    const recent = w.history.slice(-2048);
    w.history = [
      ...w.history
        .slice(0, -2048)
        .filter((_, i) => Math.floor(i / w.vehicles.length) % 2 === 0),
      ...recent,
    ];
  }
}
export function validatePlan(input: unknown, w: Workspace): Maneuver[] {
  if (!Array.isArray(input) || input.length > 32)
    throw Error("A flight plan supports up to 32 maneuvers");
  const plan = input
    .map((x: unknown) => {
      strictObject(x, [
        "id",
        "vehicleId",
        "at",
        "kind",
        "direction",
        "deltaV",
        "thrust",
        "duration",
      ]);
      const p = x as Maneuver;
      if (
        !p ||
        !["impulse", "finite"].includes(p.kind) ||
        !["prograde", "retrograde", "radial", "normal"].includes(p.direction) ||
        !w.vehicles.some((v) => v.spec.id === p.vehicleId)
      )
        throw Error("Invalid maneuver");
      return {
        id: identifier(p.id),
        vehicleId: identifier(p.vehicleId),
        at: finite(p.at, w.time, 604800),
        kind: p.kind,
        direction: p.direction,
        deltaV: finite(p.deltaV, 0, 1000),
        thrust: finite(p.thrust, 0.01, 20000),
        duration: finite(p.duration, 1, 3600),
      } as Maneuver;
    })
    .sort((a, b) => a.at - b.at);
  if (
    new Set(plan.map((p) => p.id)).size !== plan.length ||
    plan.some((p) => w.completed.includes(p.id))
  )
    throw Error("Maneuver identifiers must be unique");
  for (let i = 0; i < plan.length; i++)
    for (let j = i + 1; j < plan.length; j++)
      if (
        plan[i].vehicleId === plan[j].vehicleId &&
        plan[j].at <
          plan[i].at + (plan[i].kind === "finite" ? plan[i].duration : 0.001)
      )
        throw Error("Maneuvers for one spacecraft cannot overlap");
  return plan;
}
export function propagate(
  workspace: Workspace,
  seconds: number,
  keepHistory = true,
  controls: FlightControl[] = [],
  stopAtEntry = false,
): Workspace {
  finite(seconds, 0.001, 86400);
  if (workspace.time + seconds > 604800)
    throw Error("Workspace horizon is seven days");
  const w = structuredClone(workspace),
    end = w.time + seconds;
  for (const control of controls) {
    if (
      !w.vehicles.some((v) => v.spec.id === control.vehicleId) ||
      controls.filter((v) => v.vehicleId === control.vehicleId).length !== 1 ||
      !Array.isArray(control.thrust) ||
      control.thrust.length !== 3 ||
      control.thrust.some((n) => !Number.isFinite(n)) ||
      norm(control.thrust) > 50000
    )
      throw Error("Invalid inertial thrust control");
    if (
      w.plan.some(
        (p) =>
          p.vehicleId === control.vehicleId &&
          p.kind === "finite" &&
          p.at < end &&
          p.at + p.duration > w.time,
      )
    )
      throw Error("Controlled thrust overlaps a planned burn");
  }
  const applyImpulses = () => {
    for (const burn of w.plan.filter(
      (p) =>
        !w.completed.includes(p.id) &&
        p.kind === "impulse" &&
        p.at <= w.time + 1e-8,
    )) {
      const v = w.vehicles.find((v) => v.spec.id === burn.vehicleId)!;
      if (!v.state.entered) {
        const mass =
          v.state.mass * Math.exp(-burn.deltaV / (v.spec.isp * DYNAMICS.g0));
        if (mass < v.spec.dryMass)
          throw Error("Insufficient propellant for planned impulse");
        v.state.velocity = add(
          v.state.velocity,
          scale(burnDirection(v.state, burn.direction), burn.deltaV / 1000),
        );
        v.state.mass = mass;
        v.state.deltaV += burn.deltaV;
        w.events.push({
          time: w.time,
          type: "maneuver",
          vehicleId: v.spec.id,
          message: `Impulse executed · ${burn.deltaV.toFixed(2)} m/s ${burn.direction}`,
        });
      }
      w.completed.push(burn.id);
    }
  };
  while (w.time < end - 1e-8) {
    applyImpulses();
    let dt = Math.min(w.model.step, end - w.time, 30 - (w.time % 30));
    for (const p of w.plan) {
      for (const boundary of [
        p.at,
        p.kind === "finite" ? p.at + p.duration : p.at,
      ])
        if (boundary > w.time + 1e-8) dt = Math.min(dt, boundary - w.time);
    }
    for (const v of w.vehicles) {
      const burn = w.plan.find(
        (p) =>
          p.kind === "finite" &&
          p.vehicleId === v.spec.id &&
          p.at <= w.time + 1e-8 &&
          p.at + p.duration > w.time + 1e-8,
      );
      const controlledThrust = controls.find((c) => c.vehicleId === v.spec.id);
      const thrust = controlledThrust
        ? norm(controlledThrust.thrust)
        : (burn?.thrust ?? 0);
      if (thrust && v.state.mass > v.spec.dryMass + 1e-9)
        dt = Math.min(
          dt,
          ((v.state.mass - v.spec.dryMass) * v.spec.isp * DYNAMICS.g0) / thrust,
        );
    }
    if (dt < 1e-8) dt = Math.min(0.001, end - w.time);
    let entryStep: number | null = null;
    for (const v of w.vehicles) {
      if (!stopAtEntry || v.state.entered) continue;
      const burn = w.plan.find(
        (p) =>
          p.kind === "finite" &&
          p.vehicleId === v.spec.id &&
          p.at <= w.time + 1e-8 &&
          p.at + p.duration > w.time + 1e-8,
      );
      const control = controls.find((c) => c.vehicleId === v.spec.id)?.thrust;
      const candidate = integrate(v.state, v.spec, w.model, dt, burn, control);
      if (
        norm(v.state.position) > DYNAMICS.radius + 120 &&
        norm(candidate.position) <= DYNAMICS.radius + 120 &&
        dot(candidate.position, candidate.velocity) < 0
      ) {
        let low = 0,
          high = dt;
        for (let iteration = 0; iteration < 40; iteration++) {
          const mid = (low + high) / 2;
          const trial = integrate(v.state, v.spec, w.model, mid, burn, control);
          if (norm(trial.position) > DYNAMICS.radius + 120) low = mid;
          else high = mid;
        }
        entryStep = Math.min(entryStep ?? dt, high);
      }
    }
    if (entryStep !== null && stopAtEntry) dt = entryStep;
    for (const v of w.vehicles)
      if (!v.state.entered) {
        const burn = w.plan.find(
          (p) =>
            p.kind === "finite" &&
            p.vehicleId === v.spec.id &&
            p.at <= w.time + 1e-8 &&
            p.at + p.duration > w.time + 1e-8,
        );
        if (
          burn &&
          !w.events.some(
            (e) =>
              e.vehicleId === v.spec.id &&
              e.type === "maneuver" &&
              Math.abs(e.time - burn.at) < 1e-7,
          )
        )
          w.events.push({
            time: w.time,
            type: "maneuver",
            vehicleId: v.spec.id,
            message: `Finite burn started · ${burn.thrust} N ${burn.direction}`,
          });
        const control = controls.find((c) => c.vehicleId === v.spec.id)?.thrust;
        v.state = integrate(v.state, v.spec, w.model, dt, burn, control);
        if (norm(v.state.position) - DYNAMICS.radius <= 120) {
          v.state.entered = true;
          w.events.push({
            time: w.time + dt,
            type: "entry",
            vehicleId: v.spec.id,
            message:
              "120 km entry interface reached. Propagation stopped for this spacecraft.",
          });
        }
      }
    w.time += dt;
    applyImpulses();
    for (const p of w.plan)
      if (
        p.kind === "finite" &&
        p.at + p.duration <= w.time + 1e-8 &&
        !w.completed.includes(p.id)
      )
        w.completed.push(p.id);
    if (
      keepHistory &&
      (Math.abs(w.time % 30) < 1e-7 || Math.abs(w.time - end) < 1e-7)
    )
      sample(w);
    if (entryStep !== null && stopAtEntry) break;
  }
  w.events = w.events.slice(-2000);
  return w;
}
/** A fuel limited inertial impulse. Delta V is supplied in metres per second. */
export function applyVectorImpulse(
  workspace: Workspace,
  vehicleId: string,
  deltaV: Vec3,
): Workspace {
  if (
    !Array.isArray(deltaV) ||
    deltaV.length !== 3 ||
    deltaV.some((n) => !Number.isFinite(n)) ||
    norm(deltaV) > 1000
  )
    throw Error("Invalid inertial impulse");
  const w = structuredClone(workspace),
    v = w.vehicles.find((v) => v.spec.id === vehicleId);
  if (!v || v.state.entered) throw Error("Spacecraft unavailable for impulse");
  const amount = norm(deltaV),
    mass = v.state.mass * Math.exp(-amount / (v.spec.isp * DYNAMICS.g0));
  if (mass < v.spec.dryMass) throw Error("Insufficient propellant for impulse");
  v.state.velocity = add(v.state.velocity, scale(deltaV, 0.001));
  v.state.mass = mass;
  v.state.deltaV += amount;
  w.events.push({
    time: w.time,
    type: "maneuver",
    vehicleId,
    message: `Inertial impulse executed · ${amount.toFixed(3)} m/s`,
  });
  return w;
}
export function flightCommand(workspace: Workspace, input: unknown): Workspace {
  const c = input as FlightCommand;
  if (!c || typeof c !== "object") throw Error("Invalid flight command");
  const fields: Record<string, string[]> = {
    advance: ["type", "seconds"],
    plan: ["type", "maneuvers"],
    model: ["type", "model"],
    vehicle: ["type", "vehicle"],
  };
  if (!Object.hasOwn(fields, c.type)) throw Error("Unknown flight command");
  strictObject(c, fields[c.type]);
  if (c.type === "advance") return propagate(workspace, c.seconds);
  const w = structuredClone(workspace);
  if (c.type === "plan") {
    const combined = [
      ...w.plan.filter((p) => p.at < w.time || w.completed.includes(p.id)),
      ...validatePlan(c.maneuvers, w),
    ];
    validatePlan(combined, { ...w, time: 0, completed: [] });
    w.plan = combined;
  } else if (c.type === "model") {
    w.model = validateModel(c.model);
    w.events.push({
      time: w.time,
      type: "configuration",
      vehicleId: "workspace",
      message: `Force model set to ${w.model.gravity}${w.model.drag ? " with drag" : ""}`,
    });
  } else if (c.type === "vehicle") {
    if (w.vehicles.length >= 8) throw Error("Eight spacecraft maximum");
    const spec = validateVehicle(c.vehicle);
    if (w.vehicles.some((v) => v.spec.id === spec.id))
      throw Error("Spacecraft identifier already exists");
    w.vehicles.push({ spec, state: stateFromElements(spec) });
    w.events.push({
      time: w.time,
      type: "configuration",
      vehicleId: spec.id,
      message: `${spec.name} added at current simulation time`,
    });
    sample(w);
  } else throw Error("Unknown flight command");
  return w;
}
export function orbitalMetrics(s: FlightState) {
  const r = norm(s.position),
    v = norm(s.velocity),
    h = cross(s.position, s.velocity),
    ecc = add(
      scale(cross(s.velocity, h), 1 / DYNAMICS.mu),
      scale(s.position, -1 / r),
    ),
    e = norm(ecc),
    energy = (v * v) / 2 - DYNAMICS.mu / r,
    a = -DYNAMICS.mu / (2 * energy);
  const inclination =
    Math.acos(Math.max(-1, Math.min(1, h[2] / norm(h)))) / rad;
  const raan = (Math.atan2(h[0], -h[1]) / rad + 360) % 360;
  return {
    altitude: r - DYNAMICS.radius,
    speed: v,
    eccentricity: e,
    semiMajor: a,
    perigee: a * (1 - e) - DYNAMICS.radius,
    apogee: energy < 0 ? a * (1 + e) - DYNAMICS.radius : Infinity,
    inclination,
    raan,
    period:
      energy < 0 ? 2 * Math.PI * Math.sqrt(a ** 3 / DYNAMICS.mu) : Infinity,
    energy,
  };
}
export function groundPoint(position: Vec3, epoch: string, time: number) {
  const jd = (Date.parse(epoch) + time * 1000) / 86400000 + 2440587.5,
    days = jd - 2451545,
    gmst = (280.46061837 + 360.98564736629 * days) * rad;
  const longitude =
    (((((Math.atan2(position[1], position[0]) - gmst) / rad) % 360) + 540) %
      360) -
    180;
  return { longitude, latitude: Math.asin(position[2] / norm(position)) / rad };
}
export function forecast(workspace: Workspace, seconds = 5400, stride = 60) {
  finite(seconds, 60, 86400);
  finite(stride, 5, 600);
  let w = structuredClone(workspace);
  w.history = [];
  const samples: Sample[] = [];
  for (let t = 0; t < seconds; t += stride) {
    w = propagate(w, Math.min(stride, seconds - t), false);
    for (const v of w.vehicles)
      samples.push({
        time: w.time,
        vehicleId: v.spec.id,
        position: v.state.position,
        velocity: v.state.velocity,
        mass: v.state.mass,
        altitude: orbitalMetrics(v.state).altitude,
        deltaV: v.state.deltaV,
      });
  }
  let closest: { distance: number; time: number; pair: string[] } | null = null;
  for (let i = 0; i < samples.length; i += w.vehicles.length)
    for (let a = 0; a < w.vehicles.length; a++)
      for (let b = a + 1; b < w.vehicles.length; b++) {
        const x = samples[i + a],
          y = samples[i + b],
          distance = norm(add(x.position, scale(y.position, -1)));
        if (!closest || distance < closest.distance)
          closest = {
            distance,
            time: x.time,
            pair: [x.vehicleId, y.vehicleId],
          };
      }
  return { samples, closest };
}
export function dispersion(
  workspace: Workspace,
  vehicleId: string,
  options: {
    seed: number;
    count: number;
    seconds: number;
    positionSigma: number;
    velocitySigma: number;
  },
) {
  finite(options.count, 8, 64);
  finite(options.seed, 0, 4294967295);
  finite(options.seconds, 60, 10800);
  finite(options.positionSigma, 0, 10000);
  finite(options.velocitySigma, 0, 10);
  if (!Number.isInteger(options.count) || !Number.isInteger(options.seed))
    throw Error("Integer seed and sample count required");
  const vehicle = workspace.vehicles.find((v) => v.spec.id === vehicleId);
  if (!vehicle) throw Error("Unknown spacecraft");
  let seed = options.seed >>> 0;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
  };
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
  const nominal = propagate(
    {
      ...structuredClone(workspace),
      vehicles: [structuredClone(vehicle)],
      history: [],
      plan: workspace.plan.filter((p) => p.vehicleId === vehicleId),
    },
    options.seconds,
    false,
  ).vehicles[0].state;
  const outcomes = [];
  for (let n = 0; n < options.count; n++) {
    const w = structuredClone(workspace);
    w.vehicles = [structuredClone(vehicle)];
    w.plan = w.plan.filter((p) => p.vehicleId === vehicleId);
    w.history = [];
    w.vehicles[0].state.position = add(vehicle.state.position, [
      (gaussian() * options.positionSigma) / 1000,
      (gaussian() * options.positionSigma) / 1000,
      (gaussian() * options.positionSigma) / 1000,
    ]);
    w.vehicles[0].state.velocity = add(vehicle.state.velocity, [
      (gaussian() * options.velocitySigma) / 1000,
      (gaussian() * options.velocitySigma) / 1000,
      (gaussian() * options.velocitySigma) / 1000,
    ]);
    const s = propagate(w, options.seconds, false).vehicles[0].state;
    outcomes.push({
      position: s.position,
      miss: 1000 * norm(add(s.position, scale(nominal.position, -1))),
      altitude: orbitalMetrics(s).altitude,
    });
  }
  const misses = outcomes.map((o) => o.miss).sort((a, b) => a - b),
    percentile = (p: number) =>
      misses[Math.min(misses.length - 1, Math.ceil(p * misses.length) - 1)];
  return {
    seed: options.seed,
    count: options.count,
    seconds: options.seconds,
    positionSigma: options.positionSigma,
    velocitySigma: options.velocitySigma,
    p50: percentile(0.5),
    p95: percentile(0.95),
    maximum: misses.at(-1)!,
    outcomes,
  };
}
export function validateWorkspace(input: unknown): Workspace {
  const w = input as Workspace;
  if (
    !w ||
    w.schema !== "orbital.flight.v2" ||
    !Array.isArray(w.vehicles) ||
    !Array.isArray(w.events) ||
    !Array.isArray(w.history) ||
    !Array.isArray(w.completed)
  )
    throw Error("Invalid workspace archive");
  finite(w.time, 0, 604800);
  createWorkspace(
    w.vehicles.map((v) => v.spec),
    w.epoch,
    w.model,
  );
  if (
    w.events.length > 2000 ||
    w.history.length > 5000 ||
    w.completed.length > 1000 ||
    !Array.isArray(w.plan) ||
    w.plan.length > 64
  )
    throw Error("Workspace archive exceeds limits");
  for (const v of w.vehicles) {
    const s = v.state;
    if (
      !s ||
      !Array.isArray(s.position) ||
      s.position.length !== 3 ||
      !Array.isArray(s.velocity) ||
      s.velocity.length !== 3
    )
      throw Error("Invalid state vector");
    s.position.forEach((n) => finite(n, -1e8, 1e8));
    s.velocity.forEach((n) => finite(n, -100, 100));
    finite(norm(s.position), DYNAMICS.radius, 1e8);
    finite(s.mass, v.spec.dryMass, v.spec.mass);
    finite(s.deltaV, 0, 100000);
    if (typeof s.entered !== "boolean") throw Error("Invalid entry flag");
  }
  // Validate completed plans in their original time frame before accepting the archive.
  validatePlan(w.plan, { ...w, time: 0, completed: [] });
  for (const h of w.history) {
    finite(h.time, 0, w.time);
    if (
      !w.vehicles.some((v) => v.spec.id === h.vehicleId) ||
      !Array.isArray(h.position) ||
      h.position.length !== 3
    )
      throw Error("Invalid history sample");
    h.position.forEach((n) => finite(n, -1e8, 1e8));
    finite(h.altitude, -100, 1e8);
    finite(h.mass, 0.1, 100000);
    finite(h.deltaV, 0, 100000);
  }
  for (const e of w.events)
    if (
      !e ||
      typeof e.message !== "string" ||
      e.message.length > 500 ||
      !["maneuver", "entry", "configuration"].includes(e.type) ||
      !Number.isFinite(e.time)
    )
      throw Error("Invalid event archive");
  return structuredClone(w);
}
export type FlightArchive = { initial: Workspace; commands: FlightCommand[] };
export function replayArchive(input: unknown): {
  archive: FlightArchive;
  workspace: Workspace;
} {
  const a = input as FlightArchive;
  if (
    !a ||
    !a.initial ||
    !Array.isArray(a.initial.vehicles) ||
    !Array.isArray(a.initial.plan) ||
    !Array.isArray(a.initial.events) ||
    !Array.isArray(a.initial.completed) ||
    !Array.isArray(a.commands) ||
    a.commands.length > 2000
  )
    throw Error("Invalid flight archive");
  const initial = createWorkspace(
    a.initial.vehicles.map((v) => v.spec),
    a.initial.epoch,
    a.initial.model,
  );
  if (
    a.initial.time !== 0 ||
    a.initial.schema !== initial.schema ||
    a.initial.plan.length ||
    a.initial.events.length ||
    a.initial.completed.length ||
    JSON.stringify(initial.vehicles) !== JSON.stringify(a.initial.vehicles)
  )
    throw Error("Archive must start from unmodified orbital elements");
  let workspace = initial,
    cost = 0;
  for (const command of a.commands) {
    if (command.type === "advance") {
      cost +=
        (command.seconds / workspace.model.step) * workspace.vehicles.length;
      if (!Number.isFinite(cost) || cost > 400000)
        throw Error("Archive computation limit exceeded");
    }
    workspace = flightCommand(workspace, command);
  }
  return {
    archive: { initial, commands: structuredClone(a.commands) },
    workspace,
  };
}
