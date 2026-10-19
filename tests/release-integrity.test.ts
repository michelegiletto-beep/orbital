import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";
import { CATALOG, seedLibrary } from "../packages/library/src/index.js";
import { AuditLog } from "../packages/security/src/index.js";
import { createSession } from "../packages/sim-core/src/index.js";
import { createWorkspace } from "../packages/sim-core/src/advanced.js";
import {
  scenarioFromMission,
  type AdvancedMissionSession,
} from "../packages/sim-core/src/missions.js";
import {
  clientDelivery,
  zip,
  assertPublishableFile,
} from "../packages/delivery/src/index.js";

async function apiFixture() {
  const directory = await mkdtemp(join(tmpdir(), "orbital-release-")),
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
          NODE_ENV: "test",
          PORT: String(port),
          DATA_DIR: directory,
          OIDC_ISSUER: "",
          OIDC_JWKS_URI: "",
          OIDC_AUDIENCE: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout!.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr!.on("data", (chunk) => {
      output += chunk;
    });
    for (let attempt = 0; attempt < 300; attempt++) {
      if (output.includes('"event":"listening"')) return;
      if (child.exitCode !== null) throw Error(output);
      await new Promise((done) => setTimeout(done, 50));
    }
    throw Error("Test API did not start: " + output);
  }
  async function stop() {
    const running = child;
    child = undefined;
    if (running && running.exitCode === null && running.signalCode === null) {
      running.kill();
      await once(running, "exit");
    }
  }
  const request = (
    path: string,
    method = "GET",
    value?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:4317",
        ...headers,
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
  async function close() {
    await stop();
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep))
      throw Error("Unsafe test cleanup");
    await rm(directory, { recursive: true, force: true });
  }
  return { directory, start, stop, request, close };
}

const tenantHash = createHash("sha256").update("local").digest("hex");
const docking = CATALOG.find((mission) => mission.family === "docking")!;
const transfer = CATALOG.find((mission) => mission.family === "transfer")!;

test(
  "signed session persistence binds authorization metadata and rejects rollback",
  { timeout: 120000 },
  async (t) => {
    for (const relative of [false, true]) {
      await t.test(
        relative ? "relative session" : "orbital session",
        async () => {
          const api = await apiFixture();
          try {
            await api.start();
            const route = relative ? "/v1/proximity" : "/v1/sessions",
              response = await api.request(
                route,
                "POST",
                relative ? docking : { mode: "guided", difficulty: "standard" },
              );
            assert.equal(response.status, 201);
            const { id } = (await response.json()) as { id: string },
              path = join(
                api.directory,
                relative ? "proximity" : "sessions",
                id + ".json",
              ),
              original = await readFile(path, "utf8");
            assert.equal(
              (
                await api.request(`${route}/${id}/commands`, "POST", {
                  type: "advance",
                  seconds: 2,
                })
              ).status,
              200,
            );
            const current = await readFile(path, "utf8");
            await api.stop();
            const changed = JSON.parse(current);
            changed.resource.compartments = [];
            await writeFile(path, JSON.stringify(changed));
            await api.start();
            assert.equal(
              (await api.request(`${route}/${id}`)).status,
              500,
              "unsigned resource changes must fail before authorization",
            );
            await api.stop();
            await writeFile(path, original);
            await api.start();
            assert.equal(
              (await api.request(`${route}/${id}`)).status,
              500,
              "an older signed file must not override the newest audit checkpoint",
            );
            await api.stop();
            await writeFile(path, current);
            await api.start();
            assert.equal((await api.request(`${route}/${id}`)).status, 200);
          } finally {
            await api.close();
          }
        },
      );
    }
  },
);

test(
  "library read, delivery and update fail closed after tampering, revision reset or deletion",
  { timeout: 30000 },
  async () => {
    const api = await apiFixture();
    try {
      await api.start();
      const library = seedLibrary(),
        committed = await api.request("/v1/library", "PUT", library, {
          "If-Match": "1",
        });
      assert.equal(committed.status, 200);
      const valid = (await committed.json()) as ReturnType<typeof seedLibrary>,
        path = join(api.directory, "libraries", tenantHash, "current.json"),
        changed = structuredClone(valid);
      changed.clients[0].name = "Unauthorized replacement";
      await writeFile(path, JSON.stringify(changed));
      assert.equal((await api.request("/v1/library")).status, 500);
      assert.equal(
        (await api.request("/v1/deliveries/general")).status,
        500,
        "export must not sign a library rejected by normal reads",
      );
      changed.revision = 1;
      await writeFile(path, JSON.stringify(changed));
      assert.equal(
        (await api.request("/v1/library")).status,
        500,
        "revision one does not bypass a committed digest",
      );
      assert.equal(
        (await api.request("/v1/library", "PUT", library, { "If-Match": "1" }))
          .status,
        500,
      );
      await unlink(path);
      assert.equal(
        (await api.request("/v1/library")).status,
        500,
        "missing committed storage must not silently reset to defaults",
      );
      await writeFile(path, JSON.stringify(valid));
      assert.equal((await api.request("/v1/library")).status, 200);
    } finally {
      await api.close();
    }
  },
);

