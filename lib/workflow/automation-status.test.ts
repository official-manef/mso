import { afterEach, expect, it, vi } from "vitest";
import type { FlowRun } from "@/lib/contracts/automation";

const read = vi.hoisted(() => vi.fn());
vi.mock("./automation-store", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("./automation-store");
  return { ...actual, readFlowRun: read };
});
const { flowStatus } = await import("./automation-engine");
const state = globalThis as typeof globalThis & { msoFlowInstance?: string; msoFlowPending?: Map<string, Promise<void>> };
const pending = state.msoFlowPending!;
const context = { principal: "status-test-owner", sessionId: "status-test-session", scope: "exec" as const };
const id = "c".repeat(32);

afterEach(() => { pending.delete(id); read.mockReset(); });

it.each(["failed", "completed"] as const)("refreshes a stale receipt when execution becomes %s during the first read", async (terminal) => {
  const run: FlowRun = {
    version: 1, id, owner: "a".repeat(64), sessionId: context.sessionId, project: "fixture", flow: "fixture",
    fingerprint: "fixture", pid: process.pid, instance: state.msoFlowInstance!, state: "running",
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: [],
  };
  let finish!: () => void;
  const work = new Promise<void>(resolve => { finish = resolve; }).finally(() => pending.delete(id));
  pending.set(id, work);
  // The open descriptor retains the old receipt while execution publishes its final replacement.
  read.mockImplementationOnce(async () => { finish(); await work; return run; });
  read.mockResolvedValueOnce({ ...run, state: terminal });

  expect((await flowStatus(id, context, 5000)).state).toBe(terminal);
  expect(read).toHaveBeenCalledTimes(2);
});
