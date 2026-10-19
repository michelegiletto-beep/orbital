import type { IncomingMessage } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  authorize,
  type AuditLog,
  type Identity,
  type Resource,
} from "../../../packages/security/src/index.js";
import {
  validateMission,
  type Library,
  type Mission,
} from "../../../packages/library/src/index.js";
import {
  advancedMissionCommand,
  advancedMissionReport,
  createAdvancedMission,
  parseAdvancedMissionCommand,
  replayAdvancedMission,
  scenarioFromMission,
  validateAdvancedMissionScenario,
  type AdvancedMissionSession,
  type AdvancedMissionScenario,
  type MissionJournalEntry,
} from "../../../packages/sim-core/src/missions.js";

type Receipt = { sequence: number; hash: string };
type MissionPayload = {
  schema: "orbital.mission.record.v1";
  resource: Resource;
  mission: Mission;
  scenario: AdvancedMissionScenario;
  journal: MissionJournalEntry[];
  report: ReturnType<typeof advancedMissionReport>;
};
type StoredMission = { payload: MissionPayload; receipt: Receipt };
type JSONResponse = (status: number, payload: unknown) => void;
type Dependencies = {
  data: string;
  audit: AuditLog;
  body: (req: IncomingMessage, limit?: number) => Promise<any>;
  exclusive: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  loadVerifiedLibrary: (tenantHash: string) => Promise<Library>;
};
const digest = (input: unknown) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
const tenantDigest = (tenant: string) =>
  createHash("sha256").update(tenant).digest("hex");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object = (input: unknown, keys: string[]) =>
  !!input &&
  typeof input === "object" &&
  !Array.isArray(input) &&
  Object.keys(input).every((k) => keys.includes(k));

