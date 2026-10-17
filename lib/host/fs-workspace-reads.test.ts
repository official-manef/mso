import { promises as fs, renameSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withIsolatedFilesystem } from "./fs-isolation";
import { listDir, readFile, writeFile } from "./fs";
import { readFileBytes } from "./fs-read-bytes";
import { writeFileGuarded } from "./guarded-write";
import { sha256Text } from "./hash";
import { resolveReadable } from "./paths";

let base: string, canonical: string, workspace: string, sibling: string;
const data = (root: string) => path.join(root, "data.txt");
beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mso-workspace-reads-")));
  canonical = path.join(base, "canonical");
  workspace = path.join(base, "cache", "task");
  sibling = path.join(base, "cache", "other-task");
  for (const root of [canonical, workspace, sibling]) {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(data(root), path.basename(root));
  }
  vi.stubEnv("OS_FS_READ_ROOTS", canonical);
  vi.stubEnv("OS_FS_WRITE_ROOTS", base);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await fs.rm(base, { recursive: true, force: true });
});

it.each([false, true])("reads only the pinned workspace in addition to the configured roots (readOnly=%s)", async readOnly => {
  await expect(readFile(data(workspace))).rejects.toThrow(/outside readable roots/);
  await withIsolatedFilesystem(workspace, async () => {
    await expect(readFile(data(workspace))).resolves.toBe("task");
    expect((await readFileBytes(data(workspace))).toString()).toBe("task");
    expect((await listDir(workspace)).entries.map(entry => entry.name)).toEqual(["data.txt"]);
    await expect(readFile(data(canonical))).resolves.toBe("canonical");
    await expect(readFile(data(sibling))).rejects.toThrow(/outside readable roots/);
    await expect(listDir(path.dirname(workspace))).rejects.toThrow(/outside readable roots/);
  }, { readOnly });
  await expect(readFile(data(workspace))).rejects.toThrow(/outside readable roots/);
});

it("supports existing-file hash checks while preserving stale-write and write-root refusals", async () => {
  await withIsolatedFilesystem(workspace, async () => {
    await expect(writeFileGuarded({ path: data(workspace), content: "updated", expectedSha256: sha256Text("task") }))
      .resolves.toMatchObject({ previousSha256: sha256Text("task"), sha256: sha256Text("updated") });
    await expect(writeFileGuarded({ path: data(workspace), content: "stale", expectedSha256: sha256Text("task") }))
      .rejects.toThrow(/changed since fs_read/);
    await expect(writeFile(data(canonical), "changed")).rejects.toThrow(/isolated/);
    vi.stubEnv("OS_FS_WRITE_ROOTS", canonical);
    await expect(writeFile(data(workspace), "changed")).rejects.toThrow(/outside writable roots/);
    await expect(readFile(data(workspace))).resolves.toBe("updated");
  });
  expect(await fs.readFile(data(canonical), "utf8")).toBe("canonical");
});

it.each([false, true])("keeps credential and symlink checks on the extra read root (readOnly=%s)", async readOnly => {
  await fs.writeFile(path.join(workspace, ".env"), "fixture");
  await fs.symlink(sibling, path.join(workspace, "escape"));
  await fs.symlink(path.join(workspace, ".env"), path.join(workspace, "alias"));
  await withIsolatedFilesystem(workspace, async () => {
    for (const target of [path.join(workspace, ".env"), path.join(workspace, "alias")])
      await expect(readFile(target)).rejects.toThrow(/credential|sensitive/);
    await expect(readFile(path.join(workspace, "escape", "data.txt"))).rejects.toThrow(/outside readable roots/);
  }, { readOnly });
});

it("clears nested standalone read grants without dropping the inherited write restriction", async () => {
  await withIsolatedFilesystem(workspace, async () => {
    await withIsolatedFilesystem(undefined, async () => {
      await expect(readFile(data(workspace))).rejects.toThrow(/outside readable roots/);
      await expect(readFile(data(canonical))).resolves.toBe("canonical");
      await expect(writeFile(data(canonical), "changed")).rejects.toThrow(/isolated/);
    });
    await expect(readFile(data(workspace))).resolves.toBe("task");
  });
});

