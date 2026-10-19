import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG,
  seedLibrary,
  validateMission,
  validateLibrary,
} from "../packages/library/src/index.js";
import {
  relativeSession,
  relativeExecute,
  relativeReport,
  relativeReplay,
} from "../packages/sim-core/src/proximity.js";
import {
  createSession,
  execute,
  transferPlan,
  entryTime,
  report,
  nextApogee,
} from "../packages/sim-core/src/index.js";
test("all twelve mission definitions validate and library exports round trip", () => {
  const library = seedLibrary();
  assert.equal(library.missions.length, 12);
  for (const mission of CATALOG)
    assert.deepEqual(validateMission(mission), mission);
  assert.deepEqual(
    validateLibrary(JSON.parse(JSON.stringify(library))),
    library,
  );
});
test("library validator rejects invalid clients, duplicates, unbounded values and HTML", () => {
  const library = seedLibrary();
  for (const change of [
    { title: "<script>" },
    { budget: NaN },
    { initialRange: 10001 },
    { family: "invalid" },
    { objectives: [] },
    { clientId: "../../other" },
  ])
    assert.throws(() => validateMission({ ...CATALOG[0], ...change }));
  assert.throws(() =>
    validateLibrary({
      ...library,
      missions: [...library.missions, library.missions[0]],
    }),
  );
  assert.throws(() =>
    validateLibrary({
      ...library,
      missions: [{ ...library.missions[0], clientId: "missing" }],
    }),
  );
});
for (const mission of CATALOG.filter(
  (m) => !["transfer", "deorbit"].includes(m.family),
))
  test(`${mission.title} executes its distinct mission protocol and replays`, () => {
    let s = relativeSession(mission);
    const inspection = mission.family === "inspection",
      avoidance = mission.family === "avoidance";
    if (mission.family === "recovery")
      s = relativeExecute(s, { type: "attitude" });
    const count = avoidance ? 1 : 3;
    for (let i = 0; i < count; i++) {
      s = relativeExecute(s, { type: "guide", waypoint: i });
      if (inspection) s = relativeExecute(s, { type: "observe" });
    }
    if (!inspection && !avoidance) s = relativeExecute(s, { type: "capture" });
    const result = relativeReport(s);
    assert.equal(result.complete, true);
    assert.equal(result.score, 100);
    assert.ok(s.state.spent <= mission.budget);
    assert.deepEqual(relativeReplay(mission, s.events), s);
  });
for (const mission of CATALOG.filter((m) => m.family === "deorbit"))
  test(`${mission.title} reaches descending atmospheric interface without simulating atmospheric entry`, () => {
    let s = createSession("guided", "standard", {
      ...mission,
      family: "deorbit",
    });
    const plan = transferPlan(mission.initialAltitude, mission.targetAltitude);
    s = execute(s, {
      type: "burn",
      deltaV: Math.abs(plan.first),
      direction: "retrograde",
    });
    assert.equal(report(s).complete, false);
    s = execute(s, { type: "advance", seconds: entryTime(s.state) });
    assert.equal(report(s).complete, true);
    assert.equal(report(s).score, 100);
    assert.equal(s.state.impacted, false);
  });
test("custom orbital parameters affect the actual state and mission rubric", () => {
  const config = {
    initialAltitude: 600,
    targetAltitude: 1200,
    inclination: 45,
    budget: 350,
    tolerance: 15,
    family: "transfer" as const,
  };
  let s = createSession("guided", "standard", config);
  const plan = transferPlan(600, 1200);
  s = execute(s, { type: "burn", deltaV: plan.first, direction: "prograde" });
  s = execute(s, { type: "advance", seconds: nextApogee(s.state) });
  s = execute(s, { type: "burn", deltaV: plan.second, direction: "prograde" });
  assert.equal(report(s).score, 100);
  assert.ok(s.initial.velocity[1] > 0);
});
test("unsafe capture and out of sequence waypoints are rejected", () => {
  let s = relativeSession(CATALOG.find((m) => m.family === "docking")!);
  assert.throws(() => relativeExecute(s, { type: "capture" }));
  assert.throws(() => relativeExecute(s, { type: "guide", waypoint: 2 }));
  assert.throws(() =>
    relativeExecute(s, { type: "thrust", axis: 0, deltaV: Infinity }),
  );
  assert.throws(() => relativeExecute(s, { type: "advance", seconds: -1 }));
});
