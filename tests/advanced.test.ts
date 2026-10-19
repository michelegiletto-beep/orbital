import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWorkspace,
  defaultVehicle,
  propagate,
  orbitalMetrics,
  flightCommand,
  dispersion,
  density,
  groundPoint,
  forecast,
  replayArchive,
  DYNAMICS,
  type Maneuver,
} from "../packages/sim-core/src/advanced.js";
import { norm, add, scale } from "../packages/sim-core/src/index.js";
const close = (a: number, b: number, tolerance: number) =>
  assert.ok(
    Math.abs(a - b) <= tolerance,
    `${a} differs from ${b} by more than ${tolerance}`,
  );
const initial = () =>
  createWorkspace(
    [{ ...defaultVehicle(), eccentricity: 0, anomaly: 0, raan: 0 }],
    undefined,
    { gravity: "two-body", drag: false, step: 5 },
  );
const burn = (w: ReturnType<typeof initial>, partial: Partial<Maneuver> = {}) =>
  flightCommand(w, {
    type: "plan",
    maneuvers: [
      {
        id: "burn01",
        vehicleId: "vehicle01",
        at: 37,
        kind: "finite",
        direction: "prograde",
        deltaV: 10,
        thrust: 100,
        duration: 120,
        ...partial,
      },
    ],
  });
