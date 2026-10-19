import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { once } from "node:events";
import WebSocket from "ws";
import {
  transferPlan,
  createSession,
  execute,
  nextApogee,
} from "../packages/sim-core/src/index.js";
import {
  createWorkspace,
  flightCommand,
} from "../packages/sim-core/src/advanced.js";
import { CATALOG } from "../packages/library/src/index.js";

test(
  "API end to end mission, malformed requests, signed persistence, streams and concurrency",
  { timeout: 150000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "orbital-api-")),
      probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((done) => probe.close(() => done()));
    const base = `http://127.0.0.1:${port}`;
    let child: ChildProcess | undefined;
    async function start() {
      child = spawn(
        process.execPath,
        ["--import", "tsx", "apps/api/src/server.ts"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PORT: String(port),
            DATA_DIR: directory,
            NODE_ENV: "test",
            OIDC_ISSUER: "",
            OIDC_JWKS_URI: "",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "",
        spawnError: Error | undefined;
      child.on("error", (error) => {
        spawnError = error;
      });
      child.stdout!.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr!.on("data", (chunk) => {
        output += chunk;
      });
      // Cold TypeScript loader startup on a busy Windows host can exceed 15 seconds.
      // Bound only fixture readiness here; all functional assertions remain unchanged.
      const started = performance.now();
      while (performance.now() - started < 60000) {
        if (spawnError) throw spawnError;
        if (output.includes('"event":"listening"')) return;
        if (child.exitCode !== null || child.signalCode !== null)
          throw Error(
            `API exited before readiness: code ${child.exitCode}, signal ${child.signalCode}. ${output}`,
          );
        await new Promise((r) => setTimeout(r, 50));
      }
      throw Error("API fixture startup exceeded 60 seconds. " + output);
    }
    async function stop() {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill();
        await once(child, "exit");
      }
    }
    const post = (
      path: string,
      value: unknown,
      origin = "http://127.0.0.1:4317",
    ) =>
      fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(value),
      });
    try {
      await start();
      assert.equal((await fetch(base + "/health")).status, 200);
      const library = (await (await fetch(base + "/v1/library")).json()) as {
        revision: number;
        clients: unknown[];
        missions: unknown[];
      };
      assert.equal(library.missions.length, 12);
      const custom = {
        ...library,
        clients: [
          ...library.clients,
          {
            id: "test-client",
            name: "Test client",
            createdAt: new Date().toISOString(),
          },
        ],
      };
      const update = await fetch(base + "/v1/library", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": "1",
          Origin: "http://127.0.0.1:4317",
        },
        body: JSON.stringify(custom),
      });
      assert.equal(update.status, 200);
      assert.equal(((await update.json()) as { revision: number }).revision, 2);
      assert.equal(
        (
          await fetch(base + "/v1/library", {
            method: "PUT",
            headers: { "Content-Type": "application/json", "If-Match": "1" },
            body: JSON.stringify(custom),
          })
        ).status,
        409,
      );
      const proximity = await post(
        "/v1/proximity",
        CATALOG.find((m) => m.family === "docking"),
      );
      assert.equal(proximity.status, 201);
      const relativeId = ((await proximity.json()) as { id: string }).id;
      assert.equal(
        (
          await post(`/v1/proximity/${relativeId}/commands`, {
            type: "capture",
          })
        ).status,
        400,
      );
      for (let waypoint = 0; waypoint < 3; waypoint++)
        assert.equal(
          (
            await post(`/v1/proximity/${relativeId}/commands`, {
              type: "guide",
              waypoint,
            })
          ).status,
          200,
        );
      assert.equal(
        (
          await post(`/v1/proximity/${relativeId}/commands`, {
            type: "capture",
          })
        ).status,
        200,
      );
      const proximityReport = (await (
        await fetch(`${base}/v1/proximity/${relativeId}/report`)
      ).json()) as { complete: boolean; score: number };
      assert.equal(proximityReport.complete, true);
      assert.equal(proximityReport.score, 100);
      const resultSource = {
        kind: "relative",
        sourceId: relativeId,
        mission: CATALOG.find((m) => m.family === "docking"),
      };
      assert.equal((await post("/v1/results", resultSource)).status, 201);
      assert.equal((await post("/v1/results", resultSource)).status, 200);
      const results = (await (await fetch(base + "/v1/results")).json()) as {
        score: number;
        complete: boolean;
      }[];
      assert.equal(results.length, 1);
      assert.equal(results[0].score, 100);
      assert.equal(
        (await fetch(base + "/v1/auth/callback?code=invalid&state=invalid"))
          .status,
        401,
      );
      assert.equal(
        (
          await post(
            "/v1/sessions",
            { mode: "guided", difficulty: "standard" },
            "https://untrusted.invalid",
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await post("/v1/sessions", {
            mode: "invalid",
            difficulty: "standard",
          })
        ).status,
        400,
      );
      const created = await post("/v1/sessions", {
        mode: "guided",
        difficulty: "standard",
      });
      assert.equal(created.status, 201);
      const { id } = (await created.json()) as { id: string };
      assert.equal(
        (
          await post(`/v1/sessions/${id}/commands`, {
            type: "advance",
            seconds: NaN,
          })
        ).status,
        400,
      );
      assert.equal((await fetch(base + "/v1/audit")).status, 403);
      const ws = new WebSocket(
        `${base.replace("http", "ws")}/v1/sessions/${id}/stream`,
        { origin: "http://127.0.0.1:4317" },
      );
      await once(ws, "message");
      const streamed = once(ws, "message"),
        plan = transferPlan();
      assert.equal(
        (
          await post(`/v1/sessions/${id}/commands`, {
            type: "burn",
            deltaV: plan.first,
            direction: "prograde",
          })
        ).status,
        200,
      );
      const [raw] = await streamed;
      assert.equal(JSON.parse(String(raw)).sequence, 1);
      ws.close();
      const local = execute(createSession(), {
        type: "burn",
        deltaV: plan.first,
        direction: "prograde",
      });
      await post(`/v1/sessions/${id}/commands`, {
        type: "advance",
        seconds: nextApogee(local.state),
      });
      await post(`/v1/sessions/${id}/commands`, {
        type: "burn",
        deltaV: plan.second,
        direction: "prograde",
      });
      const evaluation = (await (
        await fetch(`${base}/v1/sessions/${id}/report`)
      ).json()) as { score: number; complete: boolean };
      assert.equal(evaluation.score, 100);
      assert.equal(evaluation.complete, true);
      await Promise.all(
        Array.from({ length: 12 }, () =>
          post(`/v1/sessions/${id}/commands`, { type: "advance", seconds: 2 }),
        ),
      );
      const state = (await (
        await fetch(`${base}/v1/sessions/${id}`)
      ).json()) as { events: unknown[] };
      assert.equal(state.events.length, 15);
      const advancedInitial = createWorkspace(),
        advancedCommands = [
          {
            type: "plan" as const,
            maneuvers: [
              {
                id: "burn01",
                vehicleId: "vehicle01",
                at: 37,
                kind: "finite" as const,
                direction: "prograde" as const,
                deltaV: 10,
                thrust: 100,
                duration: 120,
              },
            ],
          },
          { type: "advance" as const, seconds: 3600 },
        ],
        advancedArchive = {
          initial: advancedInitial,
          commands: advancedCommands,
        };
      const checkpointResponse = await post("/v1/advanced", advancedArchive);
      assert.equal(checkpointResponse.status, 201);
      const checkpoint = (await checkpointResponse.json()) as {
        id: string;
        time: number;
        digest: string;
      };
      assert.equal(checkpoint.time, 3600);
      assert.equal(checkpoint.digest.length, 64);
      const advancedState = (await (
        await fetch(base + "/v1/advanced/" + checkpoint.id)
      ).json()) as { workspace: ReturnType<typeof createWorkspace> };
      assert.deepEqual(
        advancedState.workspace,
        advancedCommands.reduce(flightCommand, advancedInitial),
      );
      assert.equal(
        ((await (await fetch(base + "/v1/advanced")).json()) as unknown[])
          .length,
        1,
      );
      const tampered = structuredClone(advancedArchive);
      tampered.initial.vehicles[0].state.mass = 99999;
      assert.equal((await post("/v1/advanced", tampered)).status, 400);
      assert.equal(
        (
          await post(
            "/v1/advanced",
            advancedArchive,
            "https://untrusted.invalid",
          )
        ).status,
        403,
      );
      await stop();
      await start();
      const restored = await (await fetch(`${base}/v1/sessions/${id}`)).json();
      assert.deepEqual(restored, state);
      assert.deepEqual(
        await (await fetch(base + "/v1/advanced/" + checkpoint.id)).json(),
        advancedState,
      );
      assert.equal(
        (
          (await (await fetch(base + "/v1/library")).json()) as {
            revision: number;
          }
        ).revision,
        2,
      );
      assert.equal(
        (
          (await (
            await fetch(`${base}/v1/proximity/${relativeId}/report`)
          ).json()) as { complete: boolean }
        ).complete,
        true,
      );
      const denied = new WebSocket(
        `${base.replace("http", "ws")}/v1/sessions/${id}/stream`,
        { origin: "https://untrusted.invalid" },
      );
      await new Promise<void>((resolve) => {
        denied.on("error", () => resolve());
      });
    } finally {
      await stop();
      if (!resolve(directory).startsWith(resolve(tmpdir()) + sep))
        throw Error("Unsafe test cleanup");
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
test(
  "production refuses startup without configured identity provider",
  { timeout: 60000 },
  async () => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "apps/api/src/server.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "production",
          OIDC_ISSUER: "",
          OIDC_AUDIENCE: "",
        },
        stdio: "pipe",
      },
    );
    let output = "";
    child.stderr.on("data", (c) => {
      output += c;
    });
    const [code] = await once(child, "exit");
    assert.notEqual(code, 0);
    assert.match(output, /requires OIDC/);
  },
);
