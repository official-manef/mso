import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function evidencePath(root, name) {
  if (typeof name !== "string" || !name || isAbsolute(name) || /[\\\\:\0]/.test(name)
    || name.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Invalid relative file path");
  const base = realpathSync(root), target = resolve(base, name);
  if (relative(base, target).startsWith("..")) throw new Error("Path escapes root");
  return { base, target, parts: name.split("/") };
}
export function safeFile(root, name) {
  const { base, target } = evidencePath(root, name);
  for (let current = target; current !== base; current = dirname(current)) {
    const info = lstatSync(current);
    if (info.isSymbolicLink()) throw new Error("Symlink is not evidence");
    if (current === target ? !info.isFile() : !info.isDirectory()) throw new Error("Evidence must be a regular file");
  }
  return target;
}

export const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;

function pinDirectory(base, parts) {
  if (process.platform !== "linux" || !constants.O_NOFOLLOW || !constants.O_DIRECTORY)
    throw new Error("Evidence artifact snapshots require Linux or WSL with /proc/self/fd");
  const components = [...base.split("/").filter(Boolean), ...parts];
  if (components.length > 128) throw new Error("Evidence path is too deep");
  let directory = openSync("/", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const part of components) {
      const next = openSync(`/proc/self/fd/${directory}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { closeSync(directory); } catch (error) { closeSync(next); throw error; }
      directory = next;
    }
    if (realpathSync(`/proc/self/fd/${directory}`) !== resolve(base, ...parts)) throw new Error("Evidence directory changed while opening");
    return directory;
  } catch (error) { closeSync(directory); throw error; }
}

// Validate and read the same pinned inode; never reopen its checked pathname.
export function readArtifactSnapshot(root, name) {
  const { base, parts } = evidencePath(root, name), leaf = parts.pop();
  const directory = pinDirectory(base, parts);
  let file;
  try {
    file = openSync(`/proc/self/fd/${directory}/${leaf}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(file, { bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(MAX_ARTIFACT_BYTES)) throw new Error("Evidence must be a regular file of 1 byte through 20 MiB");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = readSync(file, bytes, used, bytes.length - used, used);
      if (!count) break;
      used += count;
    }
    const after = fstatSync(file, { bigint: true });
    if (used !== Number(before.size) || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs)
      throw new Error("Evidence artifact changed while reading");
    return bytes.subarray(0, used);
  } finally { try { if (file !== undefined) closeSync(file); } finally { closeSync(directory); } }
}
export function sameIds(actual, expected, label) {
  if (!Array.isArray(actual) || actual.some(id => typeof id !== "string")
    || new Set(actual).size !== actual.length || actual.length !== expected.length
    || expected.some(id => !actual.includes(id))) throw new Error(`${label}: missing, duplicate or unknown identifiers`);
}
