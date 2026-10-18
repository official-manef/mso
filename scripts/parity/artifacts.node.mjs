import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readInventory } from "./inventory.mjs";
import { validateEvidence } from "./evidence.mjs";
import { evidenceFixture } from "./fixtures.mjs";
import { MAX_ARTIFACT_BYTES, readArtifactSnapshot } from "./paths.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { inventory, implementation } = readInventory(root);
function fixture(t) {
  const result = evidenceFixture(inventory, implementation);
  t.after(() => fs.rmSync(result.root, { recursive: true, force: true })); return result;
}
const check = f => validateEvidence(inventory, f.implementation, f.evidence, f.root, f.commit);
function patchFs(t, method, replacement) {
  t.mock.method(fs, method, replacement); syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}

test("artifact snapshots reject final and ancestor symlinks before reading", t => {
  const f = fixture(t); fs.mkdirSync(join(f.root, "nested"));
  fs.writeFileSync(join(f.root, "nested", "regular"), "safe");
  fs.symlinkSync(join(f.root, "receipt.txt"), join(f.root, "alias"));
  fs.symlinkSync(join(f.root, "nested"), join(f.root, "linked-directory"));
  for (const name of ["alias", "linked-directory/regular", "../receipt.txt", "nested"])
    assert.throws(() => readArtifactSnapshot(f.root, name));
  assert.equal(readArtifactSnapshot(f.root, "nested/regular").toString(), "safe");
});

test("a final symlink swap before open cannot supply matching outside bytes", t => {
  const f = fixture(t), outside = fixture(t), originalOpen = fs.openSync, originalRead = fs.readSync; let swapped = false, reads = 0;
  patchFs(t, "readSync", (...args) => { reads += 1; return originalRead(...args); });
  patchFs(t, "openSync", (name, ...args) => {
    if (String(name).endsWith("/receipt.txt") && !swapped) {
      fs.unlinkSync(join(f.root, "receipt.txt")); fs.symlinkSync(join(outside.root, "receipt.txt"), join(f.root, "receipt.txt")); swapped = true;
    }
    return originalOpen(name, ...args);
  });
  assert.ok(check(f).length); assert.equal(swapped, true); assert.equal(reads, 0);
});

test("a replaced ancestor cannot redirect a pinned artifact read", t => {
  const f = fixture(t), outside = fixture(t), originalOpen = fs.openSync;
  fs.mkdirSync(join(f.root, "nested")); fs.renameSync(join(f.root, "receipt.txt"), join(f.root, "nested", "receipt.txt"));
  f.evidence.artifacts[0].path = "nested/receipt.txt"; let swapped = false;
  patchFs(t, "openSync", (name, ...args) => {
    const descriptor = originalOpen(name, ...args);
    if (String(name).endsWith("/nested") && !swapped) {
      fs.renameSync(join(f.root, "nested"), join(f.root, "detached")); fs.symlinkSync(outside.root, join(f.root, "nested")); swapped = true;
    }
    return descriptor;
  });
  assert.match(check(f).join("\n"), /directory changed/); assert.equal(swapped, true);
});

test("growth after descriptor stat is blocked with a bounded read and no path reopen", t => {
  const f = fixture(t), originalStat = fs.fstatSync, originalRead = fs.readSync;
  const initialSize = f.evidence.artifacts[0].bytes; let grown = false, readBytes = 0;
  patchFs(t, "readFileSync", () => { throw new Error("Unbounded pathname read is forbidden"); });
  patchFs(t, "fstatSync", (...args) => {
    const result = originalStat(...args);
    if (result.isFile() && !grown) { fs.truncateSync(join(f.root, "receipt.txt"), MAX_ARTIFACT_BYTES + 128); grown = true; }
    return result;
  });
  patchFs(t, "readSync", (...args) => { const count = originalRead(...args); readBytes += count; return count; });
  assert.match(check(f).join("\n"), /changed while reading/);
  assert.equal(grown, true); assert.equal(readBytes, initialSize + 1);
});

test("the size bound includes 20 MiB and rejects empty or oversized files before reading", t => {
  const f = fixture(t), receipt = join(f.root, "receipt.txt");
  fs.truncateSync(receipt, MAX_ARTIFACT_BYTES);
  const bytes = readArtifactSnapshot(f.root, "receipt.txt"); assert.equal(bytes.length, MAX_ARTIFACT_BYTES);
  f.evidence.artifacts[0] = { ...f.evidence.artifacts[0], bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  assert.deepEqual(check(f), []);
  let reads = 0; const originalRead = fs.readSync;
  patchFs(t, "readSync", (...args) => { reads += 1; return originalRead(...args); });
  for (const size of [0, MAX_ARTIFACT_BYTES + 1]) {
    fs.truncateSync(receipt, size); assert.throws(() => readArtifactSnapshot(f.root, "receipt.txt"), /1 byte through 20 MiB/);
  }
  assert.equal(reads, 0);
});

test("snapshot descriptors close after successful and failed validation", t => {
  const f = fixture(t), originalOpen = fs.openSync, originalStat = fs.fstatSync, descriptors = new Set();
  patchFs(t, "openSync", (...args) => { const descriptor = originalOpen(...args); descriptors.add(descriptor); return descriptor; });
  readArtifactSnapshot(f.root, "receipt.txt"); fs.truncateSync(join(f.root, "receipt.txt"), 0);
  assert.throws(() => readArtifactSnapshot(f.root, "receipt.txt"));
  assert.ok(descriptors.size); for (const descriptor of descriptors) assert.throws(() => originalStat(descriptor), { code: "EBADF" });
});

test("runtime environment identity requires nonempty strings", t => {
  const f = fixture(t); assert.deepEqual(check(f), []);
  for (const key of ["name", "platform", "node"]) {
    const original = f.evidence.environment[key];
    for (const value of [true, {}, [], null, 42, "", " \t"]) {
      f.evidence.environment[key] = value; assert.match(check(f).join("\n"), /Runtime environment and timestamp required/);
    }
    f.evidence.environment[key] = original;
  }
});

test("unsupported platforms explicitly block artifact snapshots", t => {
  const f = fixture(t), original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...original, value: "darwin" });
  try { assert.match(check(f).join("\n"), /require Linux or WSL/); }
  finally { Object.defineProperty(process, "platform", original); }
});
