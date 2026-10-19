import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  AuditLog,
  authorize,
  verifyChain,
  type Identity,
  type Resource,
} from "../packages/security/src/index.js";
const identity: Identity = {
  subject: "a",
  tenant: "training",
  roles: ["operator"],
  clearance: 1,
  compartments: ["orbit"],
  mfa: true,
  expires: Date.now() / 1000 + 300,
};
const resource: Resource = {
  owner: "a",
  tenant: "training",
  classification: 1,
  compartments: ["orbit"],
};
test("RBAC and ABAC deny cross tenant, owner, clearance, compartment, expired and non MFA access", () => {
  assert.equal(authorize(identity, "operate", resource), true);
  for (const change of [
    { tenant: "other" },
    { subject: "other" },
    { clearance: 0 },
    { compartments: [] },
    { mfa: false },
    { expires: 0 },
    { roles: ["auditor"] },
    { roles: [] },
  ])
    assert.equal(
      authorize({ ...identity, ...change }, "operate", resource),
      false,
    );
  assert.equal(
    authorize(
      { ...identity, roles: ["operator", "auditor"] },
      "operate",
      resource,
    ),
    false,
  );
  assert.equal(
    authorize(
      { ...identity, roles: ["instructor"], subject: "b" },
      "read",
      resource,
    ),
    true,
  );
  assert.equal(
    authorize({ ...identity, roles: ["auditor"] }, "audit", resource),
    true,
  );
});
test("signed audit persists and detects mutation and restart tampering", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbital-audit-"));
  try {
    const log = new AuditLog(dir);
    log.append("a", "session.create", "mission", "synthetic");
    log.append("a", "burn", "mission", "100");
    const exported = log.export();
    assert.equal(verifyChain(exported.records, log.publicKey), true);
    assert.equal(new AuditLog(dir).export().records.length, 2);
    exported.records[0].detail = "tampered";
    assert.equal(verifyChain(exported.records, log.publicKey), false);
    const path = join(dir, "audit.jsonl");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace("synthetic", "modified"),
    );
    assert.throws(() => new AuditLog(dir), /integrity/);
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep))
      throw Error("Unsafe test cleanup");
    rmSync(dir, { recursive: true, force: true });
  }
});
test("production refuses automatic signing key generation", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbital-prod-"));
  try {
    assert.throws(() => new AuditLog(dir, true), /Provision/);
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep))
      throw Error("Unsafe test cleanup");
    rmSync(dir, { recursive: true, force: true });
  }
});
