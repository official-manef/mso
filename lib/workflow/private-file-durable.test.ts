import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinSecurityStorePath } from "@/lib/security-store-path";
import { writeWorkflowFile } from "./private-file";

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-workflow-durable-")); roots.push(root);
  const target = path.join(root, "cold", "owner", "run.json.schedule-claim");
  // The run lock can create the directory chain before the claim writer opens it.
  const pinned = await pinSecurityStorePath(target); await pinned.directory.close();
  return { root, target, folder: path.dirname(target) };
}
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

describe("durable workflow intent writes", () => {
  it("awaits existing ancestor syncs, file sync before rename, and pinned directory sync after rename", async () => {
    const { target, folder } = await fixture(), events: string[] = [];
    const open = fs.open.bind(fs), rename = fs.rename.bind(fs); let temporary = "";
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args), name = await fs.realpath(`/proc/self/fd/${handle.fd}`), sync = handle.sync.bind(handle);
      if (name.endsWith(".tmp")) temporary = name;
      vi.spyOn(handle, "sync").mockImplementation(async () => { await sync(); events.push(`synced:${name}`); });
      return handle;
    });
    vi.spyOn(fs, "rename").mockImplementation(async (...args) => { events.push("rename:start"); await rename(...args); events.push("rename:done"); });
    await writeWorkflowFile(target, '{"phase":"intent_committed"}', { durable: true }); events.push("returned");
    const ancestors: string[] = [];
    for (let parent = path.dirname(folder);; parent = path.dirname(parent)) { ancestors.unshift(parent); if (parent === path.parse(parent).root) break; }
    expect(temporary).toContain(".schedule-claim.");
    expect(events).toEqual([...ancestors.map(name => `synced:${name}`), `synced:${temporary}`, "rename:start", "rename:done", `synced:${folder}`, "returned"]);
    expect(await fs.readFile(target, "utf8")).toBe('{"phase":"intent_committed"}');
    expect(await fs.readdir(folder)).toEqual([path.basename(target)]);
  });
  it.each(["ancestor", "file", "directory"] as const)("fails closed and closes pinned descriptors on %s sync failure", async (stage) => {
    const { target, folder } = await fixture(), open = fs.open.bind(fs), handles: Awaited<ReturnType<typeof fs.open>>[] = [];
    const failure = Object.assign(new Error("fixture filesystem cannot sync"), { code: "EINVAL" }); let failures = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args), name = await fs.realpath(`/proc/self/fd/${handle.fd}`); handles.push(handle);
      const selected = stage === "ancestor" ? name === path.dirname(folder) : stage === "directory" ? name === folder : name.endsWith(".tmp");
      if (selected) vi.spyOn(handle, "sync").mockImplementation(async () => { failures += 1; throw failure; });
      return handle;
    });
    const write = writeWorkflowFile(target, "intent", { durable: true });
    if (stage === "directory") await expect(write).rejects.toMatchObject({ message: "workflow file commit uncertain; reconcile before retrying", cause: failure });
    else await expect(write).rejects.toBe(failure);
    expect(failures).toBe(1); expect(handles.every(handle => handle.fd === -1)).toBe(true);
    if (stage === "directory") expect(await fs.readFile(target, "utf8")).toBe("intent");
    else await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fs.readdir(folder)).some(name => name.endsWith(".tmp"))).toBe(false);
  });
  it("keeps durable syncing opt-in for ordinary workflow writes", async () => {
    const { target } = await fixture(), open = fs.open.bind(fs); let syncs = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      vi.spyOn(handle, "sync").mockImplementation(async () => { syncs += 1; throw new Error("unexpected durable operation"); });
      return handle;
    });
    await writeWorkflowFile(target, "receipt");
    expect(syncs).toBe(0); expect(await fs.readFile(target, "utf8")).toBe("receipt");
  });
});
