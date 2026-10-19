import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { validateLibrary, type Library } from "../../library/src/index.js";
import { englishLibrary } from "../../library/src/english.js";
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let i = 0; i < 8; i++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function validateArchivePath(name: string): void {
  const segments = name.split("/");
  if (
    !name ||
    /[\\:\u0000-\u001f\u007f]/.test(name) ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[. ]$/.test(segment) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
    ) ||
    Buffer.byteLength(name) > 65535
  )
    throw Error("Unsafe archive path");
}
export function assertPublishableFile(name: string, data: Buffer): void {
  validateArchivePath(name);
  const basename = name.split("/").at(-1)!;
  if (
    /^\.env(?:\.|$)/i.test(basename) ||
    /^(?:\.npmrc|\.pypirc|kubeconfig|key\.properties|credentials(?:\.[^.]+)?|secrets?(?:\.[^.]+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|service[-_]account.*\.json)$/i.test(
      basename,
    ) ||
    /\.(?:pem|key|p12|pfx|p8|jks|keystore|kdbx)(?:\.(?:bak|old|backup))?$/i.test(
      basename,
    ) ||
    /\.tfstate(?:\..*)?$/i.test(basename)
  )
    throw Error("Credential file cannot be included in a publication: " + name);
  const content = data.toString("utf8");
  if (
    /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(content) ||
    /\b(?:ghp_|gho_|ghu_|ghs_)[A-Za-z0-9]{36,}\b/.test(content) ||
    /\bgithub_pat_[A-Za-z0-9_]{40,}\b/.test(content) ||
    /\bsk-proj-[A-Za-z0-9_-]{40,}\b/.test(content)
  )
    throw Error(
      "Credential material cannot be included in a publication: " + name,
    );
}
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const value of bytes) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function zip(files: { name: string; data: Buffer }[]): Buffer {
  if (files.length > 65535) throw Error("ZIP64 archives are not supported");
  const chunks: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  const paths = new Set<string>();
  for (const file of files) {
    validateArchivePath(file.name);
    const canonical = file.name.toLowerCase();
    if (paths.has(canonical)) throw Error("Duplicate archive path");
    paths.add(canonical);
    if (
      !Buffer.isBuffer(file.data) ||
      file.data.length > 0xffffffff ||
      offset + file.data.length + Buffer.byteLength(file.name) + 30 > 0xffffffff
    )
      throw Error("ZIP64 archives are not supported");
    const name = Buffer.from(file.name),
      crc = crc32(file.data),
      header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(file.data.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    chunks.push(header, name, file.data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(0x21, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(file.data.length, 20);
    directory.writeUInt32LE(file.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + file.data.length;
  }
  const index = Buffer.concat(central),
    end = Buffer.alloc(22);
  if (offset + index.length + end.length > 0xffffffff)
    throw Error("ZIP64 archives are not supported");
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, index, end]);
}
export async function clientDelivery(
  library: Library,
  clientId: string,
  webDirectory: string,
  signer?: (content: Buffer) => {
    algorithm: string;
    signature: string;
    publicKey: string;
  },
): Promise<Buffer> {
  const client = library.clients.find((c) => c.id === clientId);
  if (!client) throw Error("Not found");
  const scoped = englishLibrary(
    validateLibrary({
      ...library,
      clients: [client],
      missions: library.missions.filter((m) => m.clientId === clientId),
    }),
  );
  const files: { name: string; data: Buffer }[] = [],
    root = resolve(webDirectory);
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (!path.startsWith(root + sep)) throw Error("Unsafe delivery path");
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const name = relative(root, path).replaceAll("\\", "/");
        if (name.endsWith(".map")) continue;
        if (
          !/\.(?:html|js|css|json|svg|png|jpe?g|webp|ico|woff2?|txt)$/i.test(
            name,
          )
        )
          throw Error("Unexpected delivery asset: " + name);
        // The library is always generated from the selected client below.
        if (name === "orbital-library.json") continue;
        const content = await readFile(path);
        assertPublishableFile(name, content);
        files.push({ name, data: content });
      }
    }
  }
  await walk(root);
  files.push({
    name: "orbital-library.json",
    data: Buffer.from(JSON.stringify(scoped, null, 2)),
  });
  files.push({
    name: "launch.mjs",
    data: Buffer.from(
      `import {createServer} from 'node:http';import {readFile,stat} from 'node:fs/promises';import {resolve,extname,sep} from 'node:path';const root=process.cwd(),port=Number(process.env.PORT??4317);const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.json':'application/json'};createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);if(pathname.includes('\\\\'))throw Error();let file=resolve(root,'.'+pathname);if(file!==root&&!file.startsWith(root+sep))throw Error();if((await stat(file)).isDirectory())file=resolve(file,'index.html');const bytes=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(bytes);}catch{res.writeHead(404);res.end();}}).listen(port,'127.0.0.1',()=>console.log('Orbital http://127.0.0.1:'+port));`,
    ),
  });
  files.push({
    name: "README.txt",
    data: Buffer.from(
      `Orbital\n${client.name}\n\nRun node launch.mjs from the extracted directory and open http://127.0.0.1:4317. Requires Node 22 or later. No Internet connection is needed.\n\nThis local package contains only the selected library. Local exercises are not an accredited environment for classified information.\n\nEarth imagery: NASA Earth Observatory, Blue Marble Next Generation and Blue Marble Clouds. Historical composites. No endorsement implied.\n\n© Michele Giletto. All rights reserved for original software. Third party components retain their licenses.`,
    ),
  });
  for (const [path, name] of [
    ["LICENSE", "LICENSE.txt"],
    ["EVALUATION.md", "EVALUATION.md"],
    ["docs/supply-chain/THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES.txt"],
    ["docs/supply-chain/sbom.cdx.json", "sbom.cdx.json"],
    ["docs/earth-imagery.md", "earth-imagery.md"],
  ]) {
    try {
      files.push({ name, data: await readFile(path) });
    } catch {
      throw Error("Delivery license evidence missing");
    }
  }
  files.push({
    name: "verify.mjs",
    data: Buffer.from(
      `import {readFileSync} from 'node:fs';import {createHash,verify,createPublicKey} from 'node:crypto';import {resolve,sep} from 'node:path';const root=process.cwd(),raw=readFileSync('manifest.json'),manifest=JSON.parse(raw);for(const file of manifest.files){const path=resolve(root,file.name);if(!path.startsWith(root+sep))throw Error('Unsafe manifest path');const digest=createHash('sha256').update(readFileSync(path)).digest('hex');if(digest!==file.sha256)throw Error('File integrity failed: '+file.name);}try{const signature=JSON.parse(readFileSync('manifest-signature.json'));if(!verify('sha256',raw,createPublicKey(signature.publicKey),Buffer.from(signature.signature,'base64')))throw Error('Invalid signature');console.log('File hashes and signature verified. Trust the public key through your approved channel.');}catch(error){if(error.code==='ENOENT')console.log('Hashes verified. No signature in this package.');else throw error;}`,
    ),
  });
  const manifest = {
    schema: "orbital.delivery.v1",
    client: client.name,
    clientId,
    libraryRevision: scoped.revision,
    missionCount: scoped.missions.length,
    files: files.map((f) => ({
      name: f.name,
      sha256: createHash("sha256").update(f.data).digest("hex"),
    })),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  files.push({ name: "manifest.json", data: manifestBytes });
  if (signer)
    files.push({
      name: "manifest-signature.json",
      data: Buffer.from(JSON.stringify(signer(manifestBytes), null, 2)),
    });

  return zip(files);
}
