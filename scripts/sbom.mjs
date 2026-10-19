import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const components = [],
  licenses = [];
const allowed = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "CC0-1.0",
  "0BSD",
  "BlueOak-1.0.0",
  "Python-2.0",
  "(MIT OR CC0-1.0)",
  "MPL-2.0",
]);
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path) continue;
  const name = pkg.name ?? path.split("node_modules/").at(-1);
  const license = pkg.license ?? "UNKNOWN";
  if (!allowed.has(license))
    throw Error(`License requires review: ${name} ${license}`);
  const component = {
    type: "library",
    "bom-ref": path,
    name,
    version: pkg.version,
    scope: pkg.dev ? "optional" : "required",
    licenses: [
      /\b(?:AND|OR|WITH)\b/.test(license)
        ? { expression: license }
        : { license: { id: license } },
    ],
    purl: `pkg:npm/${name.replace("@", "%40")}@${pkg.version}`,
  };
  if (pkg.integrity) {
    const [algorithm, value] = pkg.integrity.split("-");
    component.hashes = [
      {
        alg: algorithm === "sha512" ? "SHA-512" : "SHA-256",
        content: Buffer.from(value, "base64").toString("hex"),
      },
    ];
  }
  components.push(component);
  const licensePath = [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "license",
    "license.md",
  ]
    .map((n) => join(path, n))
    .find((p) => existsSync(p));
  licenses.push(
    `${name} ${pkg.version}\n${license}\n${licensePath ? readFileSync(licensePath, "utf8") : "License text must be retained in the original package archive."}`,
  );
}
mkdirSync("docs/supply-chain", { recursive: true });
writeFileSync(
  "docs/supply-chain/sbom.cdx.json",
  JSON.stringify(
    {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      serialNumber: `urn:uuid:${randomUUID()}`,
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        component: {
          type: "application",
          name: "Orbital",
          version: lock.version,
        },
      },
      components,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  "docs/supply-chain/THIRD_PARTY_NOTICES.txt",
  licenses.join("\n\n") + "\n",
);
process.stdout.write(
  JSON.stringify({
    components: components.length,
    licenses: "allowlist passed",
  }) + "\n",
);
