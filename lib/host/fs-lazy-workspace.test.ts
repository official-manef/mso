import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withIsolatedFilesystem } from "./fs-isolation";
import { readFile } from "./fs";

let base: string, canonical: string, workspace: string;
const data = (root: string) => path.join(root, "data.txt");
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mso-lazy-workspace-")));
  canonical = path.join(base, "canonical"); workspace = path.join(base, "cache", "task");
  for (const root of [canonical, workspace]) {
    await fs.mkdir(root, { recursive: true }); await fs.writeFile(data(root), path.basename(root));
  }
  vi.stubEnv("OS_FS_READ_ROOTS", canonical); vi.stubEnv("OS_FS_WRITE_ROOTS", base);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await fs.rm(base, { recursive: true, force: true });
});

it("keeps metadata and configured reads independent of a removed prospective workspace", async () => {
  await fs.rm(workspace, { recursive: true });
  const open = vi.spyOn(fs, "open"), realpath = vi.spyOn(fs, "realpath");
  expect(await withIsolatedFilesystem(workspace, async () => ({ ready: true }), { readOnly: true })).toEqual({ ready: true });
  await expect(withIsolatedFilesystem(workspace, () => readFile(data(canonical)), { readOnly: true })).resolves.toBe("canonical");
  for (const spy of [open, realpath]) expect(spy.mock.calls.some(args => String(args[0]) === workspace)).toBe(false);
});

it("keeps an identical configured root on its existing read path without opening a workspace pin", async () => {
  const open = vi.spyOn(fs, "open");
  await expect(withIsolatedFilesystem(canonical, () => readFile(data(canonical)), { readOnly: true })).resolves.toBe("canonical");
  expect(open.mock.calls.some(args => String(args[0]) === canonical)).toBe(false);
});

it("shares the first pin across concurrent reads and closes it when the call completes", async () => {
  const open = fs.open.bind(fs), pins: FileHandle[] = [];
  vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args);
    if (String(args[0]) === workspace) pins.push(handle);
    return handle;
  });
  await withIsolatedFilesystem(workspace, async () => {
    expect(await Promise.all([readFile(data(workspace)), readFile(data(workspace))])).toEqual(["task", "task"]);
    expect(pins).toHaveLength(1); expect(pins[0].fd).toBeGreaterThanOrEqual(0);
  }, { readOnly: true });
  expect(pins[0].fd).toBe(-1);
});

it("clears a nested standalone read scope and restores the parent's prospective root", async () => {
  await withIsolatedFilesystem(workspace, async () => {
    await withIsolatedFilesystem(undefined, async () => {
      await expect(readFile(data(workspace))).rejects.toThrow(/outside readable roots/);
      await expect(readFile(data(canonical))).resolves.toBe("canonical");
    });
    await expect(readFile(data(workspace))).resolves.toBe("task");
  }, { readOnly: true });
});

it("refuses a detached continuation after the call completes without opening a new pin", async () => {
  const resume = gate(), open = vi.spyOn(fs, "open");
  let detached!: Promise<unknown>;
  await withIsolatedFilesystem(workspace, async () => {
    detached = resume.promise.then(() => readFile(data(workspace))).catch(error => error);
  }, { readOnly: true });
  resume.release();
  expect(await detached).toMatchObject({ message: expect.stringContaining("read access has expired") });
  expect(open.mock.calls.some(args => String(args[0]) === workspace)).toBe(false);
});

it.each([false, true])("revokes a pending detached pin and preserves the handler error (pinFails=%s)", async pinFails => {
  const opening = gate(), resume = gate(), finished = gate(), open = fs.open.bind(fs);
  const handlerError = new Error("fixture handler failed"), pinError = new Error("fixture pin failed");
  let pin: FileHandle | undefined, detached!: Promise<unknown>;
  vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]) !== workspace) return open(...args);
    if (!pinFails) pin = await open(...args);
    opening.release(); await resume.promise;
    if (pinFails) throw pinError;
    return pin!;
  });
  const outcome = withIsolatedFilesystem(workspace, async () => {
    detached = readFile(data(workspace)).catch(error => error);
    await opening.promise; finished.release();
    throw handlerError;
  }, { readOnly: true }).catch(error => error);
  await finished.promise;
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  resume.release();
  expect(await outcome).toBe(handlerError);
  expect(await detached).toMatchObject({ message: expect.stringContaining(pinFails ? "fixture pin failed" : "read access has expired") });
  if (!pinFails) expect(pin!.fd).toBe(-1);
});
