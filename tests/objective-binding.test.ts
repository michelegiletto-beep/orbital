import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG } from "../packages/library/src/index.js";
import {
  advancedMissionCommand,
  advancedMissionReport,
  createAdvancedMission,
  replayAdvancedMission,
  scenarioFromMission,
} from "../packages/sim-core/src/missions.js";

test("Recovery rotation objective requires measured roll and rate synchronization after ordered holds", () => {
  const mission = CATALOG.find(
    (candidate) => candidate.id === "recovery-passive",
  )!;
  let session = createAdvancedMission(mission);
  for (
    let waypoint = 0;
    waypoint < session.scenario.holdPoints.length;
    waypoint++
  )
    session = advancedMissionCommand(session, { type: "guide", waypoint });
  const unsynchronized = advancedMissionReport(session);
  assert.equal(session.state.checkpoint, session.scenario.holdPoints.length);
  assert.ok(unsynchronized.metrics.speed <= session.scenario.capture.speed);
  assert.ok(
    Math.abs(unsynchronized.metrics.angularRate) >
      session.scenario.capture.angularRate,
  );
  assert.equal(unsynchronized.objectives[0].achieved, true);
  assert.equal(unsynchronized.objectives[1].achieved, false);
  assert.equal(unsynchronized.complete, false);
  session = advancedMissionCommand(session, { type: "attitude" });
  for (let attempt = 0; attempt < 3; attempt++) {
    const measurement = advancedMissionReport(session).metrics;
    if (
      Math.abs(measurement.angle) <= session.scenario.capture.angle &&
      Math.abs(measurement.angularRate) <= session.scenario.capture.angularRate
    )
      break;
    session = advancedMissionCommand(session, { type: "attitude" });
  }
  const synchronized = advancedMissionReport(session);
  assert.ok(
    Math.abs(synchronized.metrics.angle) <= session.scenario.capture.angle,
  );
  assert.ok(
    Math.abs(synchronized.metrics.angularRate) <=
      session.scenario.capture.angularRate,
  );
  assert.ok(synchronized.metrics.speed <= session.scenario.capture.speed);
  assert.equal(synchronized.objectives[1].achieved, true);
  assert.equal(
    synchronized.objectives[2].achieved,
    false,
    "synchronization does not award capture",
  );
  assert.deepEqual(
    advancedMissionReport(
      replayAdvancedMission(session.scenario, session.journal),
    ),
    synchronized,
  );
});

test("Recovery roll error alone prevents synchronization credit even with zero relative rotation rate", () => {
  const mission = CATALOG.find(
    (candidate) => candidate.id === "recovery-close",
  )!;
  const scenario = scenarioFromMission(mission);
  scenario.attitude = {
    ...scenario.attitude,
    angle: 25,
    angularRate: 0,
    targetRate: 0,
  };
  let session = createAdvancedMission(scenario);
  for (let waypoint = 0; waypoint < scenario.holdPoints.length; waypoint++)
    session = advancedMissionCommand(session, { type: "guide", waypoint });
  const report = advancedMissionReport(session);
  assert.equal(report.metrics.angularRate, 0);
  assert.ok(Math.abs(report.metrics.angle) > scenario.capture.angle);
  assert.equal(report.objectives[1].achieved, false);
});

test("Docking hold and relative speed objective remains independent of the recovery roll rubric", () => {
  const scenario = scenarioFromMission(
    CATALOG.find((candidate) => candidate.id === "docking-axial")!,
  );
  scenario.attitude = {
    ...scenario.attitude,
    angle: 25,
    angularRate: 0,
    targetRate: 0,
  };
  let session = createAdvancedMission(scenario);
  for (let waypoint = 0; waypoint < scenario.holdPoints.length; waypoint++)
    session = advancedMissionCommand(session, { type: "guide", waypoint });
  const report = advancedMissionReport(session);
  assert.equal(report.objectives[1].achieved, true);
  assert.equal(report.objectives[2].achieved, false);
  assert.throws(
    () => advancedMissionCommand(session, { type: "capture" }),
    /Capture denied/,
  );
});
