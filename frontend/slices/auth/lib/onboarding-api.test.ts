import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowGraph, WorkflowGraphRun } from "@/lib/contracts/workflow-graph";
import { firstCheckComplete, loadOnboardingProjects, loadReadiness, modelConfigured, runFirstCheck } from "./onboarding-api";
import { firstCheckGraph, type OnboardingProgress } from "./onboarding-state";

afterEach(() => vi.unstubAllGlobals());
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const project = { id: "root/project", name: "Project" };
const progress: OnboardingProgress = { step: "receipt", project, attempt: { graphId: "graph-1", key: "onboarding:request-1" } };
const graph = { ...firstCheckGraph(project, "graph-1"), version: 2, revision: "a".repeat(64), createdAt: "", updatedAt: "" } as WorkflowGraph;
const receipt = { id: "run-1", graphId: graph.id, idempotencyKey: progress.attempt!.key, state: "completed", nodes: graph.nodes.map((node) => ({ ...node, state: "completed", output: node.id === "inspect" ? { project } : {} })) } as unknown as WorkflowGraphRun;

describe("onboarding readiness", () => {
  it("never requests owner config for a delegated role", async () => {
    const fetcher = vi.fn(async (_url: string) => reply({ linuxUser: "fixture" }));
    vi.stubGlobal("fetch", fetcher);
    const result = await loadReadiness("viewer");
    expect(fetcher.mock.calls.map((row) => row[0])).toEqual(["/api/status"]);
    expect(result.model).toBeUndefined();
  });

  it("keeps host evidence visible when provider config is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/status" ? reply({ linuxUser: "fixture" }) : reply({ error: "Unauthorized" }, 403)));
    const result = await loadReadiness("owner");
    expect(result.host?.linuxUser).toBe("fixture");
    expect(result.modelError).toContain("required device role");
    expect(result.model).toBeUndefined();
  });

  it("distinguishes stored OAuth connection metadata from inference verification", () => {
    expect(modelConfigured({ provider: "openai-codex", model: "selected", hasApiKey: false, providers: [{ id: "openai-codex", hasKey: true }] })).toBe(true);
    expect(modelConfigured({ provider: "missing", model: "selected", hasApiKey: false, providers: [{ id: "other", hasKey: true }] })).toBe(false);
  });

  it("uses the bounded project-only view and reports discovery failures", async () => {
    const fetcher = vi.fn(async () => reply({ error: "provider unavailable" }, 503));
    vi.stubGlobal("fetch", fetcher);
    await expect(loadOnboardingProjects("project / one")).rejects.toThrow("provider unavailable");
    expect(fetcher).toHaveBeenCalledWith("/api/v1/alfa/cockpit?view=projects&q=project+%2F+one", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  });
});

describe("first-check dispatch and reconciliation", () => {
  it("creates the reviewed workflow and dispatches its exact revision and stable request key", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ error: "not found" }, 404)).mockResolvedValueOnce(reply({ graph })).mockResolvedValueOnce(reply(receipt));
    vi.stubGlobal("fetch", fetcher);
    await expect(runFirstCheck(progress)).resolves.toEqual(receipt);
    const posted = fetcher.mock.calls.filter(([, init]) => init.method === "POST").map(([, init]) => JSON.parse(init.body));
    expect(posted).toEqual([{ action: "create", graph: firstCheckGraph(project, graph.id) }, { action: "run", graph_id: graph.id, expected_revision: graph.revision, input: {}, idempotency_key: progress.attempt!.key }]);
  });

  it("reuses the request identity after a lost dispatch response instead of creating another graph", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ graph })).mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(reply({ graph })).mockResolvedValueOnce(reply(receipt));
    vi.stubGlobal("fetch", fetcher);
    await expect(runFirstCheck(progress)).rejects.toThrow("connection lost");
    await expect(runFirstCheck(progress)).resolves.toEqual(receipt);
    const posted = fetcher.mock.calls.filter(([, init]) => init.method === "POST").map(([, init]) => JSON.parse(init.body));
    expect(posted).toHaveLength(2);
    expect(posted[0]).toEqual(posted[1]);
    expect(posted.every((body) => body.action === "run")).toBe(true);
  });

  it("reads a saved receipt without submitting another mutation", async () => {
    const fetcher = vi.fn(async () => reply(receipt));
    vi.stubGlobal("fetch", fetcher);
    await expect(runFirstCheck({ ...progress, attempt: { ...progress.attempt!, runId: receipt.id } })).resolves.toEqual(receipt);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/v1/workflows?run_id=run-1&wait_ms=1500", expect.not.objectContaining({ method: "POST" }));
  });

  it("does not create or run anything after access denial or a modified graph", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ error: "unauthorized" }, 403));
    vi.stubGlobal("fetch", fetcher);
    await expect(runFirstCheck(progress)).rejects.toThrow("Access is no longer available");
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockReset().mockResolvedValueOnce(reply({ graph: { ...graph, nodes: [] } }));
    await expect(runFirstCheck(progress)).rejects.toThrow("saved check changed");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("requires completed evidence for every expected step, project and request identity", () => {
    expect(firstCheckComplete(receipt, progress)).toBe(true);
    for (const value of [null, { ...receipt, state: "running" }, { ...receipt, state: "failed" }, { ...receipt, nodes: [] }, { ...receipt, idempotencyKey: "another-request" }, { ...receipt, graphId: "another-graph" }, { ...receipt, nodes: receipt.nodes.map((node) => node.id === "inspect" ? { ...node, state: "skipped" } : node) }]) {
      expect(firstCheckComplete(value as WorkflowGraphRun | null, progress)).toBe(false);
    }
    expect(firstCheckComplete(receipt, { ...progress, project: { id: "another/project", name: "other" } })).toBe(false);
  });
});
