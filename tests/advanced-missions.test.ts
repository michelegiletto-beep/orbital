import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG } from "../packages/library/src/index.js";
import { add, scale, norm } from "../packages/sim-core/src/index.js";
import { DYNAMICS, propagate } from "../packages/sim-core/src/advanced.js";
import {
  scenarioFromMission,
  validateAdvancedMissionScenario,
  createAdvancedMission,
  advancedMissionCommand,
  advancedMissionReport,
  measureAdvancedMission,
  parseAdvancedMissionCommand,
  replayAdvancedMission,
  type AdvancedMissionSession,
} from "../packages/sim-core/src/missions.js";

const docking = CATALOG.find((mission) => mission.family === "docking")!;
const recovery = CATALOG.find((mission) => mission.family === "recovery")!;
const deorbit = CATALOG.find((mission) => mission.family === "deorbit")!;
const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`,
  );

function completeApproach(session: AdvancedMissionSession) {
  let state = session;
  if (state.scenario.family === "recovery")
    state = advancedMissionCommand(state, { type: "attitude" });
  for (
    let waypoint = 0;
    waypoint < state.scenario.holdPoints.length;
    waypoint++
  ) {
    state = advancedMissionCommand(state, { type: "guide", waypoint });
    assert.equal(
      state.state.checkpoint,
      waypoint + 1,
      "guidance must reach a measured hold before recording it",
    );
  }
  return advancedMissionCommand(state, { type: "capture" });
}

for (const mission of CATALOG.filter((candidate) =>
  ["docking", "recovery"].includes(candidate.family),
)) {
  test(
    `${mission.title} completes in the nonlinear shared engine with replayable measured capture`,
    { timeout: 60000 },
    () => {
      const initial = createAdvancedMission(mission),
        before = JSON.stringify(initial),
        completed = completeApproach(initial),
        report = advancedMissionReport(completed),
        measurement = measureAdvancedMission(completed);
      assert.equal(report.complete, true);
      assert.equal(report.score, 100);
      assert.ok(report.objectives.every((objective) => objective.achieved));
      assert.ok(measurement.distance <= completed.scenario.capture.distance);
      assert.ok(measurement.speed <= completed.scenario.capture.speed);
      assert.ok(
        Math.abs(measurement.angle) <= completed.scenario.capture.angle,
      );
      assert.ok(
        Math.abs(measurement.angularRate) <=
          completed.scenario.capture.angularRate,
      );
      assert.ok(measurement.deltaV <= mission.budget + 1e-6);
      assert.ok(measurement.mass >= completed.scenario.chaser.dryMass);
      assert.ok(measurement.mass < completed.scenario.chaser.mass);
      assert.equal(
        completed.state.holdEvents.length,
        completed.scenario.holdPoints.length,
      );
      const target = completed.workspace.vehicles.find(
        (vehicle) => vehicle.spec.id === completed.scenario.target.id,
      )!;
      assert.equal(
        target.state.mass,
        completed.scenario.target.mass,
        "passive target receives no thrust or propellant credit",
      );
      assert.equal(
        JSON.stringify(initial),
        before,
        "commands preserve their input snapshots",
      );
      const restored = replayAdvancedMission(
        completed.scenario,
        JSON.parse(JSON.stringify(completed.journal)),
      );
      assert.deepEqual(restored, completed);
      assert.throws(
        () =>
          advancedMissionCommand(completed, { type: "advance", seconds: 1 }),
        /terminated/,
      );
    },
  );
}

for (const mission of CATALOG.filter(
  (candidate) => candidate.family === "deorbit",
)) {
  test(
    `${mission.title} measures a descending 120 km boundary after impulse and finite thrust`,
    { timeout: 60000 },
    () => {
      for (const kind of ["impulse", "finite"] as const) {
        const initial = createAdvancedMission(mission),
          burned = advancedMissionCommand(initial, {
            type: "deorbit",
            kind,
            thrust: 800,
          }),
          entered = advancedMissionCommand(burned, {
            type: "advance",
            seconds: 10800,
          }),
          report = advancedMissionReport(entered),
          measurement = measureAdvancedMission(entered);
        assert.equal(
          report.complete,
          true,
          `${kind} burn must meet measured descent requirement`,
        );
        assert.equal(report.score, 100);
        assert.ok(entered.state.entry);
        close(entered.state.entry!.altitude, 120, 1e-5);
        assert.ok(
          entered.state.entry!.radialVelocity <=
            -entered.scenario.deorbit.minimumDescentRate,
        );
        close(entered.workspace.time, entered.state.entry!.time, 1e-8);
        assert.ok(measurement.perigee < 120);
        assert.ok(measurement.deltaV <= mission.budget + 1e-6);
        const expectedMass =
          mission.family === "deorbit"
            ? initial.scenario.chaser.mass *
              Math.exp(
                -measurement.deltaV /
                  (initial.scenario.chaser.isp * DYNAMICS.g0),
              )
            : 0;
        close(measurement.mass, expectedMass, 1e-7);
        assert.deepEqual(
          replayAdvancedMission(entered.scenario, entered.journal).workspace,
          entered.workspace,
        );
        assert.throws(
          () =>
            advancedMissionCommand(entered, { type: "advance", seconds: 1 }),
          /terminated/,
        );
      }
    },
  );
}

test("relative initial conditions invert the rotating RTN frame and coast uses nonlinear ECI propagation", () => {
  const scenario = scenarioFromMission(docking);
  scenario.relativePosition = [120, -1200, 80];
  scenario.relativeVelocity = [0.03, -0.02, 0.01];
  scenario.target.eccentricity = 0.05;
  scenario.target.inclination = 82;
  const initial = createAdvancedMission(scenario),
    measured = measureAdvancedMission(initial);
  for (let axis = 0; axis < 3; axis++) {
    close(measured.position[axis], scenario.relativePosition[axis], 1e-8);
    close(measured.velocity[axis], scenario.relativeVelocity[axis], 1e-10);
  }
  const coast = advancedMissionCommand(initial, {
      type: "advance",
      seconds: 60,
    }),
    expected = propagate(initial.workspace, 60, false);
  for (let index = 0; index < coast.workspace.vehicles.length; index++) {
    const a = coast.workspace.vehicles[index].state,
      b = expected.vehicles[index].state;
    close(norm(add(a.position, scale(b.position, -1))), 0, 1e-9);
    close(norm(add(a.velocity, scale(b.velocity, -1))), 0, 1e-11);
  }
  assert.equal(initial.workspace.time, 0);
});

test(
  "client scenario parameters affect the actual engine while library identity remains authoritative",
  { timeout: 60000 },
  () => {
    const settings = scenarioFromMission(docking);
    settings.relativePosition = [0, -180, 0];
    settings.relativeVelocity = [0, 0.015, 0];
    settings.holdPoints = [80, 12, 0.2];
    settings.holdTolerance = 0.03;
    settings.capture.distance = 0.4;
    settings.capture.speed = 0.03;
    settings.chaser.mass = 800;
    settings.chaser.dryMass = 650;
    settings.chaser.area = 6;
    settings.target.area = 3;
    const mission = {
        ...docking,
        id: "client-precision",
        clientId: "client-a",
        title: "Customer precision approach",
        revision: 3,
        advanced: {
          ...settings,
          id: "spoofed",
          clientId: "other-client",
          title: "Spoofed",
          objectives: ["A", "B", "C"],
        },
      },
      scenario = scenarioFromMission(mission);
    assert.equal(scenario.id, mission.id);
    assert.equal(scenario.clientId, "client-a");
    assert.equal(scenario.title, mission.title);
    assert.deepEqual(scenario.objectives, mission.objectives);
    const initial = createAdvancedMission(scenario);
    close(measureAdvancedMission(initial).distance, 180, 1e-8);
    close(measureAdvancedMission(initial).mass, 800, 1e-10);
    const complete = completeApproach(initial),
      report = advancedMissionReport(complete);
    assert.equal(report.complete, true);
    assert.ok(report.metrics.distance <= 0.4 && report.metrics.speed <= 0.03);
  },
);

test(
  "capture limits, waypoint order, propellant budget, abort and collision are enforced",
  { timeout: 30000 },
  () => {
    const initial = createAdvancedMission(recovery),
      before = JSON.stringify(initial);
    assert.throws(
      () => advancedMissionCommand(initial, { type: "capture" }),
      /Capture denied/,
    );
    assert.throws(
      () => advancedMissionCommand(initial, { type: "guide", waypoint: 1 }),
      /order/,
    );
    const tight = createAdvancedMission(docking, { budget: 0.1 }),
      partial = advancedMissionCommand(tight, { type: "guide", waypoint: 0 });
    assert.equal(partial.state.checkpoint, 0);
    assert.equal(advancedMissionReport(partial).complete, false);
    assert.ok(measureAdvancedMission(partial).deltaV <= 0.100001);
    assert.throws(
      () =>
        advancedMissionCommand(tight, { type: "impulse", axis: 1, deltaV: 1 }),
      /budget/,
    );
    assert.equal(JSON.stringify(initial), before);
    const aborted = advancedMissionCommand(initial, { type: "abort" });
    assert.equal(advancedMissionReport(aborted).status, "aborted");
    assert.equal(advancedMissionReport(aborted).complete, false);
    assert.throws(
      () => advancedMissionCommand(aborted, { type: "advance", seconds: 1 }),
      /terminated/,
    );
    const collisionScenario = scenarioFromMission(docking);
    collisionScenario.relativePosition = [0, -10, 0];
    collisionScenario.relativeVelocity = [0, 30, 0];
    collisionScenario.holdPoints = [6, 1, 0.3];
    const collision = advancedMissionCommand(
      createAdvancedMission(collisionScenario),
      { type: "advance", seconds: 0.5 },
    );
    assert.equal(
      collision.state.collision,
      true,
      "a segment crossing the contact radius is detected between samples",
    );
    assert.equal(advancedMissionReport(collision).complete, false);
    assert.throws(
      () => advancedMissionCommand(collision, { type: "capture" }),
      /terminated/,
    );
  },
);

test("scenario validation and replay reject malformed values, unsupported fields and edited journals", () => {
  const scenario = scenarioFromMission(docking);
  for (const change of [
    { relativePosition: [0, Number.NaN, 0] },
    { holdPoints: [100, 200, 0.5] },
    { target: { ...scenario.target, id: scenario.chaser.id } },
    { capture: { ...scenario.capture, speed: 10 } },
    { deorbit: { ...scenario.deorbit, entryAltitude: 80 } },
    { objectives: ["Only one"] },
    { unsupported: true },
  ])
    assert.throws(() =>
      validateAdvancedMissionScenario({ ...scenario, ...change }),
    );
  for (const command of [
    null,
    [],
    { type: "advance", seconds: Number.NaN },
    { type: "advance", seconds: 0 },
    { type: "guide", waypoint: 0.5 },
    { type: "impulse", axis: 3, deltaV: 1 },
    { type: "impulse", axis: 0, deltaV: 0 },
    { type: "deorbit", kind: "finite", thrust: 0 },
    { type: "capture", bypass: true },
    { type: "other" },
  ])
    assert.throws(() => parseAdvancedMissionCommand(command));
  const first = advancedMissionCommand(createAdvancedMission(scenario), {
      type: "advance",
      seconds: 5,
    }),
    second = advancedMissionCommand(first, {
      type: "impulse",
      axis: 2,
      deltaV: 0.01,
    });
  assert.deepEqual(replayAdvancedMission(scenario, second.journal, 1), first);
  const changed = structuredClone(second.journal);
  changed[1].time += 1;
  assert.throws(() => replayAdvancedMission(scenario, changed), /timestamp/);
  assert.throws(
    () => replayAdvancedMission(scenario, [...second.journal].reverse()),
    /order/,
  );
  assert.throws(
    () => replayAdvancedMission(scenario, second.journal, 3),
    /journal/,
  );
});
