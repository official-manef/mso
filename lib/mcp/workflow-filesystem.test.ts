import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkflowOrchestrationSnapshot } from "@/lib/contracts/orchestration";
import type { CapabilityTool } from "@/lib/capabilities/tool";
import type { Scope } from "@/lib/capabilities/scope";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/host/audit-api", async original => {
  const actual = await original() as typeof import("@/lib/host/audit-api");
  return { ...actual, audit: vi.fn(async () => {}) };
});
vi.mock("@/lib/agent/session-store", async original => {
  const actual = await original() as typeof import("@/lib/agent/session-store");
  return { ...actual, maybeAutoTitleAgentSession: vi.fn(async () => {}), appendAgentSessionEvent: vi.fn(async () => {}) };
});

const { executeCapabilityCall } = await import("@/lib/capabilities/execute");
const { workflowActor } = await import("@/lib/capabilities/actors");
const { startWorkflow, activeWorkflowForActor, cancelWorkflow, resetWorkflowStoreCache } = await import("@/lib/workflow");
const { READ_TOOLS } = await import("./tools-read");
const { MUTATE_TOOLS } = await import("./tools-mutate");
const { WORKFLOW_LIFECYCLE_TOOLS } = await import("./tools-workflow-lifecycle");
const { sha256Text, readFile: hostReadFile } = await import("@/lib/host/fs-api");
const tenancy = await import("@/lib/tenancy/capability");
const read = READ_TOOLS.find(tool => tool.name === "fs_read")!;
const write = MUTATE_TOOLS.find(tool => tool.name === "fs_write")!;
const status = WORKFLOW_LIFECYCLE_TOOLS.find(tool => tool.name === "workflow_status")!;
const actor = "mcp:workspace-read-test";
const owner = { principal: "workspace-client", sessionId: "session-a" };
let base: string, canonical: string, workspace: string, sibling: string, workflowId: string;
const data = (root: string) => path.join(root, "data.txt");
const orchestration = (workspacePath?: string): WorkflowOrchestrationSnapshot => ({
  risk: "medium", complexity: "light", contention: "none", memoryRelevance: "low",
  isolation: "isolated-worktree", verification: "affected", reasons: [], sharedResourceWarnings: [],
  changedPaths: [], affectedPaths: [], reservedResources: [], overlappingPaths: [], overlappingResources: [],
  activeProjectWorkflows: 0, conflictingWorkflowCount: 0, memoryHits: 0, contextEstimateTokens: 0,
  cleanupState: "pending", createdAt: new Date().toISOString(), workspacePath,
});
async function start(workspacePath?: string) {
  return (await startWorkflow({
    actor: workflowActor(actor, owner), scope: "exec", intent: "Fix the fixture source",
    project: canonical, orchestration: orchestration(workspacePath),
  })).workflow.id;
}
const call = (tool: CapabilityTool, args: Record<string, unknown>, scope: Scope = "read", context = owner) =>
  executeCapabilityCall({ tool, args, scope, actor, context });

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mso-workflow-fs-")));
  canonical = path.join(base, "canonical"); workspace = path.join(base, "cache", "task"); sibling = path.join(base, "cache", "other");
  for (const root of [canonical, workspace, sibling]) {
    await fs.mkdir(root, { recursive: true }); await fs.writeFile(data(root), path.basename(root));
  }
  vi.stubEnv("OS_FS_READ_ROOTS", canonical); vi.stubEnv("OS_FS_WRITE_ROOTS", base);
  vi.stubEnv("OS_SKILL_MEMORY_STORE", path.join(base, "workflow.json"));
  vi.stubEnv("OS_MCP_ACTIVITY_LOG", "");
  resetWorkflowStoreCache(); workflowId = await start(workspace);
});
afterEach(async () => {
  resetWorkflowStoreCache(); vi.restoreAllMocks(); vi.unstubAllEnvs();
  await fs.rm(base, { recursive: true, force: true });
});

it("authorizes bounded worktree reads and optimistic writes through the real capability kernel", async () => {
  const result = await call(read, { path: data(workspace), workflow_id: workflowId });
  expect(result).toMatchObject({ kind: "success", result: { content: "task", sha256: sha256Text("task") } });
  const args = { path: data(workspace), content: "updated", expected_sha256: sha256Text("task"), workflow_id: workflowId };
  expect(await call(write, args, "read")).toMatchObject({ kind: "error", message: expect.stringContaining('needs "write"') });
  expect(await call(write, args, "exec")).toMatchObject({ kind: "success", result: { previousSha256: sha256Text("task") } });
  expect(await call(write, args, "exec")).toMatchObject({ kind: "error", message: expect.stringContaining("changed since fs_read") });
  expect(await call(read, { path: data(canonical), workflow_id: workflowId }))
    .toMatchObject({ kind: "success", result: { content: "canonical" } });
});