it.each([false, true])("does not mix simultaneous workspace read grants (readOnly=%s)", async readOnly => {
  let entered = 0, release = () => {};
  const ready = new Promise<void>(resolve => { release = resolve; });
  await Promise.all([workspace, sibling].map(own => withIsolatedFilesystem(own, async () => {
    if (++entered === 2) release();
    await ready;
    await expect(readFile(data(own))).resolves.toBe(path.basename(own));
    await expect(readFile(data(own === workspace ? sibling : workspace))).rejects.toThrow(/outside readable roots/);
  }, { readOnly })));
});

it.each([false, true])("rejects a workspace replaced by a symlink before pinning (readOnly=%s)", async readOnly => {
  await fs.rename(workspace, workspace + "-held");
  await fs.symlink(sibling, workspace);
  const run = vi.fn(async () => readFile(data(workspace)));
  await expect(withIsolatedFilesystem(workspace, run, { readOnly })).rejects.toThrow(/isolated/);
  expect(run).toHaveBeenCalledTimes(readOnly ? 1 : 0);
});

it.each([false, true])("rejects an ancestor exchange while opening the workspace (readOnly=%s)", async readOnly => {
  const cache = path.dirname(workspace), outside = path.join(base, "outside");
  await fs.mkdir(path.join(outside, "task"), { recursive: true });
  await fs.writeFile(data(path.join(outside, "task")), "outside");
  const open = fs.open.bind(fs); let swapped = false;
  vi.spyOn(fs, "open").mockImplementation((...args: Parameters<typeof fs.open>) => {
    if (!swapped && String(args[0]) === workspace) {
      swapped = true; renameSync(cache, cache + "-held"); symlinkSync(outside, cache);
    }
    return open(...args);
  });
  const run = vi.fn(async () => readFile(data(workspace)));
  await expect(withIsolatedFilesystem(workspace, run, { readOnly })).rejects.toThrow(/isolated/);
  expect(swapped).toBe(true); expect(run).toHaveBeenCalledTimes(readOnly ? 1 : 0);
});

it.each([false, true])("checks the opened file after a descendant ancestor exchange (readOnly=%s)", async readOnly => {
  const nested = path.join(workspace, "nested"), target = data(nested);
  await fs.mkdir(nested); await fs.writeFile(target, "inside");
  const open = fs.open.bind(fs); let swapped = false;
  vi.spyOn(fs, "open").mockImplementation((...args: Parameters<typeof fs.open>) => {
    if (!swapped && String(args[0]) === target) {
      swapped = true; renameSync(nested, nested + "-held"); symlinkSync(sibling, nested);
    }
    return open(...args);
  });
  await expect(withIsolatedFilesystem(workspace, () => readFile(target), { readOnly })).rejects.toThrow(/outside readable roots/);
  expect(swapped).toBe(true);
});

it.each([false, true])("rejects replacement reads after the pinned root moves (readOnly=%s)", async readOnly => {
  await withIsolatedFilesystem(workspace, async () => {
    await expect(readFile(data(workspace))).resolves.toBe("task");
    await fs.rename(workspace, workspace + "-held");
    await fs.mkdir(workspace); await fs.writeFile(data(workspace), "replacement");
    await expect(readFile(data(workspace))).rejects.toThrow(/isolated/);
  }, { readOnly });
});

it.each([false, true])("compares resolved reads with the pinned literal root after an ABA exchange (readOnly=%s)", async readOnly => {
  const target = data(workspace), held = workspace + "-held";
  const realpath = fs.realpath.bind(fs);
  let swapped = false, restored = false;
  const restore = async () => {
    await fs.unlink(workspace); await fs.rename(held, workspace); restored = true;
  };
  vi.spyOn(fs, "realpath").mockImplementation(async (...args: Parameters<typeof fs.realpath>) => {
    const requested = String(args[0]);
    if (!swapped && requested === target) {
      await fs.rename(workspace, held); await fs.symlink(sibling, workspace); swapped = true;
      return realpath(...args);
    }
    if (swapped && !restored && requested === workspace) {
      const outsideRoot = await realpath(...args);
      await restore();
      return outsideRoot;
    }
    if (swapped && !restored && requested.startsWith("/proc/self/fd/")) await restore();
    return realpath(...args);
  });
  await expect(withIsolatedFilesystem(workspace, () => resolveReadable(target), { readOnly })).rejects.toThrow(/outside readable roots/);
  expect(swapped).toBe(true); expect(restored).toBe(true);
  expect(await fs.readFile(target, "utf8")).toBe("task");
});
