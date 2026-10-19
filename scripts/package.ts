import { readFile, readdir, mkdir, writeFile, stat } from "node:fs/promises";
import { resolve, join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  clientDelivery,
  zip,
  assertPublishableFile,
} from "../packages/delivery/src/index.js";
import { seedLibrary, validateLibrary } from "../packages/library/src/index.js";
import { AuditLog } from "../packages/security/src/index.js";
const root = process.cwd(),
  output = resolve("../../outputs/orbital");
const library = process.argv[2]
  ? validateLibrary(
      JSON.parse(await readFile(resolve(process.argv[2]), "utf8")),
    )
  : seedLibrary();
const clientId = process.argv[3] ?? library.clients[0].id,
  audit = new AuditLog(".data");
await mkdir(output, { recursive: true });
const runtime = await clientDelivery(library, clientId, "dist/web", (content) =>
  audit.signContent(content),
);
await writeFile(join(output, "Orbital.zip"), runtime);
const files: { name: string; data: Buffer }[] = [];
const excludedDirectories = new Set([
  "node_modules",
  ".data",
  "dist",
  "test-results",
  "coverage",
  ".git",
  "__pycache__",
  ".cache",
  "tmp",
  "temp",
  "output",
]);
const excludedGeneratedFiles =
  /(?:^|\/)(?:screenshot[^/]*|page-\d+|page_\d+)\.(?:png|jpe?g|webp)$/i;
async function addSource(path: string) {
  const name = relative(root, path).replaceAll("\\", "/"),
    content = await readFile(path);
  assertPublishableFile(name, content);
  if (
    excludedGeneratedFiles.test(name) ||
    name.endsWith(".pyc") ||
    name.endsWith(".log") ||
    name.endsWith(".map")
  )
    return;
  files.push({ name, data: content });
}
async function walk(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(directory, entry.name);
    if (!path.startsWith(root + sep)) throw Error("Unsafe source path");
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) await walk(path);
    } else if (entry.isFile()) await addSource(path);
  }
}
for (const directory of [
  "apps",
  "packages",
  "tests",
  "scripts",
  "docs",
  "infra",
])
  await walk(resolve(directory));
for (const directory of ["publication", ".github"]) {
  try {
    await stat(resolve(directory));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
    throw error;
  }
  await walk(resolve(directory));
}
for (const name of [
  "README.md",
  "LICENSE",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  ".gitignore",
  ".dockerignore",
])
  await addSource(resolve(name));
for (const name of [
  "CITATION.cff",
  "EVALUATION.md",
  ".zenodo.json",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  ".gitattributes",
])
  try {
    await addSource(resolve(name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
const source = zip(files);
await writeFile(join(output, "Orbital-source.zip"), source);
const manifest = {
  version: JSON.parse(await readFile("package.json", "utf8")).version,
  createdAt: new Date().toISOString(),
  files: [
    {
      name: "Orbital.zip",
      sha256: createHash("sha256").update(runtime).digest("hex"),
      bytes: runtime.length,
    },
    {
      name: "Orbital-source.zip",
      sha256: createHash("sha256").update(source).digest("hex"),
      bytes: source.length,
    },
  ],
};
const bytes = Buffer.from(JSON.stringify(manifest, null, 2));
await writeFile(join(output, "release.json"), bytes);
await writeFile(
  join(output, "release-signature.json"),
  JSON.stringify(audit.signContent(bytes), null, 2),
);
process.stdout.write(
  JSON.stringify({
    directory: output,
    files: manifest.files.map((f) => ({ name: f.name, bytes: f.bytes })),
  }) + "\n",
);