it("requires the exact active workflow owned by the current client session", async () => {
  expect(await call(read, { path: data(workspace) }))
    .toMatchObject({ kind: "error", message: expect.stringContaining("outside readable roots") });
  for (const context of [{ ...owner, sessionId: "session-b" }, { ...owner, principal: "other-client" }])
    expect(await call(read, { path: data(workspace), workflow_id: workflowId }, "read", context))
      .toMatchObject({ kind: "error", message: expect.stringContaining("not found for this MSO session") });
  expect(await call(read, { path: data(workspace), workflow_id: "missing" }))
    .toMatchObject({ kind: "error", message: expect.stringContaining("not found for this MSO session") });
  const siblingWorkflow = await start(sibling);
  expect(await call(read, { path: data(sibling), workflow_id: workflowId }))
    .toMatchObject({ kind: "error", message: expect.stringContaining("outside readable roots") });
  expect(await call(read, { path: data(sibling), workflow_id: siblingWorkflow }))
    .toMatchObject({ kind: "success", result: { content: "other" } });
  await cancelWorkflow({ actor: workflowActor(actor, owner), workflowId });
  expect(await call(read, { path: data(workspace), workflow_id: workflowId }))
    .toMatchObject({ kind: "error", message: expect.stringContaining("not found for this MSO session") });
});

it.each(["unprepared", "removed"] as const)("keeps configured reads and metadata available when the workspace is %s", async state => {
  const id = state === "unprepared" ? await start() : workflowId;
  if (state === "removed") await fs.rm(workspace, { recursive: true });
  const metadata: CapabilityTool = { ...status, name: "workspace_metadata_test", run: async () => ({ ready: true }) };
  expect(await call(metadata, { workflow_id: id })).toMatchObject({ kind: "success", result: { ready: true } });
  expect(await call(read, { path: data(canonical), workflow_id: id }))
    .toMatchObject({ kind: "success", result: { content: "canonical" } });
  expect(await call(read, { path: data(workspace), workflow_id: id })).toMatchObject({ kind: "error" });
  expect(await call(write, { path: data(workspace), content: "changed", workflow_id: id }, "exec"))
    .toMatchObject({ kind: "error", message: expect.stringContaining(state === "unprepared" ? "no verified workspace" : "ENOENT") });
});


it.each(["unprepared", "removed"] as const)("keeps owned workflow status available when the workspace is %s", async state => {
  const id = state === "unprepared" ? await start() : workflowId;
  if (state === "removed") await fs.rm(workspace, { recursive: true });
  const before = await activeWorkflowForActor(workflowActor(actor, owner), id);
  expect(before).toMatchObject({ orchestration: { isolation: "isolated-worktree" }, steps: [] });

  const result = await call(status, { workflow_id: id });
  expect(result).toMatchObject({ kind: "success", result: { active: true, workflowId: id, project: "canonical", stepCount: 0 } });
  expect(JSON.stringify(result)).not.toContain(canonical);
  expect((await activeWorkflowForActor(workflowActor(actor, owner), id))?.steps).toEqual(before!.steps);
  for (const context of [{ ...owner, sessionId: "session-b" }, { ...owner, principal: "other-client" }])
    expect(await call(status, { workflow_id: id }, "read", context))
      .toMatchObject({ kind: "success", result: { active: false, workflowId: id, stepCount: 0, steps: [] } });
});

it("does not probe the workspace or leave read authority behind when returning status", async () => {
  const open = vi.spyOn(fs, "open"), realpath = vi.spyOn(fs, "realpath");
  expect(await call(status, { workflow_id: workflowId }))
    .toMatchObject({ kind: "success", result: { active: true, workflowId } });
  for (const spy of [open, realpath])
    expect(spy.mock.calls.some(args => String(args[0]) === workspace || String(args[0]).startsWith(workspace + path.sep))).toBe(false);
  await expect(hostReadFile(data(workspace))).rejects.toThrow(/outside readable roots/);
});

it("requires nested capability calls to forward their exact workflow id", async () => {
  const nested: CapabilityTool = {
    ...read, name: "workspace_nested_test",
    run: async args => ({
      standalone: await call(read, { path: data(workspace) }),
      correlated: await call(read, { path: data(workspace), workflow_id: args.workflow_id }),
    }),
  };
  expect(await call(nested, { path: data(workspace), workflow_id: workflowId })).toMatchObject({
    kind: "success", result: {
      standalone: { kind: "error", message: expect.stringContaining("outside readable roots") },
      correlated: { kind: "success", result: { content: "task" } },
    },
  });
});

it("clears inherited read authority before nested tenant planning", async () => {
  let planningRead: PromiseSettledResult<string> | undefined;
  const originalPlan = tenancy.tenantCapabilityPlan;
  const nested: CapabilityTool = {
    ...read, name: "workspace_tenant_entry_test",
    run: async () => {
      const spy = vi.spyOn(tenancy, "tenantCapabilityPlan").mockImplementationOnce(async (...args) => {
        [planningRead] = await Promise.allSettled([hostReadFile(data(workspace))]);
        return originalPlan(...args);
      });
      try { return await call(read, { path: data(canonical) }); }
      finally { spy.mockRestore(); }
    },
  };
  expect(await call(nested, { path: data(workspace), workflow_id: workflowId }))
    .toMatchObject({ kind: "success", result: { kind: "success", result: { content: "canonical" } } });
  expect(planningRead).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: expect.stringContaining("outside readable roots") }) });
});
