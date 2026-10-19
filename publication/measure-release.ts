import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { CATALOG } from "../packages/library/src/index.js";
import {
  advancedMissionCommand,
  advancedMissionReport,
  createAdvancedMission,
  replayAdvancedMission,
  scenarioFromMission,
  type AdvancedMissionSession,
} from "../packages/sim-core/src/missions.js";

function completeApproach(initial: AdvancedMissionSession) {
  let session = initial;
  if (session.scenario.family === "recovery") {
    session = advancedMissionCommand(session, { type: "attitude" });
  }
  for (let waypoint = 0; waypoint < session.scenario.holdPoints.length; waypoint++) {
    session = advancedMissionCommand(session, { type: "guide", waypoint });
  }
  return advancedMissionCommand(session, { type: "capture" });
}

function evidence(session: AdvancedMissionSession, caseId: string) {
  const report = advancedMissionReport(session);
  const replay = replayAdvancedMission(session.scenario, session.journal);
  const exactReplay = JSON.stringify(replay) === JSON.stringify(session);
  if (!report.complete || !exactReplay) {
    throw Error(`Evidence case failed: ${caseId}`);
  }
  return {
    caseId,
    scenarioId: session.scenario.id,
    family: session.scenario.family,
    scenarioRevision: session.scenario.revision,
    scenarioSha256: createHash("sha256").update(JSON.stringify(session.scenario)).digest("hex"),
    scenario: session.scenario,
    journal: session.journal,
    report,
    exactReplay,
  };
}

const cases = [];
for (const mission of CATALOG.filter((item) => ["docking", "recovery"].includes(item.family))) {
  cases.push(evidence(completeApproach(createAdvancedMission(mission)), mission.id));
}
for (const mission of CATALOG.filter((item) => item.family === "deorbit")) {
  for (const kind of ["impulse", "finite"] as const) {
    let session = advancedMissionCommand(createAdvancedMission(mission), {
      type: "deorbit", kind, thrust: 800,
    });
    session = advancedMissionCommand(session, { type: "advance", seconds: 10800 });
    cases.push(evidence(session, mission.id + ":" + kind));
  }
}
const custom = scenarioFromMission(CATALOG.find((item) => item.family === "docking")!);
custom.id = "customer-evaluation";
custom.clientId = "synthetic-customer";
custom.title = "Synthetic customer precision approach";
custom.revision = 3;
custom.relativePosition = [0, -180, 0];
custom.relativeVelocity = [0, 0.015, 0];
custom.holdPoints = [80, 12, 0.2];
custom.holdTolerance = 0.03;
custom.capture.distance = 0.4;
custom.capture.speed = 0.03;
custom.chaser.mass = 800;
custom.chaser.dryMass = 650;
custom.chaser.area = 6;
custom.target.area = 3;
cases.push(evidence(completeApproach(createAdvancedMission(custom)), custom.id));

const result = {
  softwareVersion: "0.3.0",
  preparedDate: "2026-10-17",
  measuredAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  interpretation: "Deterministic synthetic implementation cases, not independent physical validation or customer results",
  cases,
};
const target = fileURLToPath(new URL("./output/model-evidence.json", import.meta.url));
writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(cases.map(({ caseId, exactReplay, report }) => ({
  caseId, exactReplay, complete: report.complete, score: report.score,
  time: report.metrics.time, distance: report.metrics.distance,
  speed: report.metrics.speed, deltaV: report.metrics.deltaV,
  propellantUsed: report.metrics.propellantUsed, entry: report.entry,
})), null, 2));