test(
  "results use the source mission and verify idempotent records instead of trusting caller labels",
  { timeout: 30000 },
  async () => {
    const api = await apiFixture();
    try {
      await api.start();
      const created = await api.request("/v1/proximity", "POST", docking),
        { id } = (await created.json()) as { id: string },
        source = { kind: "relative", sourceId: id, mission: docking };
      assert.equal(
        (
          await api.request("/v1/results", "POST", {
            ...source,
            mission: transfer,
          })
        ).status,
        400,
      );
      const saved = await api.request("/v1/results", "POST", {
        ...source,
        mission: { ...docking, title: "Forged title" },
      });
      assert.equal(saved.status, 201);
      const record = (await saved.json()) as {
        missionTitle: string;
        family: string;
      };
      assert.equal(record.missionTitle, docking.title);
      assert.equal(record.family, "docking");
      const path = join(api.directory, "results", tenantHash, id + ".json"),
        tampered = JSON.parse(await readFile(path, "utf8"));
      tampered.record.score = 999;
      await writeFile(path, JSON.stringify(tampered));
      assert.equal(
        (await api.request("/v1/results", "POST", source)).status,
        500,
      );
      assert.equal((await api.request("/v1/results")).status, 500);

      const orbitalCreated = await api.request("/v1/sessions", "POST", {
        mode: "guided",
        difficulty: "standard",
        mission: transfer,
      });
      assert.equal(orbitalCreated.status, 201);
      const orbital = (await orbitalCreated.json()) as { id: string };
      assert.equal(
        (
          await api.request("/v1/results", "POST", {
            kind: "orbital",
            sourceId: orbital.id,
            mission: docking,
          })
        ).status,
        400,
      );
      const authoritative = await api.request("/v1/results", "POST", {
        kind: "orbital",
        sourceId: orbital.id,
      });
      assert.equal(authoritative.status, 201);
      assert.equal(
        ((await authoritative.json()) as { missionTitle: string }).missionTitle,
        transfer.title,
      );
    } finally {
      await api.close();
    }
  },
);

test(
  "legacy local ownership is derived from signed audit identity and upgrades without rewriting history",
  { timeout: 30000 },
  async () => {
    const api = await apiFixture();
    try {
      const id = "00000000-0000-4000-8000-000000000001",
        session = createSession(),
        log = new AuditLog(api.directory),
        receipt = log.append(
          "local-operator",
          "session.create",
          id,
          createHash("sha256").update(JSON.stringify(session)).digest("hex"),
        ),
        path = join(api.directory, "sessions", id + ".json"),
        stored = {
          session,
          resource: {
            tenant: "local",
            owner: "local-operator",
            classification: 0,
            compartments: ["training"],
          },
          receipt: { sequence: receipt.sequence, hash: receipt.hash },
        };
      await mkdir(join(api.directory, "sessions"));
      await writeFile(path, JSON.stringify(stored));
      await api.start();
      assert.equal((await api.request(`/v1/sessions/${id}`)).status, 200);
      assert.equal(
        (
          await api.request(`/v1/sessions/${id}/commands`, "POST", {
            type: "advance",
            seconds: 2,
          })
        ).status,
        200,
      );
      const upgraded = JSON.parse(await readFile(path, "utf8"));
      assert.equal(upgraded.integrityVersion, 2);
      await api.stop();
      const updatedLog = new AuditLog(api.directory).export().records;
      assert.equal(updatedLog[0].hash, receipt.hash);
      assert.equal(updatedLog.length, 2);
      upgraded.resource.owner = "different-owner";
      await writeFile(path, JSON.stringify(upgraded));
      await api.start();
      assert.equal((await api.request(`/v1/sessions/${id}`)).status, 500);
    } finally {
      await api.close();
    }
  },
);

test(
  "advanced checkpoints reject altered resource claims and unsigned replay state",
  { timeout: 30000 },
  async () => {
    const api = await apiFixture();
    try {
      await api.start();
      const created = await api.request("/v1/advanced", "POST", {
        initial: createWorkspace(),
        commands: [],
      });
      assert.equal(created.status, 201);
      const { id } = (await created.json()) as { id: string },
        path = join(api.directory, "advanced", id + ".json"),
        stored = JSON.parse(await readFile(path, "utf8"));
      stored.payload.resource.compartments = [];
      await writeFile(path, JSON.stringify(stored));
      assert.equal((await api.request("/v1/advanced/" + id)).status, 500);
      assert.equal((await api.request("/v1/advanced")).status, 500);
    } finally {
      await api.close();
    }
  },
);

