import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  MODEL,
  initialState,
  elements,
  propagate,
  applyCommand,
  createSession,
  execute,
  nextApogee,
  transferPlan,
  report,
  replay,
  norm,
  type Command,
} from "../packages/sim-core/src/index.js";
import { parseCommand } from "../packages/contracts/src/index.js";

test("circular orbit agrees with analytical speed and retains energy for 24 hours", () => {
  const initial = initialState(),
    a = elements(initial),
    end = propagate(initial, 86400),
    b = elements(end);
  assert.ok(
    Math.abs(a.speed - Math.sqrt(MODEL.mu / (MODEL.radius + 400))) < 1e-12,
  );
  assert.ok(Math.abs((a.energy - b.energy) / a.energy) < 1e-9);
  assert.ok(Math.abs(b.altitude - 400) < 1e-5);
});
test("one orbit returns within 8 km of the initial position at a rounded time", () => {
  const s = initialState(),
    seconds = Math.round(elements(s).period / 2) * 2,
    end = propagate(s, seconds);
  assert.ok(
    norm(
      end.position.map((v, i) => v - s.position[i]) as [number, number, number],
    ) < 8,
  );
});
test("Hohmann transfer reaches 900 km and passes all tracked learning objectives", () => {
  const plan = transferPlan();
  let s = createSession();
  s = execute(s, { type: "burn", deltaV: plan.first, direction: "prograde" });
  assert.ok(Math.abs(elements(s.state).apogee - 900) < 1e-8);
  const coast = nextApogee(s.state);
  assert.ok(Math.abs(coast - plan.coast) < 2);
  s = execute(s, { type: "advance", seconds: coast });
  s = execute(s, { type: "burn", deltaV: plan.second, direction: "prograde" });
  const r = report(s);
  assert.equal(r.complete, true);
  assert.equal(r.score, 100);
  assert.equal(
    r.objectives.every((o) => o.achieved),
    true,
  );
  assert.ok(r.metrics.orbitError! < 3);
  assert.equal(r.nextDifficulty, "precision");
  assert.deepEqual(replay(s.initial, s.events), s.state);
});
test("failed and partial missions do not acquire completion", () => {
  const s = execute(createSession(), {
    type: "burn",
    deltaV: 30,
    direction: "radial",
  });
  assert.equal(report(s).complete, false);
  assert.equal(report(s).score, 0);
});
test("replay is bit-identical on this runtime and rejects reordered events", () => {
  let s = createSession();
  for (let i = 0; i < 20; i++) {
    s = execute(s, { type: "advance", seconds: 120 });
    s = execute(s, { type: "burn", deltaV: 2, direction: "prograde" });
  }
  assert.deepEqual(replay(s.initial, s.events), s.state);
  assert.deepEqual(replay(s.initial, s.events), replay(s.initial, s.events));
  const bad = structuredClone(s.events);
  bad[1].sequence = 9;
  assert.throws(() => replay(s.initial, bad));
  assert.throws(() => replay(s.initial, s.events, -1));
});
test("rocket equation conserves dry mass and does not mutate the input", () => {
  const initial = initialState(),
    copy = structuredClone(initial),
    burned = applyCommand(initial, {
      type: "burn",
      deltaV: 100,
      direction: "prograde",
    });
  assert.ok(
    Math.abs(burned.mass - 1000 * Math.exp(-100 / (320 * 9.80665))) < 1e-10,
  );
  assert.deepEqual(initial, copy);
  assert.throws(() =>
    applyCommand(
      { ...initial, mass: 701 },
      { type: "burn", deltaV: 350, direction: "prograde" },
    ),
  );
});
test("retrograde burn lowers perigee and normal burn changes inclination", () => {
  const initial = initialState();
  assert.ok(
    elements(
      applyCommand(initial, {
        type: "burn",
        deltaV: 100,
        direction: "retrograde",
      }),
    ).perigee < 400,
  );
  assert.ok(
    elements(
      applyCommand(initial, { type: "burn", deltaV: 100, direction: "normal" }),
    ).inclination > 0.5,
  );
});
test("invalid integration and burn parameters fail closed", () => {
  for (const seconds of [-1, 1, NaN, Infinity, 86402])
    assert.throws(() => propagate(initialState(), seconds));
  for (const deltaV of [-1, 0, NaN, Infinity, 351])
    assert.throws(() =>
      applyCommand(initialState(), {
        type: "burn",
        direction: "prograde",
        deltaV,
      }),
    );
  assert.throws(() =>
    applyCommand(initialState(), { type: "anything" } as unknown as Command),
  );
});
test("impact stops propagation and subsequent maneuvers", () => {
  let s = initialState();
  s = { ...s, position: [MODEL.radius + 0.001, 0, 0], velocity: [-1, 0, 0] };
  const end = propagate(s, 100);
  assert.equal(end.impacted, true);
  assert.equal(end.time, 2);
  assert.throws(() =>
    applyCommand(end, { type: "burn", deltaV: 1, direction: "prograde" }),
  );
});
test("seeded command fuzzing never accepts malformed protocol values", () => {
  const malformed: unknown[] = [
    null,
    [],
    true,
    42,
    "burn",
    {},
    { type: "advance", seconds: 1 },
    { type: "advance", seconds: 2, extra: true },
    { type: "burn", deltaV: NaN, direction: "prograde" },
    { type: "burn", deltaV: 1, direction: "unknown" },
  ];
  for (const input of malformed) assert.throws(() => parseCommand(input));
  let seed = 621;
  for (let i = 0; i < 10000; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const value = (seed % 100000) - 10000;
    try {
      const c = parseCommand({ type: "advance", seconds: value });
      assert.equal(c.type, "advance");
      assert.ok(value > 0 && value <= 86400 && value % 2 === 0);
    } catch (error) {
      assert.ok(error instanceof Error);
    }
  }
});
test("seeded physics fuzzing preserves finite bounded state", () => {
  let seed = 25;
  for (let i = 0; i < 500; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const directions = ["prograde", "retrograde", "radial", "normal"] as const;
    const s = propagate(
      applyCommand(initialState(), {
        type: "burn",
        deltaV: (seed % 300) + 0.1,
        direction: directions[seed % 4],
      }),
      1200,
    );
    assert.ok(
      [...s.position, ...s.velocity, s.mass, s.time].every(Number.isFinite),
    );
    assert.ok(s.mass >= MODEL.dryMass);
  }
});
test("24 hour propagation completes within a conservative 3 second budget", () => {
  const start = performance.now();
  propagate(initialState(), 86400);
  assert.ok(performance.now() - start < 3000);
});