test("ECI conversion and central gravity close a circular orbit with conserved energy", () => {
  const w = initial(),
    before = orbitalMetrics(w.vehicles[0].state),
    after = propagate(w, before.period * 10, false).vehicles[0].state;
  close(orbitalMetrics(after).energy, before.energy, 1e-8);
  close(
    norm(add(after.position, scale(w.vehicles[0].state.position, -1))),
    0,
    0.001,
  );
  close(before.inclination, 51.6, 1e-10);
});
test("J2 nodal regression agrees with the first order secular rate over one day", () => {
  const w = initial();
  w.model.gravity = "j2";
  const m = orbitalMetrics(w.vehicles[0].state),
    n = Math.sqrt(DYNAMICS.mu / m.semiMajor ** 3),
    expected =
      (-1.5 *
        n *
        DYNAMICS.j2 *
        (DYNAMICS.equatorialRadius / m.semiMajor) ** 2 *
        Math.cos((m.inclination * Math.PI) / 180) *
        86400 *
        180) /
      Math.PI;
  const end = orbitalMetrics(propagate(w, 86400, false).vehicles[0].state),
    delta = ((end.raan - m.raan + 540) % 360) - 180;
  close(delta, expected, 0.06);
});
test("Finite burns resolve exact start and cutoff and follow the rocket equation", () => {
  const w = burn(initial()),
    state = propagate(w, 200).vehicles[0].state,
    used = (100 * 120) / (320 * DYNAMICS.g0);
  close(state.mass, 1000 - used, 1e-9);
  close(state.deltaV, 320 * DYNAMICS.g0 * Math.log(1000 / (1000 - used)), 1e-9);
  const end = propagate(w, 200);
  assert.ok(end.completed.includes("burn01"));
  assert.equal(end.events[0].time, 37);
  assert.equal(w.time, 0);
});
test("Finite thrust cuts off at dry mass without inventing propellant", () => {
  const w = createWorkspace(
    [{ ...defaultVehicle(), dryMass: 999 }],
    undefined,
    { gravity: "two-body", drag: false, step: 5 },
  );
  const end = propagate(burn(w, { at: 0, thrust: 20000, duration: 100 }), 200)
    .vehicles[0].state;
  close(end.mass, 999, 1e-9);
  close(end.deltaV, 320 * DYNAMICS.g0 * Math.log(1000 / 999), 1e-7);
});
test("Drag reduces orbital energy and density interpolates monotonically", () => {
  const w = createWorkspace(
      [
        {
          ...defaultVehicle(),
          altitude: 200,
          area: 40,
          anomaly: 0,
          eccentricity: 0,
        },
      ],
      undefined,
      { gravity: "two-body", drag: true, step: 2 },
    ),
    before = orbitalMetrics(w.vehicles[0].state).energy,
    after = orbitalMetrics(propagate(w, 3600, false).vehicles[0].state).energy;
  assert.ok(after < before);
  assert.ok(density(250) > density(300));
  assert.ok(density(300) > density(350));
  assert.equal(density(1001), 0);
});
test("Flight archive replays deterministically and rejects tampered initial vectors", () => {
  const w = initial(),
    commands = [
      { type: "plan" as const, maneuvers: burn(w).plan },
      { type: "advance" as const, seconds: 200 },
      {
        type: "model" as const,
        model: { gravity: "j2" as const, drag: true, step: 2 },
      },
      { type: "advance" as const, seconds: 1800 },
    ],
    archive = { initial: w, commands },
    a = replayArchive(archive),
    b = replayArchive(archive);
  assert.deepEqual(a.workspace, b.workspace);
  assert.equal(a.workspace.time, 2000);
  assert.ok(a.workspace.history.length > 10);
  const changed = structuredClone(archive);
  changed.initial.vehicles[0].state.velocity[0] = 100;
  assert.throws(() => replayArchive(changed), /unmodified/);
});
test("Dispersion is reproducible, responds to uncertainty and keeps input immutable", () => {
  const w = initial(),
    options = {
      seed: 42,
      count: 8,
      seconds: 1800,
      positionSigma: 25,
      velocitySigma: 0.01,
    },
    before = JSON.stringify(w),
    a = dispersion(w, "vehicle01", options),
    b = dispersion(w, "vehicle01", options);
  assert.deepEqual(a, b);
  assert.ok(a.p95 >= a.p50);
  assert.ok(a.p50 > 1);
  assert.equal(JSON.stringify(w), before);
  assert.equal(
    dispersion(w, "vehicle01", {
      ...options,
      positionSigma: 0,
      velocitySigma: 0,
    }).maximum,
    0,
  );
  assert.throws(() => dispersion(w, "vehicle01", { ...options, count: 65 }));
});
test("Ground track bounds, multi spacecraft forecast and plan constraints", () => {
  const w = createWorkspace(),
    r = forecast(w, 600, 60);
  assert.equal(r.samples.length, 20);
  assert.ok(r.closest && r.closest.distance > 0);
  for (const s of r.samples) {
    const g = groundPoint(s.position, w.epoch, s.time);
    assert.ok(Math.abs(g.longitude) <= 180 && Math.abs(g.latitude) <= 90);
  }
  const p = burn(w).plan[0];
  assert.throws(
    () =>
      flightCommand(w, {
        type: "plan",
        maneuvers: [p, { ...p, id: "overlap", at: 100 }],
      }),
    /overlap/,
  );
  assert.throws(() =>
    flightCommand(w, {
      type: "model",
      model: { gravity: "j2", drag: true, step: 0 },
    }),
  );
  assert.throws(() => propagate(w, NaN));
});

test("Impulses execute at the exact boundary and active burns cannot be overlapped", () => {
  const w = burn(initial(), { at: 30, kind: "impulse", deltaV: 10 }),
    end = propagate(w, 30);
  assert.equal(end.vehicles[0].state.deltaV, 10);
  assert.ok(end.completed.includes("burn01"));
  assert.equal(end.events[0].time, 30);
  const active = propagate(burn(initial(), { at: 0 }), 30);
  assert.throws(
    () =>
      flightCommand(active, {
        type: "plan",
        maneuvers: [{ ...active.plan[0], id: "overlap", at: 40 }],
      }),
    /overlap/,
  );
});
test("J2 and finite burn propagation converges as integration step is reduced", () => {
  const coarse = burn(
      createWorkspace(
        [{ ...defaultVehicle(), eccentricity: 0.01 }],
        undefined,
        { gravity: "j2", drag: true, step: 10 },
      ),
    ),
    fine = structuredClone(coarse);
  fine.model.step = 1;
  const a = propagate(coarse, 5400, false).vehicles[0].state,
    b = propagate(fine, 5400, false).vehicles[0].state;
  assert.ok(norm(add(a.position, scale(b.position, -1))) < 0.005);
  close(a.mass, b.mass, 1e-8);
});
