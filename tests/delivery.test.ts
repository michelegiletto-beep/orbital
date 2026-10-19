import { test } from "node:test";
import assert from "node:assert/strict";
import { zip } from "../packages/delivery/src/index.js";
test("offline archive uses valid ZIP headers, central directory and UTF8 entry names", () => {
  const bytes = zip([
    { name: "index.html", data: Buffer.from("<html>Orbital</html>") },
    { name: "assets/missione.json", data: Buffer.from("{}") },
  ]);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 10), 2);
  const index = bytes.readUInt32LE(end + 16);
  assert.equal(bytes.readUInt32LE(index), 0x02014b50);
  assert.equal(bytes.readUInt16LE(6), 0x800);
  assert.equal(bytes.readUInt16LE(8), 0);
});
test("offline archive rejects traversal paths", () => {
  assert.throws(
    () => zip([{ name: "../secret", data: Buffer.from("x") }]),
    /Unsafe/,
  );
  assert.throws(
    () => zip([{ name: "C:\\secret", data: Buffer.from("x") }]),
    /Unsafe/,
  );
});
