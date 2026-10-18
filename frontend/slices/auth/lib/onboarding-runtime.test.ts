import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { firstCheckGraph, type OnboardingProgress } from "./onboarding-state";
import { firstCheckComplete } from "./onboarding-api";

const access = vi.hoisted(() => ({ role: "owner" }));
vi.mock("@/lib/auth/device-store", () => ({ getApprovedDevice: async () => ({ role: access.role }) }));
const dir = await mkdtemp(path.join(os.tmpdir(), "mso-first-check-"));
const projectPath = path.join(dir, "projects", "first-project");
await mkdir(projectPath, { recursive: true, mode: 0o700 });
await writeFile(path.join(projectPath, "package.json"), '{"name":"first-project","version":"1.0.0","private":true}\n', { mode: 0o600 });
vi.stubEnv("OS_AGENT_SESSIONS_DIR", path.join(dir, "sessions"));
vi.stubEnv("OS_FS_READ_ROOTS", dir);
vi.stubEnv("OS_FS_WRITE_ROOTS", dir);
vi.stubEnv("OS_MCP_MAX_SCOPE", "read");
const { listProjects } = await import("@/lib/host/projects-api");
const { PROJECT_STATE_TOOLS } = await import("@/lib/mcp/tools-project-state");
const { createWorkflowGraph } = await import("@/lib/workflow/graph-store");
const { startWorkflowGraph, workflowGraphRunStatus } = await import("@/lib/workflow/graph-engine");
const principal = "web:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const context = { principal, actor: principal, sessionId: "first-check-session", scope: "read" as const };
afterAll(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

describe("first check through the shared workflow runtime", () => {
  it("reads a real bounded project and persists one receipt across duplicate dispatch and reopening", async () => {
    const project = (await listProjects()).projects.find((row) => row.path === projectPath);
    expect(project).toBeDefined();
    const selected = { id: project!.id, name: project!.name };
    const graph = await createWorkflowGraph(principal, firstCheckGraph(selected, "first-project-check"));
    const before = await readFile(path.join(projectPath, "package.json"), "utf8");
    const resolve = (name: string) => PROJECT_STATE_TOOLS.find((tool) => tool.name === name);
    const started = await startWorkflowGraph(graph, {}, "first-request", context, resolve);
    const done = await workflowGraphRunStatus(principal, started.id, 5000, "read");
    const progress: OnboardingProgress = { step: "receipt", project: selected, attempt: { graphId: graph.id, key: "first-request", runId: started.id } };
    expect(done.state, done.error || done.nodes.find((node) => node.state === "failed")?.error).toBe("completed");
    expect(firstCheckComplete(done, progress)).toBe(true);
    expect(done.nodes.find((node) => node.id === "inspect")?.output).toMatchObject({ project: { id: selected.id, path: projectPath }, package: { name: "first-project", version: "1.0.0" } });
    expect((await startWorkflowGraph(graph, {}, "first-request", context, resolve)).id).toBe(started.id);
    expect(firstCheckComplete(await workflowGraphRunStatus(principal, started.id, 0, "read"), progress)).toBe(true);
    expect(await readFile(path.join(projectPath, "package.json"), "utf8")).toBe(before);
    expect(await readdir(projectPath)).toEqual(["package.json"]);
    await expect(workflowGraphRunStatus("web:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", started.id)).rejects.toThrow("not found");
    access.role = "viewer";
    await expect(workflowGraphRunStatus(principal, started.id, 0, "read")).rejects.toThrow();
    access.role = "owner";
  });
});
