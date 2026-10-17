import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { listProjects } from "./project-list";
import { PROJECT_LIMITS } from "./project-roots";
import { resolveProjectHint } from "./projects";

let root: string;
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mso-root-recovery-")));
  vi.stubEnv("OS_FS_READ_ROOTS", root);
  vi.stubEnv("OS_PROJECT_ROOTS", "");
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

describe("configured-root discovery recovery", () => {
  it("offers exact-path inspection while preserving an existing root-project identity", async () => {
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture-root" }));
    const before = await resolveProjectHint(root);
    expect(before).toMatchObject({ path: root, packageName: "fixture-root" });

    const result = await listProjects({ query: path.basename(root) });
    expect(result).toMatchObject({ total: 0, projects: [], scan: { truncated: false } });
    expect(result.containers.map(container => container.path)).toEqual([root]);
    expect(result.nextAction).toContain("project_get");
    expect(result.nextAction).toContain("exact path");
    const after = await resolveProjectHint(result.containers[0].path);
    expect(after).toMatchObject({ id: before!.id, path: root, packageName: "fixture-root" });
  });

  it("keeps an empty container unclassified as a repository", async () => {
    const result = await listProjects();
    expect(result).toMatchObject({ total: 0, projects: [], scan: { truncated: false } });
    expect(result.containers.map(container => container.path)).toEqual([root]);
    expect(result.nextAction).toContain("Container entries do not establish repository contents.");
  });

  it("does not suggest root recovery for an exhausted page that has matching projects", async () => {
    await fs.mkdir(path.join(root, "child"));
    const result = await listProjects({ offset: 1 });
    expect(result).toMatchObject({ total: 1, projects: [], hasMore: false });
    expect(result.nextAction).toBeUndefined();
  });

  it("keeps a zero-result deadline scan resumable", async () => {
    await fs.mkdir(path.join(root, "child"));
    const epoch = 1_800_000_000_000;
    let calls = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => epoch + (calls++ === 0 ? 0 : PROJECT_LIMITS.maxScanMs + 1));
    const first = await listProjects();
    expect(first).toMatchObject({ total: 0, projects: [], scan: { truncated: true, truncationReasons: ["deadline"] } });
    expect(first.nextAction).toContain("scan.continuation.cursor");
    expect(first.scan.continuation?.cursor).toBeTruthy();

    clock.mockReturnValue(epoch + PROJECT_LIMITS.maxScanMs + 1);
    const resumed = await listProjects({ cursor: first.scan.continuation!.cursor });
    expect(resumed).toMatchObject({ total: 1, scan: { truncated: false } });
    expect(resumed.projects.map(project => project.path)).toEqual([path.join(root, "child")]);
    expect(resumed.nextAction).toBeUndefined();
  });
});

