import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CapabilityTool } from "@/lib/capabilities/tool";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";

const mocks = vi.hoisted(() => ({ device: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/auth/device-store", () => ({ getApprovedDevice: mocks.device }));
vi.mock("@/lib/capabilities/execute", () => ({ executeCapabilityCall: async ({ tool, args, context }: { tool: CapabilityTool; args: Record<string, unknown>; context: never }) => {
  try { return { kind: "success", result: await tool.run(args, context) }; } catch (error) { return { kind: "error", message: String(error) }; }
} }));
const principal = "web:aaaaaaaaaaaaaaaa", due = new Date("2026-10-19T02:00:30Z");
let dir: string;
const tool: CapabilityTool = { name: "fixture_schedule", scope: "read", description: "fixture", inputSchema: { type: "object", properties: {} }, run: mocks.run };
const resolve = (name: string) => name === tool.name ? tool : undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "mso-schedule-"));
  vi.stubEnv("OS_AGENT_SESSIONS_DIR", dir); vi.stubEnv("OS_MCP_MAX_SCOPE", "exec");
  mocks.device.mockReset().mockResolvedValue({ role: "owner" }); mocks.run.mockReset().mockResolvedValue({ ok: true });
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

async function graph(status = "active", disabled = false): Promise<WorkflowGraph> {
  const { createWorkflowGraph } = await import("./graph-store");
  return createWorkflowGraph(principal, { name: "Once", description: "", status, inputs: {}, metadata: {}, nodes: [
    { id: "schedule", name: "Once", type: "schedule", disabled, position: { x: 0, y: 0 }, config: { mode: "runAt", runAt: "2026-10-19T09:00:30+07:00", missedPolicy: "run_once" } },
    { id: "action", name: "Count", type: "tool", position: { x: 100, y: 0 }, config: { tool: tool.name, arguments: {} } },
  ], edges: [{ id: "edge", source: "schedule", target: "action" }] });
}
async function runs() {
  const { workflowGraphOwner } = await import("./graph-store"), { listWorkflowGraphRuns } = await import("./graph-run-store");
  return listWorkflowGraphRuns(workflowGraphOwner(principal));
}
async function finish() {
  const { workflowGraphRunStatus } = await import("./graph-engine");
  const rows = await runs(); expect(rows.total).toBe(1);
  const done = await workflowGraphRunStatus(principal, rows.runs[0].id, 5000);
  expect(done.state).toBe("completed"); return done;
}

describe("persisted one-shot schedule execution", () => {
  it.each([
    { mode: "cron", config: { mode: "cron", everyMinutes: 60, cron: "30 9 * * *", timezone: "Asia/Jakarta" }, before: "2026-10-19T02:00:30Z", at: "2026-10-19T02:30:30Z", invalid: { cron: "not cron" } },
    { mode: "interval", config: { mode: "interval", everyMinutes: 60, cron: "30 9 * * *", timezone: "Asia/Jakarta" }, before: "2026-10-19T02:30:30Z", at: "2026-10-19T03:00:30Z", invalid: { everyMinutes: 0 } },
  ])("loads baseline UI-shaped $mode records and executes only the selected mode", async ({ mode, config, before, at, invalid }) => {
    const saved = await graph(); await graph("draft");
    const { workflowGraphOwner } = await import("./graph-store");
    const target = path.join(dir, ".workflow-graphs", workflowGraphOwner(principal), "graphs.json");
    const stored = JSON.parse(await readFile(target, "utf8"));
    stored.graphs.find((row: WorkflowGraph) => row.id === saved.id).nodes[0].config = config;
    await writeFile(target, JSON.stringify(stored), { mode: 0o600 }); vi.resetModules();
    const { listWorkflowGraphs, createWorkflowGraph } = await import("./graph-store");
    const loaded = await listWorkflowGraphs(principal); expect(loaded).toHaveLength(2);
    const current = loaded.find(row => row.id === saved.id)!; expect(current.nodes[0].config).toEqual(config);
    const { tickWorkflowScheduler } = await import("./graph-triggers");
    await tickWorkflowScheduler(resolve, new Date(before)); expect((await runs()).total).toBe(0);
    await tickWorkflowScheduler(resolve, new Date(at)); expect((await finish()).trigger).toMatchObject({ scheduleMode: mode });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    const invalidNode = { ...current.nodes[0], config: { ...config, ...invalid } };
    await expect(createWorkflowGraph(principal, { ...current, id: undefined, nodes: [invalidNode, current.nodes[1]] })).rejects.toThrow();
    const { scheduleBucket } = await import("./schedule");
    expect(() => scheduleBucket(invalidNode, new Date(at))).toThrow();
  });
  it("dispatches once across concurrent ticks, late ticks, module reload and receipt deletion", async () => {
    await graph(); const { tickWorkflowScheduler } = await import("./graph-triggers");
    await tickWorkflowScheduler(resolve, new Date(due.getTime() - 1)); expect((await runs()).total).toBe(0);
    await Promise.all(Array.from({ length: 8 }, () => tickWorkflowScheduler(resolve, due)));
    const done = await finish(); expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(done.trigger).toMatchObject({ type: "schedule", scheduleMode: "runAt", scheduledAt: due.toISOString() });
    vi.resetModules(); const { tickWorkflowScheduler: restarted } = await import("./graph-triggers");
    await restarted(resolve, new Date("2026-11-20T00:00:00Z")); expect((await runs()).total).toBe(1);
    const { workflowGraphOwner } = await import("./graph-store");
    const { deleteWorkflowGraphRun, readWorkflowGraphScheduleClaim } = await import("./graph-run-store");
    await deleteWorkflowGraphRun(workflowGraphOwner(principal), done.id);
    expect(await readWorkflowGraphScheduleClaim(workflowGraphOwner(principal), done.id)).toMatchObject({ phase: "run_finished", runState: "completed" });
    await restarted(resolve, due); expect((await runs()).total).toBe(0); expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("catches up once when the first available tick is late", async () => {
    await graph(); const { tickWorkflowScheduler } = await import("./graph-triggers");
    const late = new Date("2026-11-01T00:00:00Z"); await tickWorkflowScheduler(resolve, late);
    const done = await finish();
    expect(done.trigger).toMatchObject({ scheduledAt: due.toISOString(), receivedAt: late.toISOString() });
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("retains the one-shot identity when old detailed receipts are pruned", async () => {
    await graph(); const { tickWorkflowScheduler } = await import("./graph-triggers");
    await tickWorkflowScheduler(resolve, due); const done = await finish();
    const { workflowGraphOwner } = await import("./graph-store"), owner = workflowGraphOwner(principal);
    const folder = path.join(dir, ".workflow-graph-runs", owner);
    await utimes(path.join(folder, `${done.id}.json`), new Date(0), new Date(0));
    await Promise.all(Array.from({ length: 1000 }, (_, index) => writeFile(path.join(folder, `${(index + 1).toString(16).padStart(32, "0")}.json`), "{}", { mode: 0o600 })));
    const { pruneWorkflowGraphRuns, readWorkflowGraphRun, readWorkflowGraphScheduleClaim } = await import("./graph-run-store");
    await pruneWorkflowGraphRuns(owner); expect(await readWorkflowGraphRun(owner, done.id)).toBeNull();
    expect(await readWorkflowGraphScheduleClaim(owner, done.id)).toMatchObject({ phase: "run_finished" });
    await tickWorkflowScheduler(resolve, due); expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch or retry an intent whose initial receipt write failed", async () => {
    await graph(); const privateFile = await import("./private-file"), write = privateFile.writeWorkflowFile;
    vi.spyOn(privateFile, "writeWorkflowFile").mockImplementation(async (target, body, options) => {
      if (target.includes(".workflow-graph-runs") && target.endsWith(".json")) throw new Error("fixture disk full after intent");
      await write(target, body, options);
    });
    const { tickWorkflowScheduler } = await import("./graph-triggers"); await tickWorkflowScheduler(resolve, due);
    const { workflowGraphOwner } = await import("./graph-store"), owner = workflowGraphOwner(principal);
    const files = await readdir(path.join(dir, ".workflow-graph-runs", owner)), marker = files.find(name => name.endsWith(".schedule-claim"));
    expect(marker).toBeTruthy(); const { readWorkflowGraphScheduleClaim } = await import("./graph-run-store");
    expect(await readWorkflowGraphScheduleClaim(owner, marker!.slice(0, 32))).toMatchObject({ phase: "intent_committed", runState: "running" });
    vi.restoreAllMocks(); vi.resetModules(); await (await import("./graph-triggers")).tickWorkflowScheduler(resolve, due);
    expect((await runs()).total).toBe(0); expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(["ancestor", "file", "directory"] as const)("blocks dispatch when the intent %s sync fails", async (stage) => {
    await graph(); const { workflowGraphOwner } = await import("./graph-store"), owner = workflowGraphOwner(principal);
    const folder = path.join(dir, ".workflow-graph-runs", owner), open = fs.open.bind(fs); let failures = 0;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args), name = await fs.realpath(`/proc/self/fd/${handle.fd}`);
      const selected = stage === "ancestor" ? name === path.dirname(folder) : stage === "directory" ? name === folder : name.includes(".schedule-claim.") && name.endsWith(".tmp");
      if (selected) vi.spyOn(handle, "sync").mockImplementation(async () => { failures += 1; throw Object.assign(new Error("fixture sync failure"), { code: "EIO" }); });
      return handle;
    });
    await (await import("./graph-triggers")).tickWorkflowScheduler(resolve, due);
    expect(failures).toBe(1); expect(mocks.run).not.toHaveBeenCalled(); expect((await runs()).total).toBe(0);
    const files = await readdir(folder), claims = files.filter(name => name.endsWith(".schedule-claim"));
    expect(files.some(name => name.endsWith(".tmp"))).toBe(false);
    expect(claims).toHaveLength(stage === "directory" ? 1 : 0);
    if (stage === "directory") {
      const { readWorkflowGraphScheduleClaim } = await import("./graph-run-store");
      expect(await readWorkflowGraphScheduleClaim(owner, claims[0].slice(0, 32))).toMatchObject({ phase: "intent_committed", runState: "running" });
    }
    vi.restoreAllMocks(); vi.resetModules(); await (await import("./graph-triggers")).tickWorkflowScheduler(resolve, due);
    if (stage === "directory") { expect((await runs()).total).toBe(0); expect(mocks.run).not.toHaveBeenCalled(); }
    else { await finish(); expect(mocks.run).toHaveBeenCalledTimes(1); }
  });
  it("uses the existing atomic run guard for concurrent dispatch and refuses replay after receipt deletion", async () => {
    const saved = await graph(), { startWorkflowGraph, workflowGraphRunStatus } = await import("./graph-engine");
    const context = { principal, actor: principal, sessionId: "fixture", scope: "exec" as const };
    const trigger = { type: "schedule" as const, nodeId: "schedule", receivedAt: due.toISOString(), scheduleMode: "runAt" as const, scheduledAt: due.toISOString() };
    const attempts = await Promise.all(Array.from({ length: 6 }, () => startWorkflowGraph(saved, { scheduledAt: due.toISOString() }, "same-instant", context, resolve, principal, trigger)));
    expect(new Set(attempts.map(run => run.id)).size).toBe(1);
    await workflowGraphRunStatus(principal, attempts[0].id, 5000); expect(mocks.run).toHaveBeenCalledTimes(1);
    const { workflowGraphOwner } = await import("./graph-store"), { deleteWorkflowGraphRun } = await import("./graph-run-store");
    await deleteWorkflowGraphRun(workflowGraphOwner(principal), attempts[0].id);
    await expect(startWorkflowGraph(saved, { scheduledAt: due.toISOString() }, "same-instant", context, resolve, principal, trigger)).rejects.toThrow("intent already committed");
  });
  it("does not run drafts, disabled triggers or revoked owners", async () => {
    await graph("draft"); await graph("active", true); await graph(); mocks.device.mockResolvedValue(null);
    await (await import("./graph-triggers")).tickWorkflowScheduler(resolve, due);
    expect((await runs()).total).toBe(0); expect(mocks.run).not.toHaveBeenCalled();
  });
});
