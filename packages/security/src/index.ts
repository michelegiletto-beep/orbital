import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { jwtVerify, type JWTVerifyGetKey } from "jose";
export type Identity = {
  subject: string;
  roles: string[];
  tenant: string;
  clearance: number;
  compartments: string[];
  mfa: boolean;
  expires: number;
};
export type Resource = {
  tenant: string;
  owner: string;
  classification: number;
  compartments: string[];
};
export async function verifyTokenIdentity(
  token: string,
  key: JWTVerifyGetKey,
  issuer: string,
  audience: string,
): Promise<Identity> {
  const { payload } = await jwtVerify(token, key, {
    issuer,
    audience,
    algorithms: ["RS256", "ES256"],
    maxTokenAge: "15m",
    clockTolerance: 5,
  });
  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter((r): r is string => typeof r === "string")
    : [];
  const compartments = Array.isArray(payload.compartments)
    ? payload.compartments.filter((r): r is string => typeof r === "string")
    : [];
  const amr = Array.isArray(payload.amr) ? payload.amr : [];
  if (
    !payload.sub ||
    typeof payload.tenant !== "string" ||
    typeof payload.clearance !== "number" ||
    !Number.isInteger(payload.clearance) ||
    !payload.exp ||
    !amr.includes("mfa")
  )
    throw Error("Unauthorized");
  return {
    subject: payload.sub,
    roles,
    tenant: payload.tenant,
    clearance: payload.clearance,
    compartments,
    mfa: true,
    expires: payload.exp,
  };
}
export function authorize(
  identity: Identity,
  action: "read" | "operate" | "audit",
  resource: Resource,
): boolean {
  if (
    !identity.mfa ||
    identity.expires <= Date.now() / 1000 ||
    identity.tenant !== resource.tenant ||
    identity.clearance < resource.classification ||
    !resource.compartments.every((c) => identity.compartments.includes(c))
  )
    return false;
  if (action === "audit") return identity.roles.includes("auditor");
  if (action === "operate")
    return (
      identity.roles.includes("operator") &&
      identity.subject === resource.owner &&
      !identity.roles.includes("auditor")
    );
  return (
    identity.subject === resource.owner ||
    identity.roles.includes("instructor") ||
    identity.roles.includes("auditor")
  );
}
export type AuditRecord = {
  sequence: number;
  timestamp: string;
  subject: string;
  action: string;
  resource: string;
  detail: string;
  previous: string;
  hash: string;
  signature: string;
};
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function verifyChain(records: AuditRecord[], key: KeyObject): boolean {
  let previous = "0".repeat(64);
  for (let i = 0; i < records.length; i++) {
    const { hash, signature, ...body } = records[i];
    if (
      body.sequence !== i ||
      body.previous !== previous ||
      digest(body) !== hash ||
      !verify(
        "sha256",
        Buffer.from(hash, "hex"),
        key,
        Buffer.from(signature, "base64"),
      )
    )
      return false;
    previous = hash;
  }
  return true;
}
export class AuditLog {
  private records: AuditRecord[] = [];
  private key: KeyObject;
  readonly publicKey: KeyObject;
  private path: string;
  constructor(directory: string, production = false) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, "audit.jsonl");
    const keyPath = join(directory, "audit-key.pem");
    if (!existsSync(keyPath)) {
      if (production)
        throw new Error(
          "Provision an audit signing key before production startup",
        );
      const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      writeFileSync(
        keyPath,
        pair.privateKey.export({ type: "pkcs8", format: "pem" }),
        { mode: 0o600, flag: "wx" },
      );
    }
    this.key = createPrivateKey(readFileSync(keyPath));
    this.publicKey = createPublicKey(this.key);
    if (existsSync(this.path)) {
      this.records = readFileSync(this.path, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      if (!verifyChain(this.records, this.publicKey))
        throw new Error("Audit integrity check failed");
    }
  }
  append(subject: string, action: string, resource: string, detail: string) {
    const body = {
      sequence: this.records.length,
      timestamp: new Date().toISOString(),
      subject,
      action,
      resource,
      detail,
      previous: this.records.at(-1)?.hash ?? "0".repeat(64),
    };
    const hash = digest(body),
      signature = sign("sha256", Buffer.from(hash, "hex"), this.key).toString(
        "base64",
      );
    const record = { ...body, hash, signature };
    appendFileSync(this.path, JSON.stringify(record) + "\n", {
      mode: 0o600,
      flush: true,
    });
    this.records.push(record);
    return record;
  }
  export() {
    return {
      records: this.records.map((r) => ({ ...r })),
      publicKey: this.publicKey.export({ type: "spki", format: "pem" }),
    };
  }
  signContent(content: Buffer) {
    return {
      algorithm: "ECDSA_P256_SHA256",
      signature: sign("sha256", content, this.key).toString("base64"),
      publicKey: this.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    };
  }
}