function zipEntries(bytes: Buffer) {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const length = bytes.readUInt32LE(offset + 18),
      nameLength = bytes.readUInt16LE(offset + 26),
      extraLength = bytes.readUInt16LE(offset + 28),
      name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString(),
      start = offset + 30 + nameLength + extraLength;
    assert.ok(!entries.has(name), "delivery paths must be unique");
    entries.set(name, bytes.subarray(start, start + length));
    offset = start + length;
  }
  return entries;
}

test("client delivery isolates client records and verifies every bundled artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orbital-delivery-"));
  try {
    const web = join(directory, "web");
    await mkdir(web);
    await writeFile(join(web, "index.html"), "<html>Orbital</html>");
    const library = seedLibrary();
    library.clients.push({
      id: "other",
      name: "Unrelated client",
      createdAt: "2026-10-15T00:00:00.000Z",
    });
    library.missions.push({
      ...library.missions[0],
      id: "other-mission",
      clientId: "other",
      title: "Unrelated mission",
    });
    await writeFile(join(web, "orbital-library.json"), JSON.stringify(library));
    const audit = new AuditLog(join(directory, "audit")),
      entries = zipEntries(
        await clientDelivery(library, "general", web, (content) =>
          audit.signContent(content),
        ),
      ),
      manifestBytes = entries.get("manifest.json")!,
      manifest = JSON.parse(manifestBytes.toString()) as {
        files: { name: string; sha256: string }[];
      },
      signature = JSON.parse(
        entries.get("manifest-signature.json")!.toString(),
      );
    assert.equal(
      verify(
        "sha256",
        manifestBytes,
        createPublicKey(signature.publicKey),
        Buffer.from(signature.signature, "base64"),
      ),
      true,
    );
    assert.equal(manifest.files.length, entries.size - 2);
    for (const file of manifest.files)
      assert.equal(
        createHash("sha256").update(entries.get(file.name)!).digest("hex"),
        file.sha256,
      );
    const bundled = JSON.parse(
      entries.get("orbital-library.json")!.toString(),
    ) as ReturnType<typeof seedLibrary>;
    assert.deepEqual(
      bundled.clients.map((client) => client.id),
      ["general"],
    );
    assert.ok(
      bundled.missions.every((mission) => mission.clientId === "general"),
    );
    assert.ok(
      !entries.get("orbital-library.json")!.toString().includes("Unrelated"),
    );
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep))
      throw Error("Unsafe test cleanup");
    await rm(directory, { recursive: true, force: true });
  }
});

test("archive paths reject Windows drive paths, streams, reserved names and duplicate extraction targets", () => {
  for (const name of [
    "",
    "/absolute",
    "C:/secret.txt",
    "file.txt:stream",
    "folder\\file",
    "../escape",
    "a/../escape",
    "a//file",
    "a/./file",
    "NUL.txt",
    "folder/COM1",
    "trailing. ",
    "file\0.txt",
  ]) {
    assert.throws(
      () => zip([{ name, data: Buffer.from("test") }]),
      /Unsafe/,
      name,
    );
  }
  assert.throws(
    () =>
      zip([
        { name: "a.txt", data: Buffer.from("a") },
        { name: "A.TXT", data: Buffer.from("b") },
      ]),
    /Duplicate/,
  );
});

test("publication rejects credential filenames and recognizable private material", () => {
  for (const name of [
    ".env",
    ".env.local",
    "apps/api/.env.production",
    "infra/service-account.json",
    "private.pem",
    "key.pfx",
    "infra/terraform.tfstate.backup",
    "id_ed25519",
    "secrets.yaml",
    ".npmrc",
  ]) {
    assert.throws(
      () => assertPublishableFile(name, Buffer.from("example")),
      /Credential/,
      name,
    );
  }
  const pem = ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
    token = "ghp_" + "a".repeat(36);
  assert.throws(
    () => assertPublishableFile("config.txt", Buffer.from(pem)),
    /Credential material/,
  );
  assert.throws(
    () =>
      assertPublishableFile(
        "config.json",
        Buffer.from(JSON.stringify({ token })),
      ),
    /Credential material/,
  );
  assert.doesNotThrow(() =>
    assertPublishableFile(
      "publication/technical-paper.md",
      Buffer.from("Reproducible mission report"),
    ),
  );
});

