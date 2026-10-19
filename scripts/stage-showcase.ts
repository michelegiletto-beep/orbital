import { readFile, writeFile, mkdir, readdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { seedLibrary } from "../packages/library/src/index.js";
import { assertPublishableFile } from "../packages/delivery/src/index.js";

const product = process.cwd(), destination = resolve(product, "../../public/orbital"), release = resolve(product, "../../outputs/orbital");
const assetsOnly = process.argv.includes("--assets-only");
await mkdir(destination, { recursive: true });
async function stage(directory: string, relative = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw Error("Showcase assets cannot contain symbolic links");
    const name = relative ? relative + "/" + entry.name : entry.name;
    if (entry.isDirectory()) await stage(join(directory, entry.name), name);
    else {
      const bytes = await readFile(join(directory, entry.name));
      assertPublishableFile(name, bytes);
      await mkdir(resolve(destination, relative), { recursive: true });
      await writeFile(resolve(destination, name), bytes);
    }
  }
}
await stage(resolve(product, "dist/showcase"));
await writeFile(join(destination, "orbital-library.json"), JSON.stringify(seedLibrary()));
for (const name of ["LICENSE", "EVALUATION.md"])
  await copyFile(resolve(product, name), join(destination, name));
if (!assetsOnly) {
  const manifest = JSON.parse(await readFile(join(release, "release.json"), "utf8"));
  if (manifest.version !== "0.3.0") throw Error("The showcase requires the verified 0.3.0 release");
  for (const file of manifest.files) {
    if (!["Orbital.zip", "Orbital-source.zip"].includes(file.name)) throw Error("Unexpected release artifact");
    const bytes = await readFile(join(release, file.name));
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw Error("Release digest mismatch");
    await writeFile(join(destination, file.name), bytes);
  }
  for (const name of ["release.json", "release-signature.json", "verification-20261017.json"])
    await copyFile(join(release, name), join(destination, name));
  await copyFile(resolve(product, "publication/output/pdf/Orbital-technical-report.pdf"), join(destination, "Orbital-technical-report.pdf"));
  await copyFile(resolve(product, "publication/output/Orbital-publication.zip"), join(destination, "Orbital-publication.zip"));
}
process.stdout.write(JSON.stringify({ destination, assetsOnly, library: "Synthetic general catalog", clientRecords: 0 }) + "\n");