/** All mission commands are applied to authoritative, replayable server state. */
export function createMissionRoutes(dependencies: Dependencies) {
  const { data, audit, body, exclusive, loadVerifiedLibrary } = dependencies;
  const cache = new Map<
    string,
    { digest: string; session: AdvancedMissionSession }
  >();
  const namespace = (tenantHash: string, id: string) =>
    `mission:${tenantHash}:${id}`;
  const location = (tenantHash: string, id: string) =>
    join(data, "mission-runs", tenantHash, `${id}.json`);
  const actions = ["mission.create", "mission.command"];

  function verify(tenantHash: string, id: string, stored: StoredMission) {
    if (
      !stored ||
      !stored.payload ||
      stored.payload.schema !== "orbital.mission.record.v1" ||
      !stored.receipt
    )
      throw Error("Mission record integrity check failed");
    const records = audit.export().records,
      key = namespace(tenantHash, id),
      receipt = records[stored.receipt.sequence],
      latest = [...records]
        .reverse()
        .find((r) => r.resource === key && actions.includes(r.action)),
      hash = digest(stored.payload);
    if (
      !receipt ||
      !latest ||
      receipt.hash !== stored.receipt.hash ||
      latest.hash !== receipt.hash ||
      receipt.resource !== key ||
      !actions.includes(receipt.action) ||
      receipt.detail !== hash ||
      receipt.subject !== stored.payload.resource?.owner ||
      tenantDigest(stored.payload.resource.tenant) !== tenantHash
    )
      throw Error("Mission record signature or rollback check failed");
    return hash;
  }
  async function loadRecord(tenantHash: string, id: string) {
    if (!uuid.test(id)) throw Error("Not found");
    let stored: StoredMission;
    try {
      stored = JSON.parse(await readFile(location(tenantHash, id), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const committed = audit
          .export()
          .records.some(
            (r) =>
              r.resource === namespace(tenantHash, id) &&
              actions.includes(r.action),
          );
        if (committed) throw Error("Committed mission record is missing");
        throw Error("Not found");
      }
      throw error;
    }
    return { stored, hash: verify(tenantHash, id, stored) };
  }
  async function load(
    tenantHash: string,
    id: string,
    record?: Awaited<ReturnType<typeof loadRecord>>,
  ) {
    const { stored, hash } = record ?? (await loadRecord(tenantHash, id)),
      key = namespace(tenantHash, id);
    let session =
      cache.get(key)?.digest === hash ? cache.get(key)!.session : undefined;
    if (!session) {
      const mission = validateMission(stored.payload.mission),
        scenario = validateAdvancedMissionScenario(stored.payload.scenario);
      if (
        JSON.stringify(scenarioFromMission(mission)) !==
        JSON.stringify(scenario)
      )
        throw Error(
          "Mission scenario does not match its signed library snapshot",
        );
      session = replayAdvancedMission(scenario, stored.payload.journal);
      if (
        JSON.stringify(advancedMissionReport(session)) !==
        JSON.stringify(stored.payload.report)
      )
        throw Error("Mission evaluation replay check failed");
      if (cache.size >= 256) cache.delete(cache.keys().next().value!);
      cache.set(key, { digest: hash, session });
    }
    return { stored, session, hash };
  }
  async function save(
    tenantHash: string,
    id: string,
    payload: MissionPayload,
    session: AdvancedMissionSession,
    action: string,
  ) {
    const directory = join(data, "mission-runs", tenantHash);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const hash = digest(payload),
      record = audit.append(
        payload.resource.owner,
        action,
        namespace(tenantHash, id),
        hash,
      ),
      receipt = { sequence: record.sequence, hash: record.hash },
      stored = { payload, receipt },
      temp = join(directory, `${id}.${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(stored), { mode: 0o600, flush: true });
    await rename(temp, location(tenantHash, id));
    if (cache.size >= 256 && !cache.has(namespace(tenantHash, id)))
      cache.delete(cache.keys().next().value!);
    cache.set(namespace(tenantHash, id), { digest: hash, session });
    return { stored, session, hash };
  }
  const envelope = (id: string, value: Awaited<ReturnType<typeof load>>) => ({
    id,
    mission: value.stored.payload.mission,
    session: value.session,
    sequence: value.session.journal.length,
    receipt: value.stored.receipt,
    digest: value.hash,
  });
  const deny = (json: JSONResponse) => {
    json(403, { error: "Access denied" });
    return true;
  };

  return async function missionRoutes(
    req: IncomingMessage,
    url: URL,
    user: Identity,
    json: JSONResponse,
  ): Promise<boolean> {
    const path = url.pathname;
    if (path !== "/v1/mission-runs" && !path.startsWith("/v1/mission-runs/"))
      return false;
    const tenantHash = tenantDigest(user.tenant);
    const policy: Resource = {
      tenant: user.tenant,
      owner: user.subject,
      classification: 0,
      compartments: ["training"],
    };
    if (path === "/v1/mission-runs") {
      if (req.method === "POST") {
        if (!authorize(user, "operate", policy)) return deny(json);
        const input = await body(req);
        if (
          !object(input, ["missionId", "revision"]) ||
          typeof input.missionId !== "string" ||
          input.missionId.length > 80 ||
          !Number.isInteger(input.revision) ||
          input.revision < 1
        ) {
          json(400, { error: "Invalid mission reference" });
          return true;
        }
        return exclusive(`mission-create:${tenantHash}`, async () => {
          const records = audit
            .export()
            .records.filter(
              (r) =>
                r.resource.startsWith(`mission:${tenantHash}:`) &&
                r.action === "mission.create",
            );
          if (records.length >= 1000) {
            json(409, { error: "Mission run capacity reached" });
            return true;
          }
          const library = await loadVerifiedLibrary(tenantHash),
            mission = library.missions.find((m) => m.id === input.missionId);
          if (!mission) {
            json(404, {
              error: "Mission not found in the current client library",
            });
            return true;
          }
          if (mission.revision !== input.revision) {
            json(409, {
              error:
                "Mission revision changed. Reload the library before launching",
            });
            return true;
          }
          let session: AdvancedMissionSession;
          try {
            session = createAdvancedMission(mission);
          } catch (error) {
            json(400, { error: (error as Error).message });
            return true;
          }
          const id = randomUUID(),
            payload: MissionPayload = {
              schema: "orbital.mission.record.v1",
              resource: policy,
              mission: structuredClone(mission),
              scenario: session.scenario,
              journal: [],
              report: advancedMissionReport(session),
            };
          const saved = await exclusive(namespace(tenantHash, id), () =>
            save(tenantHash, id, payload, session, "mission.create"),
          );
          json(201, envelope(id, saved));
          return true;
        });
      }
      if (req.method !== "GET") {
        json(405, { error: "Method not allowed" });
        return true;
      }
      if (!authorize(user, "read", policy)) return deny(json);
      const committed = new Set(
        audit
          .export()
          .records.filter(
            (r) =>
              r.resource.startsWith(`mission:${tenantHash}:`) &&
              actions.includes(r.action),
          )
          .map((r) => r.resource.split(":").at(-1)!),
      );
      let files: string[] = [];
      try {
        files = (await readdir(join(data, "mission-runs", tenantHash))).filter(
          (f) => f.endsWith(".json"),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      for (const file of files) committed.add(file.slice(0, -5));
      if (committed.size > 1000)
        throw Error("Mission run index exceeds limits");
      const runs = [];
      for (const id of committed) {
        const value = await exclusive(namespace(tenantHash, id), () =>
          loadRecord(tenantHash, id),
        );
        if (!authorize(user, "read", value.stored.payload.resource)) continue;
        runs.push({
          id,
          mission: value.stored.payload.mission,
          sequence: value.stored.payload.journal.length,
          receipt: value.stored.receipt,
          updatedAt:
            audit.export().records[value.stored.receipt.sequence].timestamp,
          report: value.stored.payload.report,
        });
      }
      runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      json(200, { runs });
      return true;
    }
    const match = /^\/v1\/mission-runs\/([^/]+)(?:\/(commands|report))?$/.exec(
      path,
    );
    if (!match || !uuid.test(match[1])) {
      json(404, { error: "Not found" });
      return true;
    }
    const [, id, suffix] = match;
    return exclusive(namespace(tenantHash, id), async () => {
      const record = await loadRecord(tenantHash, id);
      if (
        !authorize(
          user,
          suffix === "commands" ? "operate" : "read",
          record.stored.payload.resource,
        )
      )
        return deny(json);
      const value = await load(tenantHash, id, record);
      if (!suffix && req.method === "GET") {
        json(200, envelope(id, value));
        return true;
      }
      if (suffix === "report" && req.method === "GET") {
        json(200, {
          id,
          mission: value.stored.payload.mission,
          sequence: value.session.journal.length,
          receipt: value.stored.receipt,
          report: advancedMissionReport(value.session),
        });
        return true;
      }
      if (suffix !== "commands" || req.method !== "POST") {
        json(405, { error: "Method not allowed" });
        return true;
      }
      const input = await body(req);
      if (
        !object(input, ["sequence", "command"]) ||
        !Number.isInteger(input.sequence) ||
        input.sequence < 0
      ) {
        json(400, { error: "Invalid command envelope" });
        return true;
      }
      if (input.sequence !== value.session.journal.length) {
        json(409, {
          error:
            "Mission state changed. Reload the run before issuing another command",
          sequence: value.session.journal.length,
        });
        return true;
      }
      if (
        value.session.state.captured ||
        value.session.state.collision ||
        value.session.state.entry ||
        value.session.state.aborted
      ) {
        json(409, { error: "Mission has terminated" });
        return true;
      }
      let session: AdvancedMissionSession;
      try {
        session = advancedMissionCommand(
          value.session,
          parseAdvancedMissionCommand(input.command),
        );
      } catch (error) {
        json(400, { error: (error as Error).message });
        return true;
      }
      // Revalidate the fresh identity after a potentially long integration before committing a write.
      if (!authorize(user, "operate", value.stored.payload.resource))
        return deny(json);
      const payload: MissionPayload = {
        ...value.stored.payload,
        journal: session.journal,
        report: advancedMissionReport(session),
      };
      const saved = await save(
        tenantHash,
        id,
        payload,
        session,
        "mission.command",
      );
      json(200, envelope(id, saved));
      return true;
    });
  };
}