test(
  "advanced mission API owns client snapshots, serializes commands and rejects persisted tampering",
  { timeout: 90000 },
  async () => {
    const api = await apiFixture();
    type Envelope = {
      id: string;
      mission: typeof docking;
      session: AdvancedMissionSession;
      sequence: number;
      digest: string;
    };
    try {
      await api.start();
      const custom = {
          ...docking,
          id: "client-docking",
          clientId: "client-a",
          title: "Client precision approach",
          initialRange: 180,
          tolerance: 0.4,
          closingSpeed: 0.03,
        },
        scenario = scenarioFromMission(custom);
      scenario.holdPoints = [80, 12, 0.2];
      scenario.holdTolerance = 0.03;
      scenario.chaser.mass = 800;
      scenario.chaser.dryMass = 650;
      const library = seedLibrary();
      library.clients.push({
        id: "client-a",
        name: "Client A",
        createdAt: "2026-10-16T00:00:00.000Z",
      });
      library.missions.push({ ...custom, advanced: scenario });
      assert.equal(
        (await api.request("/v1/library", "PUT", library, { "If-Match": "1" }))
          .status,
        200,
      );
      const reference = { missionId: custom.id, revision: custom.revision };
      assert.equal(
        (
          await api.request("/v1/mission-runs", "POST", {
            ...reference,
            missionId: "missing",
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await api.request("/v1/mission-runs", "POST", {
            ...reference,
            revision: 2,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await api.request("/v1/mission-runs", "POST", {
            ...reference,
            clientId: "other-client",
          })
        ).status,
        400,
      );
      const created = await api.request("/v1/mission-runs", "POST", reference);
      assert.equal(created.status, 201);
      const original = (await created.json()) as Envelope,
        route = "/v1/mission-runs/" + original.id,
        path = join(
          api.directory,
          "mission-runs",
          tenantHash,
          original.id + ".json",
        ),
        originalBytes = await readFile(path, "utf8");
      assert.equal(original.mission.clientId, "client-a");
      assert.equal(original.session.scenario.chaser.mass, 800);
      assert.deepEqual(original.session.scenario.holdPoints, [80, 12, 0.2]);
      assert.equal(
        (
          await api.request(route + "/commands", "POST", {
            sequence: 0,
            command: { type: "capture" },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          (await api
            .request(route)
            .then((response) => response.json())) as Envelope
        ).digest,
        original.digest,
        "a failed command must not alter state or receipt",
      );
      const concurrent = await Promise.all(
        [0, 1].map(() =>
          api.request(route + "/commands", "POST", {
            sequence: 0,
            command: { type: "advance", seconds: 2 },
          }),
        ),
      );
      assert.deepEqual(
        concurrent.map((response) => response.status).sort(),
        [200, 409],
      );
      let current = (await (await api.request(route)).json()) as Envelope;
      assert.equal(current.sequence, 1);
      assert.equal(current.session.workspace.time, 2);
      for (let waypoint = 0; waypoint < 3; waypoint++) {
        const guided = await api.request(route + "/commands", "POST", {
          sequence: current.sequence,
          command: { type: "guide", waypoint },
        });
        assert.equal(guided.status, 200);
        current = (await guided.json()) as Envelope;
      }
      const capture = await api.request(route + "/commands", "POST", {
        sequence: current.sequence,
        command: { type: "capture" },
      });
      assert.equal(capture.status, 200);
      current = (await capture.json()) as Envelope;
      assert.equal(current.session.state.captured, true);
      const report = (await (await api.request(route + "/report")).json()) as {
        report: { complete: boolean; score: number };
      };
      assert.equal(report.report.complete, true);
      assert.equal(report.report.score, 100);
      assert.equal(
        (
          await api.request(route + "/commands", "POST", {
            sequence: current.sequence,
            command: { type: "advance", seconds: 2 },
          })
        ).status,
        409,
      );
      const list = (await (await api.request("/v1/mission-runs")).json()) as {
        runs: { mission: { clientId: string } }[];
      };
      assert.equal(list.runs.length, 1);
      assert.equal(list.runs[0].mission.clientId, "client-a");
      const validBytes = await readFile(path, "utf8");
      await api.stop();
      await api.start();
      assert.deepEqual(await (await api.request(route)).json(), current);
      const tampered = JSON.parse(validBytes);
      tampered.payload.mission.clientId = "other-client";
      await writeFile(path, JSON.stringify(tampered));
      assert.equal(
        (await api.request(route)).status,
        500,
        "cached sessions do not bypass current file signature verification",
      );
      await writeFile(path, originalBytes);
      assert.equal(
        (await api.request(route)).status,
        500,
        "an older valid signed mission record is rejected as rollback",
      );
      await writeFile(path, validBytes);
      assert.equal((await api.request(route)).status, 200);
      await unlink(path);
      assert.equal((await api.request(route)).status, 500);
      assert.equal(
        (await api.request("/v1/mission-runs")).status,
        500,
        "committed runs cannot disappear from the signed run index",
      );
    } finally {
      await api.close();
    }
  },
);
