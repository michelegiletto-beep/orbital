import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { verifyTokenIdentity } from "../packages/security/src/index.js";
test("signed access tokens require trusted signature, exact issuer and audience, freshness and MFA", async () => {
  const pair = await generateKeyPair("ES256"),
    jwk = await exportJWK(pair.publicKey);
  jwk.kid = "test";
  const key = createLocalJWKSet({ keys: [jwk] });
  const claims = {
    tenant: "organization",
    roles: ["operator"],
    clearance: 0,
    compartments: ["training"],
    amr: ["mfa"],
  };
  async function token(
    overrides: Record<string, unknown> = {},
    issued = Math.floor(Date.now() / 1000),
    expiry = Math.floor(Date.now() / 1000) + 300,
    privateKey = pair.privateKey,
  ) {
    return new SignJWT({ ...claims, ...overrides })
      .setProtectedHeader({ alg: "ES256", kid: "test" })
      .setIssuer("https://identity.invalid")
      .setAudience("orbital-api")
      .setSubject("learner")
      .setIssuedAt(issued)
      .setExpirationTime(expiry)
      .sign(privateKey);
  }
  const valid = await token();
  const user = await verifyTokenIdentity(
    valid,
    key,
    "https://identity.invalid",
    "orbital-api",
  );
  assert.equal(user.mfa, true);
  assert.equal(user.tenant, "organization");
  await assert.rejects(
    verifyTokenIdentity(valid, key, "https://other.invalid", "orbital-api"),
  );
  await assert.rejects(
    verifyTokenIdentity(
      valid,
      key,
      "https://identity.invalid",
      "other-audience",
    ),
  );
  await assert.rejects(
    verifyTokenIdentity(
      await token({ amr: ["pwd"] }),
      key,
      "https://identity.invalid",
      "orbital-api",
    ),
  );
  await assert.rejects(
    verifyTokenIdentity(
      await token({ tenant: undefined }),
      key,
      "https://identity.invalid",
      "orbital-api",
    ),
  );
  await assert.rejects(
    verifyTokenIdentity(
      await token({}, Math.floor(Date.now() / 1000) - 1000),
      key,
      "https://identity.invalid",
      "orbital-api",
    ),
  );
  await assert.rejects(
    verifyTokenIdentity(
      await token(
        {},
        Math.floor(Date.now() / 1000) - 500,
        Math.floor(Date.now() / 1000) - 20,
      ),
      key,
      "https://identity.invalid",
      "orbital-api",
    ),
  );
  const other = await generateKeyPair("ES256");
  await assert.rejects(
    verifyTokenIdentity(
      await token({}, undefined, undefined, other.privateKey),
      key,
      "https://identity.invalid",
      "orbital-api",
    ),
  );
});
