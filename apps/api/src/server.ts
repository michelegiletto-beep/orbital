import { createServer, type IncomingMessage } from "node:http";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, mkdir, writeFile, rename, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { WebSocketServer } from "ws";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import {
  createSession,
  execute,
  replay,
  report,
  MODEL,
  validateConfiguration,
  type Session,
} from "../../../packages/sim-core/src/index.js";
import {
  seedLibrary,
  validateLibrary,
  validateMission,
  type Library,
  type Mission,
} from "../../../packages/library/src/index.js";
import {
  relativeSession,
  relativeExecute,
  relativeReplay,
  relativeReport,
  parseRelativeCommand,
  type RelativeSession,
} from "../../../packages/sim-core/src/proximity.js";
import { clientDelivery } from "../../../packages/delivery/src/index.js";
import { parseCommand } from "../../../packages/contracts/src/index.js";
import {
  AuditLog,
  authorize,
  verifyTokenIdentity,
  type Identity,
  type Resource,
} from "../../../packages/security/src/index.js";
import { startTelemetry } from "./telemetry.js";
import { createMissionRoutes } from "./mission-routes.js";
import {
  replayArchive,
  orbitalMetrics,
  type FlightArchive,
  type Workspace,
} from "../../../packages/sim-core/src/advanced.js";

const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 4318),
  host = process.env.HOST ?? "127.0.0.1";
const issuer = process.env.OIDC_ISSUER,
  audience = process.env.OIDC_AUDIENCE;
if (production && (!issuer || !audience || !process.env.OIDC_JWKS_URI))
  throw new Error("Production requires OIDC configuration");
if (!production && host !== "127.0.0.1" && host !== "::1")
  throw new Error("Development mode must bind to loopback");
const jwksURI = process.env.OIDC_JWKS_URI;
if (jwksURI && new URL(jwksURI).protocol !== "https:")
  throw new Error("OIDC JWKS requires HTTPS");
const jwks = jwksURI
  ? createRemoteJWKSet(new URL(jwksURI), {
      timeoutDuration: 4000,
      cooldownDuration: 60000,
    })
  : null;
const authorizationEndpoint = process.env.OIDC_AUTHORIZATION_ENDPOINT,
  tokenEndpoint = process.env.OIDC_TOKEN_ENDPOINT,
  clientId = process.env.OIDC_CLIENT_ID,
  clientSecret = process.env.OIDC_CLIENT_SECRET,
  redirectURI = process.env.OIDC_REDIRECT_URI;
const bffConfigured = !!(
  authorizationEndpoint &&
  tokenEndpoint &&
  clientId &&
  clientSecret &&
  redirectURI
);
if (
  [authorizationEndpoint, tokenEndpoint, redirectURI].some(
    (value) => value && new URL(value).protocol !== "https:",
  )
)
  throw new Error("OIDC browser endpoints require HTTPS");
const loginTransactions = new Map<
  string,
  { verifier: string; nonce: string; expires: number }
>();
const browserSessions = new Map<
  string,
  { token: string; expires: number; lastActivity: number }
>();
const cookie = (req: IncomingMessage, name: string) =>
  req.headers.cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + "="))
    ?.slice(name.length + 1);
const setCookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/v1; Max-Age=${maxAge}`;
const origin = process.env.WEB_ORIGIN ?? "http://127.0.0.1:4317";
const data = process.env.DATA_DIR ?? ".data";
const audit = new AuditLog(data, production);
const telemetry = startTelemetry();
type Stored = {
  session: Session;
  resource: Resource;
  integrityVersion?: 2;
  mission?: Mission;
  receipt: { sequence: number; hash: string };
};
const digestValue = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const storedDigest = (
  stored: Pick<Stored, "session" | "resource" | "mission">,
) =>
  digestValue({
    integrityVersion: 2,
    session: stored.session,
    resource: stored.resource,
    ...(stored.mission ? { mission: stored.mission } : {}),
  });
const sessions = new Map<string, Stored>();
const rate = new Map<string, { at: number; count: number }>();
const connections = new Map<string, Set<import("ws").WebSocket>>();
type RelativeStored = {
  session: RelativeSession;
  resource: Resource;
  integrityVersion?: 2;
  receipt: { sequence: number; hash: string };
};
const relativeSessions = new Map<string, RelativeStored>();
const relativeStoredDigest = (
  stored: Pick<RelativeStored, "session" | "resource">,
) =>
  digestValue({
    integrityVersion: 2,
    session: stored.session,
    resource: stored.resource,
  });
function verifyStoredReceipt(
  id: string,
  stored: Stored | RelativeStored,
  relative = false,
) {
  const records = audit.export().records,
    receipt = records[stored.receipt?.sequence],
    actions = relative
      ? ["proximity.create", "proximity.accept"]
      : ["session.create", "command.accept"],
    latest = [...records]
      .reverse()
      .find(
        (record) => record.resource === id && actions.includes(record.action),
      );
  if (
    !receipt ||
    !latest ||
    receipt.hash !== stored.receipt.hash ||
    receipt.hash !== latest.hash ||
    receipt.resource !== id ||
    !actions.includes(receipt.action)
  )
    throw Error("Session receipt integrity check failed");
  if (stored.integrityVersion === 2) {
    const digest = relative
      ? relativeStoredDigest(stored as RelativeStored)
      : storedDigest(stored as Stored);
    if (receipt.detail !== digest || receipt.subject !== stored.resource.owner)
      throw Error("Session signature check failed");
    return;
  }
  // Legacy local ownership is derived from the signed subject and fixed local policy.
  // A production tenant cannot be inferred from legacy unsigned resource metadata.
  const localResource: Resource = {
    tenant: "local",
    owner: "local-operator",
    classification: 0,
    compartments: ["training"],
  };
  if (
    stored.integrityVersion !== undefined ||
    production ||
    jwks ||
    receipt.subject !== localResource.owner ||
    JSON.stringify(stored.resource) !== JSON.stringify(localResource) ||
    ("mission" in stored && stored.mission !== undefined) ||
    receipt.detail !== digestValue(stored.session)
  )
    throw Error("Legacy session integrity requires verified migration");
  stored.resource = localResource;
}
function missionConfiguration(mission: Mission) {
  return validateConfiguration({
    initialAltitude: mission.initialAltitude,
    targetAltitude: mission.targetAltitude,
    inclination: mission.inclination,
    tolerance: mission.tolerance,
    budget: mission.budget,
    family: mission.family,
  });
}
function sameMissionIdentity(a: Mission, b: Mission) {
  return (
    a.id === b.id && a.clientId === b.clientId && a.revision === b.revision
  );
}
async function loadVerifiedLibrary(tenantHash: string): Promise<Library> {
  const latest = audit
    .export()
    .records.reverse()
    .find(
      (record) =>
        record.action === "library.commit" && record.resource === tenantHash,
    );
  let library: Library;
  try {
    library = validateLibrary(
      JSON.parse(
        await readFile(
          join(data, "libraries", tenantHash, "current.json"),
          "utf8",
        ),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (latest)
      throw Error("Library integrity check failed: committed library missing");
    return seedLibrary();
  }
  if (
    latest
      ? latest.detail !== digestValue(library)
      : JSON.stringify(library) !== JSON.stringify(seedLibrary())
  )
    throw Error("Library integrity check failed");
  return library;
}
async function identity(req: IncomingMessage): Promise<Identity> {
  if (!production && !jwks)
    return {
      subject: "local-operator",
      roles: ["operator", "designer"],
      tenant: "local",
      clearance: 0,
      compartments: ["training"],
      mfa: true,
      expires: Date.now() / 1000 + 3600,
    };
  let auth = req.headers.authorization;
  if (!auth) {
    const handle = cookie(req, "orbital_session"),
      session = handle ? browserSessions.get(handle) : null;
    if (
      session &&
      session.expires > Date.now() &&
      Date.now() - session.lastActivity < 900000
    ) {
      auth = "Bearer " + session.token;
      session.lastActivity = Date.now();
    } else if (handle) browserSessions.delete(handle);
  }
  if (!auth?.startsWith("Bearer ") || !jwks) throw new Error("Unauthorized");
  if (!issuer || !audience) throw Error("Unauthorized");
  return verifyTokenIdentity(auth.slice(7), jwks, issuer, audience);
}
async function body(req: IncomingMessage, limit = 16384) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Error("Content type must be application/json");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function persist(id: string, stored: Stored) {
  await mkdir(join(data, "sessions"), { recursive: true, mode: 0o700 });
  const path = join(data, "sessions", id + ".json"),
    temp = path + ".tmp";
  await writeFile(temp, JSON.stringify(stored), { mode: 0o600 });
  await rename(temp, path);
}
async function getSession(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Not found");
  if (!sessions.has(id)) {
    let stored: Stored;
    try {
      stored = JSON.parse(
        await readFile(join(data, "sessions", id + ".json"), "utf8"),
      );
    } catch {
      throw new Error("Not found");
    }
    if (
      JSON.stringify(replay(stored.session.initial, stored.session.events)) !==
      JSON.stringify(stored.session.state)
    )
      throw new Error("Session integrity check failed");
    verifyStoredReceipt(id, stored);
    sessions.set(id, stored);
  }
  return sessions.get(id)!;
}
async function getRelativeSession(id: string): Promise<RelativeStored> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw Error("Not found");
  if (!relativeSessions.has(id)) {
    let stored: RelativeStored;
    try {
      stored = JSON.parse(
        await readFile(join(data, "proximity", id + ".json"), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw Error("Not found");
      throw error;
    }
    verifyStoredReceipt(id, stored, true);
    const replayed = relativeReplay(
      stored.session.mission,
      stored.session.events,
    );
    if (JSON.stringify(replayed.state) !== JSON.stringify(stored.session.state))
      throw Error("Relative replay integrity check failed");
    relativeSessions.set(id, stored);
  }
  return relativeSessions.get(id)!;
}
const locks = new Map<string, Promise<void>>();
async function exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const next = prior.then(() => gate);
  locks.set(id, next);
  await prior;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(id) === next) locks.delete(id);
  }
}
const missionRoutes = createMissionRoutes({
  data,
  audit,
  body,
  exclusive,
  loadVerifiedLibrary,
});
export const server = createServer(async (req, res) => {
  const started = performance.now(),
    requestId = randomUUID();
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const json = (status: number, value: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const span = trace.getTracer("orbital-api").startSpan("request");
  try {
    if (req.headers.origin && req.headers.origin !== origin) {
      json(403, { error: "Origin denied" });
      return;
    }
    const remote = req.socket.remoteAddress ?? "unknown",
      now = Date.now();
    if (rate.size > 10000)
      for (const [key, value] of rate)
        if (now - value.at > 60000) rate.delete(key);
    const bucket = rate.get(remote) ?? { at: now, count: 0 };
    if (now - bucket.at > 60000) {
      bucket.at = now;
      bucket.count = 0;
    }
    bucket.count++;
    rate.set(remote, bucket);
    if (bucket.count > 180) {
      json(429, { error: "Rate limit exceeded" });
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (url.pathname === "/health" && req.method === "GET") {
      json(200, { status: "ok", model: MODEL.version });
      return;
    }
    if (url.pathname === "/v1/config" && req.method === "GET") {
      json(200, {
        auth: production || jwks ? "oidc" : "local",
        loginConfigured: bffConfigured,
        model: MODEL.version,
      });
      return;
    }
    if (url.pathname === "/v1/auth/session" && req.method === "GET") {
      try {
        const user = await identity(req);
        json(200, { authenticated: true, subject: user.subject });
      } catch {
        json(200, { authenticated: false });
      }
      return;
    }
    if (url.pathname === "/v1/auth/login" && req.method === "GET") {
      if (!bffConfigured) {
        json(503, { error: "Browser SSO is not configured" });
        return;
      }
      for (const [key, value] of loginTransactions)
        if (value.expires < Date.now()) loginTransactions.delete(key);
      if (loginTransactions.size >= 1000) {
        json(503, { error: "Login capacity reached" });
        return;
      }
      const state = randomBytes(32).toString("base64url"),
        verifier = randomBytes(48).toString("base64url"),
        nonce = randomBytes(32).toString("base64url");
      loginTransactions.set(state, {
        verifier,
        nonce,
        expires: Date.now() + 300000,
      });
      res.setHeader("Set-Cookie", setCookie("orbital_login", state, 300));
      const destination = new URL(authorizationEndpoint!);
      for (const [key, value] of Object.entries({
        client_id: clientId!,
        redirect_uri: redirectURI!,
        response_type: "code",
        scope: "openid",
        state,
        nonce,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        acr_values: process.env.OIDC_MFA_ACR ?? "urn:orbital:mfa",
      }))
        destination.searchParams.set(key, value);
      res.writeHead(302, { Location: destination.href });
      res.end();
      return;
    }
    if (url.pathname === "/v1/auth/callback" && req.method === "GET") {
      const state = url.searchParams.get("state"),
        code = url.searchParams.get("code"),
        transaction = state ? loginTransactions.get(state) : null;
      if (
        !bffConfigured ||
        !state ||
        !code ||
        !transaction ||
        transaction.expires < Date.now() ||
        cookie(req, "orbital_login") !== state
      ) {
        json(401, { error: "Invalid login transaction" });
        return;
      }
      loginTransactions.delete(state);
      const response = await fetch(tokenEndpoint!, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: clientId!,
          client_secret: clientSecret!,
          redirect_uri: redirectURI!,
          code_verifier: transaction.verifier,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Unauthorized");
      const tokens = (await response.json()) as {
        access_token?: string;
        id_token?: string;
        expires_in?: number;
      };
      if (!tokens.access_token || !tokens.id_token)
        throw new Error("Unauthorized");
      const idToken = await jwtVerify(tokens.id_token, jwks!, {
        issuer,
        audience: clientId,
        algorithms: ["RS256", "ES256"],
        clockTolerance: 5,
      });
      if (idToken.payload.nonce !== transaction.nonce)
        throw new Error("Unauthorized");
      const original = req.headers.authorization;
      req.headers.authorization = "Bearer " + tokens.access_token;
      const user = await identity(req);
      req.headers.authorization = original;
      if (idToken.payload.sub !== user.subject) throw new Error("Unauthorized");
      for (const [key, value] of browserSessions)
        if (value.expires < Date.now()) browserSessions.delete(key);
      if (browserSessions.size >= 1000) {
        json(503, { error: "Session capacity reached" });
        return;
      }
      const handle = randomBytes(32).toString("base64url"),
        expires = Math.min(user.expires * 1000, Date.now() + 900000);
      browserSessions.set(handle, {
        token: tokens.access_token,
        expires,
        lastActivity: Date.now(),
      });
      audit.append(user.subject, "auth.login", "identity", "MFA verified");
      res.setHeader("Set-Cookie", [
        setCookie(
          "orbital_session",
          handle,
          Math.floor((expires - Date.now()) / 1000),
        ),
        setCookie("orbital_login", "", 0),
      ]);
      res.writeHead(302, { Location: origin });
      res.end();
      return;
    }
    if (url.pathname === "/v1/auth/logout" && req.method === "POST") {
      if (req.headers.origin !== origin) {
        json(403, { error: "Origin required" });
        return;
      }
      const handle = cookie(req, "orbital_session");
      if (handle) browserSessions.delete(handle);
      res.setHeader("Set-Cookie", setCookie("orbital_session", "", 0));
      json(200, { authenticated: false });
      return;
    }
    if (
      req.method === "POST" &&
      cookie(req, "orbital_session") &&
      req.headers.origin !== origin
    ) {
      json(403, { error: "Origin required" });
      return;
    }
    const user = await identity(req);
    if (await missionRoutes(req, url, user, json)) return;
    if (url.pathname === "/v1/results") {
      if (!user.compartments.includes("training")) {
        json(403, { error: "Access denied" });
        return;
      }
      const tenantHash = createHash("sha256").update(user.tenant).digest("hex"),
        directory = join(data, "results", tenantHash);
      if (req.method === "GET") {
        let names: string[] = [];
        try {
          names = (await readdir(directory))
            .filter((n) => /^[0-9a-f-]{36}\.json$/.test(n))
            .slice(0, 1000);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const records = await Promise.all(
          names.map(async (name) => {
            const saved = JSON.parse(
              await readFile(join(directory, name), "utf8"),
            ) as {
              owner: string;
              record: { id: string };
              receipt: { sequence: number; hash: string };
            };
            const receipt = audit.export().records[saved.receipt.sequence];
            if (
              !receipt ||
              receipt.hash !== saved.receipt.hash ||
              receipt.subject !== saved.owner ||
              receipt.resource !== saved.record.id ||
              receipt.detail !==
                createHash("sha256")
                  .update(JSON.stringify(saved.record))
                  .digest("hex")
            )
              throw Error("Result integrity check failed");
            return saved;
          }),
        );
        json(
          200,
          records
            .filter(
              (r) =>
                r.owner === user.subject ||
                user.roles.includes("instructor") ||
                user.roles.includes("designer"),
            )
            .map((r) => r.record),
        );
        return;
      }
      if (req.method !== "POST") {
        json(405, { error: "Method not allowed" });
        return;
      }
      const input = await body(req);
      if (
        !input ||
        !["orbital", "relative"].includes(input.kind) ||
        typeof input.sourceId !== "string" ||
        !/^[0-9a-f-]{36}$/.test(input.sourceId)
      ) {
        json(400, { error: "Invalid result source" });
        return;
      }
      let requestedMission: Mission | undefined;
      try {
        if (input.mission !== undefined)
          requestedMission = validateMission(input.mission);
      } catch {
        json(400, { error: "Invalid mission" });
        return;
      }
      let mission: Mission;
      let resource: Resource,
        payload: unknown,
        evaluation: { score: number; complete: boolean };
      if (input.kind === "orbital") {
        const source = await getSession(input.sourceId);
        resource = source.resource;
        if (source.mission) mission = source.mission;
        else {
          const library = await loadVerifiedLibrary(
            createHash("sha256").update(user.tenant).digest("hex"),
          );
          const candidate =
            requestedMission &&
            library.missions.find((m) =>
              sameMissionIdentity(m, requestedMission!),
            );
          if (
            !candidate ||
            !["transfer", "deorbit"].includes(candidate.family) ||
            JSON.stringify(missionConfiguration(candidate)) !==
              JSON.stringify(source.session.configuration)
          ) {
            json(400, { error: "Invalid mission identity for source session" });
            return;
          }
          mission = candidate;
        }
        evaluation = report(source.session);
        payload = {
          mission,
          session: source.session,
          evaluation,
          serverId: input.sourceId,
        };
      } else {
        const source = await getRelativeSession(input.sourceId);
        mission = source.session.mission;
        resource = source.resource;
        evaluation = relativeReport(source.session);
        payload = {
          mission: source.session.mission,
          session: { ...source.session, track: undefined },
          assessment: evaluation,
          serverId: input.sourceId,
        };
      }
      if (requestedMission && !sameMissionIdentity(requestedMission, mission)) {
        json(400, { error: "Invalid mission identity for source session" });
        return;
      }
      if (!authorize(user, "operate", resource)) {
        json(403, { error: "Access denied" });
        return;
      }
      const path = join(directory, input.sourceId + ".json");
      await exclusive("result-" + input.sourceId, async () => {
        try {
          const previous = JSON.parse(await readFile(path, "utf8"));
          const previousReceipt =
            audit.export().records[previous.receipt?.sequence];
          if (
            !previousReceipt ||
            previousReceipt.hash !== previous.receipt.hash ||
            previousReceipt.action !== "result.save" ||
            previousReceipt.resource !== input.sourceId ||
            previousReceipt.subject !== previous.owner ||
            previousReceipt.detail !== digestValue(previous.record)
          )
            throw Error("Result integrity check failed");
          json(200, previous.record);
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const record = {
          id: input.sourceId,
          missionId: mission.id,
          missionTitle: mission.title,
          family: mission.family,
          clientId: mission.clientId,
          date: new Date().toISOString(),
          score: evaluation.score,
          complete: evaluation.complete,
          payload,
        };
        const receipt = audit.append(
          user.subject,
          "result.save",
          input.sourceId,
          createHash("sha256").update(JSON.stringify(record)).digest("hex"),
        );
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(
          path,
          JSON.stringify({
            owner: user.subject,
            record,
            receipt: { sequence: receipt.sequence, hash: receipt.hash },
          }),
          { mode: 0o600, flag: "wx" },
        );
        json(201, record);
      });
      return;
    }
    const deliveryMatch = url.pathname.match(
      /^\/v1\/deliveries\/([a-zA-Z0-9-]{1,80})$/,
    );
    if (deliveryMatch && req.method === "GET") {
      if (
        !user.roles.includes("designer") ||
        user.roles.includes("auditor") ||
        !user.compartments.includes("training")
      ) {
        json(403, { error: "Designer access required" });
        return;
      }
      const tenantHash = createHash("sha256").update(user.tenant).digest("hex");
      const library = await loadVerifiedLibrary(tenantHash);
      const bytes = await clientDelivery(
        library,
        deliveryMatch[1],
        "dist/web",
        (content) => audit.signContent(content),
      );
      audit.append(
        user.subject,
        "delivery.export",
        deliveryMatch[1],
        createHash("sha256").update(bytes).digest("hex"),
      );
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="orbital-${deliveryMatch[1]}.zip"`,
        "Content-Length": bytes.length,
      });
      res.end(bytes);
      return;
    }
    if (url.pathname === "/v1/library") {
      if (!user.compartments.includes("training") || !user.mfa) {
        json(403, { error: "Access denied" });
        return;
      }
      const tenantHash = createHash("sha256").update(user.tenant).digest("hex"),
        directory = join(data, "libraries", tenantHash),
        path = join(directory, "current.json");
      await exclusive("library-" + tenantHash, async () => {
        const current = await loadVerifiedLibrary(tenantHash);
        if (req.method === "GET") {
          res.setHeader("ETag", String(current.revision));
          json(200, current);
          return;
        }
        if (req.method !== "PUT") {
          json(405, { error: "Method not allowed" });
          return;
        }
        if (
          !user.roles.includes("designer") ||
          user.roles.includes("auditor")
        ) {
          json(403, { error: "Designer access required" });
          return;
        }
        if (req.headers["if-match"] !== String(current.revision)) {
          json(409, {
            error: "The library has changed. Reload before saving.",
          });
          return;
        }
        let parsed: Library;
        try {
          parsed = validateLibrary(await body(req, 4 * 1024 * 1024));
        } catch {
          json(400, { error: "Invalid library archive." });
          return;
        }
        const next = { ...parsed, revision: current.revision + 1 };
        const receipt = audit.append(
          user.subject,
          "library.commit",
          tenantHash,
          createHash("sha256").update(JSON.stringify(next)).digest("hex"),
        );
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(
          join(directory, `${current.revision}.json`),
          JSON.stringify(current),
          { mode: 0o600 },
        );
        await writeFile(path + ".tmp", JSON.stringify(next), { mode: 0o600 });
        await rename(path + ".tmp", path);
        res.setHeader("ETag", String(next.revision));
        res.setHeader("X-Audit-Receipt", receipt.hash);
        json(200, next);
      });
      return;
    }
    if (url.pathname === "/v1/advanced" && req.method === "GET") {
      const files = await readdir(join(data, "advanced")).catch(() => []),
        records = audit.export().records,
        items = [];
      for (const file of files.slice(-1000)) {
        if (!/^[0-9a-f-]{36}\.json$/.test(file)) continue;
        const stored = JSON.parse(
            await readFile(join(data, "advanced", file), "utf8"),
          ),
          digest = createHash("sha256")
            .update(JSON.stringify(stored.payload))
            .digest("hex"),
          receipt = records[stored.receipt.sequence];
        if (
          !receipt ||
          receipt.hash !== stored.receipt.hash ||
          receipt.resource !== file.slice(0, -5) ||
          receipt.detail !== digest
        )
          throw Error("Advanced archive integrity check failed");
        if (authorize(user, "read", stored.payload.resource))
          items.push({
            id: file.slice(0, -5),
            date: receipt.timestamp,
            time: stored.payload.workspace.time,
            vehicles: stored.payload.workspace.vehicles.length,
            digest,
          });
      }
      items.sort((a, b) => b.date.localeCompare(a.date));
      json(200, items);
      return;
    }
    if (url.pathname === "/v1/advanced" && req.method === "POST") {
      const resource: Resource = {
        tenant: user.tenant,
        owner: user.subject,
        classification: 0,
        compartments: ["training"],
      };
      if (!authorize(user, "operate", resource)) {
        json(403, { error: "Access denied" });
        return;
      }
      let replayed: ReturnType<typeof replayArchive>;
      try {
        replayed = replayArchive(await body(req, 4 * 1024 * 1024));
      } catch (error) {
        json(400, {
          error:
            error instanceof Error ? error.message : "Invalid flight archive",
        });
        return;
      }
      const id = randomUUID(),
        payload = { ...replayed, resource },
        digest = createHash("sha256")
          .update(JSON.stringify(payload))
          .digest("hex"),
        receipt = audit.append(user.subject, "advanced.checkpoint", id, digest);
      const directory = join(data, "advanced");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const checkpointPath = join(directory, id + ".json");
      await writeFile(
        checkpointPath + ".tmp",
        JSON.stringify({
          payload,
          receipt: { sequence: receipt.sequence, hash: receipt.hash },
        }),
        { mode: 0o600, flag: "wx" },
      );
      await rename(checkpointPath + ".tmp", checkpointPath);
      json(201, {
        id,
        time: replayed.workspace.time,
        vehicles: replayed.workspace.vehicles.map((v) => ({
          id: v.spec.id,
          metrics: orbitalMetrics(v.state),
        })),
        receipt: { sequence: receipt.sequence, hash: receipt.hash },
        digest,
      });
      return;
    }
    const advancedMatch = url.pathname.match(
      /^\/v1\/advanced\/([0-9a-f-]{36})$/,
    );
    if (advancedMatch && req.method === "GET") {
      const id = advancedMatch[1];
      let stored: {
        payload: {
          archive: FlightArchive;
          workspace: Workspace;
          resource: Resource;
        };
        receipt: { sequence: number; hash: string };
      };
      try {
        stored = JSON.parse(
          await readFile(join(data, "advanced", id + ".json"), "utf8"),
        );
      } catch {
        json(404, { error: "Not found" });
        return;
      }
      const digest = createHash("sha256")
          .update(JSON.stringify(stored.payload))
          .digest("hex"),
        receipt = audit.export().records[stored.receipt.sequence];
      if (
        !receipt ||
        receipt.hash !== stored.receipt.hash ||
        receipt.resource !== id ||
        receipt.detail !== digest
      )
        throw Error("Advanced archive integrity check failed");
      if (!authorize(user, "read", stored.payload.resource)) {
        json(403, { error: "Access denied" });
        return;
      }
      const verified = replayArchive(stored.payload.archive);
      if (
        JSON.stringify(verified.workspace) !==
        JSON.stringify(stored.payload.workspace)
      )
        throw Error("Advanced archive replay check failed");
      json(200, { id, ...verified, receipt: stored.receipt, digest });
      return;
    }
    if (url.pathname === "/v1/proximity" && req.method === "POST") {
      const resource = {
        tenant: user.tenant,
        owner: user.subject,
        classification: 0,
        compartments: ["training"],
      };
      if (!authorize(user, "operate", resource)) {
        json(403, { error: "Access denied" });
        return;
      }
      let mission;
      try {
        mission = validateMission(await body(req));
      } catch {
        json(400, { error: "Invalid mission" });
        return;
      }
      if (["transfer", "deorbit"].includes(mission.family)) {
        json(400, { error: "Invalid proximity family" });
        return;
      }
      if (relativeSessions.size >= 1000) {
        json(503, { error: "Session capacity reached" });
        return;
      }
      const id = randomUUID(),
        session = relativeSession(mission),
        content = { session, resource },
        receipt = audit.append(
          user.subject,
          "proximity.create",
          id,
          relativeStoredDigest(content),
        );
      const stored = {
        session,
        resource,
        integrityVersion: 2 as const,
        receipt: { sequence: receipt.sequence, hash: receipt.hash },
      };
      const directory = join(data, "proximity");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(join(directory, id + ".json"), JSON.stringify(stored), {
        mode: 0o600,
        flag: "wx",
      });
      relativeSessions.set(id, stored);
      json(201, { id, session });
      return;
    }
    const relativeMatch = url.pathname.match(
      /^\/v1\/proximity\/([0-9a-f-]{36})(?:\/(commands|report))?$/,
    );
    if (relativeMatch) {
      const [, id, operation] = relativeMatch;
      await exclusive("relative-" + id, async () => {
        const stored = await getRelativeSession(id);
        if (
          !authorize(
            user,
            req.method === "POST" ? "operate" : "read",
            stored.resource,
          )
        ) {
          json(403, { error: "Access denied" });
          return;
        }
        if (req.method === "GET") {
          json(
            200,
            operation === "report"
              ? relativeReport(stored.session)
              : stored.session,
          );
          return;
        }
        if (req.method !== "POST" || operation !== "commands") {
          json(405, { error: "Method not allowed" });
          return;
        }
        let command;
        try {
          command = parseRelativeCommand(await body(req));
        } catch {
          json(400, { error: "Invalid command" });
          return;
        }
        let session;
        try {
          session = relativeExecute(stored.session, command);
        } catch (error) {
          json(400, {
            error: error instanceof Error ? error.message : "Command rejected",
          });
          return;
        }
        const receipt = audit.append(
          user.subject,
          "proximity.accept",
          id,
          relativeStoredDigest({ session, resource: stored.resource }),
        );
        const next = {
            ...stored,
            session,
            integrityVersion: 2 as const,
            receipt: { sequence: receipt.sequence, hash: receipt.hash },
          },
          path = join(data, "proximity", id + ".json");
        await writeFile(path + ".tmp", JSON.stringify(next), { mode: 0o600 });
        await rename(path + ".tmp", path);
        relativeSessions.set(id, next);
        json(200, session);
      });
      return;
    }
    if (url.pathname === "/v1/sessions" && req.method === "POST") {
      if (
        !authorize(user, "operate", {
          tenant: user.tenant,
          owner: user.subject,
          classification: 0,
          compartments: ["training"],
        })
      ) {
        json(403, { error: "Access denied" });
        return;
      }
      const input = await body(req);
      if (
        !input ||
        !["guided", "practice"].includes(input.mode) ||
        !["standard", "precision"].includes(input.difficulty)
      ) {
        json(400, { error: "Invalid session parameters" });
        return;
      }
      if (sessions.size >= 1000) {
        json(503, { error: "Session capacity reached" });
        return;
      }
      const mission =
          input.mission === undefined
            ? undefined
            : validateMission(input.mission),
        configuration = mission
          ? missionConfiguration(mission)
          : input.configuration
            ? validateConfiguration(input.configuration)
            : undefined;
      if (
        mission &&
        input.configuration &&
        JSON.stringify(validateConfiguration(input.configuration)) !==
          JSON.stringify(configuration)
      ) {
        json(400, { error: "Invalid configuration for mission" });
        return;
      }
      const id = randomUUID(),
        session = createSession(input.mode, input.difficulty, configuration),
        resource: Resource = {
          tenant: user.tenant,
          owner: user.subject,
          classification: 0,
          compartments: ["training"],
        },
        receipt = audit.append(
          user.subject,
          "session.create",
          id,
          storedDigest({ session, resource, mission }),
        );
      const stored = {
        session,
        resource,
        integrityVersion: 2 as const,
        ...(mission ? { mission } : {}),
        receipt: { sequence: receipt.sequence, hash: receipt.hash },
      };
      await persist(id, stored);
      sessions.set(id, stored);
      json(201, { id, ...stored.session });
      return;
    }
    if (url.pathname === "/v1/audit" && req.method === "GET") {
      if (
        !authorize(user, "audit", {
          tenant: user.tenant,
          owner: "",
          classification: 0,
          compartments: ["training"],
        })
      ) {
        json(403, { error: "Access denied" });
        return;
      }
      // Export is restricted to a deployment-wide audit tenant to prevent cross-tenant disclosure.
      if (user.tenant !== process.env.AUDIT_TENANT) {
        json(403, { error: "Audit tenant denied" });
        return;
      }
      audit.append(user.subject, "audit.export", "audit", "");
      json(200, audit.export());
      return;
    }
    const match = url.pathname.match(
      /^\/v1\/sessions\/([0-9a-f-]{36})(?:\/(commands|report|replay))?$/,
    );
    if (!match) {
      json(404, { error: "Not found" });
      return;
    }
    const [, id, operation] = match;
    await exclusive(id, async () => {
      const stored = await getSession(id),
        permission = req.method === "POST" ? "operate" : "read";
      if (!authorize(user, permission, stored.resource)) {
        json(403, { error: "Access denied" });
        return;
      }
      if (req.method === "GET") {
        json(
          200,
          operation === "report"
            ? report(stored.session)
            : operation === "replay"
              ? {
                  model: MODEL.version,
                  initial: stored.session.initial,
                  events: stored.session.events,
                }
              : stored.session,
        );
        return;
      }
      if (req.method === "POST" && operation === "commands") {
        const command = parseCommand(await body(req)),
          session = execute(stored.session, command);
        const receipt = audit.append(
          user.subject,
          "command.accept",
          id,
          storedDigest({ ...stored, session }),
        );
        const updated = {
          ...stored,
          session,
          integrityVersion: 2 as const,
          receipt: { sequence: receipt.sequence, hash: receipt.hash },
        };
        await persist(id, updated);
        sessions.set(id, updated);
        for (const socket of connections.get(id) ?? [])
          if (socket.readyState === 1)
            socket.send(
              JSON.stringify({
                state: session.state,
                sequence: session.events.length,
              }),
            );
        json(200, session);
        return;
      }
      json(405, { error: "Method not allowed" });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    span.setStatus({ code: SpanStatusCode.ERROR, message });
    const status =
      message === "Unauthorized"
        ? 401
        : message === "Not found"
          ? 404
          : /Invalid|Content type|Unexpected|Payload|Insufficient|impacted/.test(
                message,
              )
            ? 400
            : 500;
    if (status === 401) res.setHeader("WWW-Authenticate", "Bearer");
    json(status, { error: status === 500 ? "Internal error" : message });
  } finally {
    span.end();
    process.stdout.write(
      JSON.stringify({
        level: "info",
        event: "request",
        requestId,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      }) + "\n",
    );
  }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
server.on("upgrade", async (req, socket, head) => {
  try {
    if (req.headers.origin !== origin) throw new Error("Origin denied");
    // Browsers authenticate in production through a trusted perimeter proxy attaching the verified bearer header.
    const user = await identity(req),
      url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const match = url.pathname.match(
      /^\/v1\/sessions\/([0-9a-f-]{36})\/stream$/,
    );
    if (!match) throw new Error("Not found");
    const stored = await getSession(match[1]);
    if (!authorize(user, "read", stored.resource))
      throw new Error("Access denied");
    if ((connections.get(match[1])?.size ?? 0) >= 8)
      throw new Error("Stream capacity reached");
    wss.handleUpgrade(req, socket, head, (ws) => {
      const set = connections.get(match[1]) ?? new Set();
      set.add(ws);
      connections.set(match[1], set);
      ws.send(
        JSON.stringify({
          state: stored.session.state,
          sequence: stored.session.events.length,
        }),
      );
      const timer = setTimeout(
        () => ws.close(1008, "Session expired"),
        Math.min(900000, (user.expires - Date.now() / 1000) * 1000),
      );
      ws.on("close", () => {
        clearTimeout(timer);
        set.delete(ws);
        if (!set.size) connections.delete(match[1]);
      });
    });
  } catch {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
  }
});
server.listen(port, host, () =>
  process.stdout.write(
    JSON.stringify({
      level: "info",
      event: "listening",
      port,
      host,
      auth: production || jwks ? "oidc" : "local",
    }) + "\n",
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    wss.close();
    server.close(() => {
      void telemetry?.shutdown().finally(() => process.exit(0));
      if (!telemetry) process.exit(0);
    });
  });
