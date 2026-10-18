import { AsyncLocalStorage } from "node:async_hooks";
import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { HostError } from "./host-error";
import { isUnderRoot, readRootList } from "./path-roots";

type Boundary = { root: string; handle: FileHandle; held: FileHandle[] };
type ReadScope = { root: string; active: boolean; pin?: Promise<Boundary> };
const boundary = new AsyncLocalStorage<Boundary>();
const readableWorkspace = new AsyncLocalStorage<ReadScope | null>();
async function assertPinnedBoundary(current: Boundary): Promise<void> {
  if (await fs.realpath(`/proc/self/fd/${current.handle.fd}`) !== current.root) throw new HostError("Path escapes the pinned isolated workflow workspace");
}
async function pinBoundary(root: string): Promise<Boundary> {
  if (process.platform !== "linux") throw new HostError("Isolated source execution requires Linux/WSL descriptors");
  if (await fs.realpath(root) !== root) throw new HostError("Path escapes the pinned isolated workflow workspace");
  const handle = await fs.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const current = { root, handle, held: [] as FileHandle[] };
  try { await assertPinnedBoundary(current); return current; }
  catch (error) { await handle.close(); throw error; }
}
function assertActive(current: ReadScope): void {
  if (!current.active) throw new HostError("Isolated workflow read access has expired");
}
async function readableBoundary(current: ReadScope): Promise<Boundary> {
  assertActive(current);
  const pinned = await (current.pin ??= pinBoundary(current.root));
  assertActive(current);
  await assertPinnedBoundary(pinned);
  assertActive(current);
  return pinned;
}
export async function assertIsolatedPath(real: string): Promise<void> {
  const current = boundary.getStore();
  if (!current) return;
  await assertPinnedBoundary(current);
  if (!isUnderRoot(real, current.root)) throw new HostError("Path escapes the pinned isolated workflow workspace");
}
/** Pin the owned worktree only when this read needs authority beyond configured roots. */
export async function readRootListWithWorkspace(requested: string): Promise<string[]> {
  const configured = readRootList(), current = readableWorkspace.getStore();
  if (!current || !isUnderRoot(requested, current.root) || configured.some(root => isUnderRoot(requested, path.resolve(root)))) return configured;
  await readableBoundary(current);
  assertActive(current);
  return [...configured, current.root];
}
export async function readableRootRealpath(root: string): Promise<string> {
  const current = readableWorkspace.getStore();
  if (current && root === current.root && !readRootList().some(configured => path.resolve(configured) === root)) {
    await readableBoundary(current);
    assertActive(current);
    return current.root;
  }
  return fs.realpath(root).catch(() => path.resolve(root));
}
/** Writes pin eagerly; reads activate a call-scoped pin only at filesystem access. */
export async function withIsolatedFilesystem<T>(root: string | undefined, run: () => Promise<T>, options: { readOnly?: boolean } = {}): Promise<T> {
  // Standalone nested calls lose the read grant while retaining the parent's write restriction.
  if (!root) return readableWorkspace.run(null, run);
  const canonical = path.resolve(root);
  const eager = options.readOnly ? undefined : await pinBoundary(canonical);
  const current: ReadScope = { root: canonical, active: true, ...(eager ? { pin: Promise.resolve(eager) } : {}) };
  try {
    const invoke = () => readableWorkspace.run(current, run);
    return await (eager ? boundary.run(eager, invoke) : invoke());
  } finally {
    current.active = false;
    // A detached read may still be opening the pin; revoke first, then own its cleanup.
    const pinned = await current.pin?.catch(() => undefined);
    if (pinned) await Promise.all([...pinned.held, pinned.handle].map(item => item.close()));
  }
}
export async function isolatedCwd(real: string): Promise<string> {
  const current = boundary.getStore();
  if (!current) return real;
  await assertIsolatedPath(real);
  const handle = await fs.open(real, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await assertIsolatedPath(await fs.realpath(`/proc/self/fd/${handle.fd}`)); }
  catch (error) { await handle.close(); throw error; }
  current.held.push(handle);
  return path.join("/proc/self/fd", String(handle.fd));
}
