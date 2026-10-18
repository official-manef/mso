import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import { parseWorkflowGraphDefinition } from "@/lib/workflow/graph-schema";
import { ONBOARDING_KEY, firstCheckGraph, matchesFirstCheck, readOnboardingProgress, shouldOpenOnboarding, writeOnboardingProgress, type OnboardingProgress } from "./onboarding-state";

const project = { id: "root/project", name: "Project" };
const progress: OnboardingProgress = { step: "receipt", project, attempt: { graphId: "graph-1", key: "onboarding:request-1", runId: "run-1" } };
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const graph: WorkflowGraph = { ...parseWorkflowGraphDefinition(firstCheckGraph(project, "graph-1")), id: "graph-1", version: 2, revision: "a".repeat(64), createdAt: "", updatedAt: "" };

describe("onboarding progress and reviewed action", () => {
  it("preserves the legacy skip choice independently of resumable progress", () => {
    const saved = storage();
    expect(shouldOpenOnboarding(saved)).toBe(true);
    saved.setItem(ONBOARDING_KEY, "done");
    expect(shouldOpenOnboarding(saved)).toBe(false);
    expect(writeOnboardingProgress(saved, progress)).toBe(true);
    expect(shouldOpenOnboarding(saved)).toBe(false);
    expect(saved.getItem(ONBOARDING_KEY)).toBe("done");
  });

  it("persists only resumable references without trusting a local completion or secret field", () => {
    const saved = storage();
    const injected = { ...progress, completed: true, apiKey: "fixture-private-value", project: { ...project, credential: "fixture-private-value" }, attempt: { ...progress.attempt!, state: "completed" } };
    expect(writeOnboardingProgress(saved, injected)).toBe(true);
    expect(readOnboardingProgress(saved)).toEqual(progress);
    expect([...saved.values.values()].map((value) => JSON.parse(value))).toEqual([progress]);
  });

  it("recovers safely from corrupt, missing or unavailable browser storage", () => {
    expect(readOnboardingProgress({ getItem: () => "{" })).toEqual({ step: "welcome" });
    expect(readOnboardingProgress({ getItem: () => '{"step":"receipt"}' })).toEqual({ step: "project" });
    expect(readOnboardingProgress({ getItem: () => JSON.stringify({ ...progress, attempt: { graphId: "../invalid", key: "request" } }) })).toEqual({ step: "receipt", project });
    expect(readOnboardingProgress({ getItem: () => JSON.stringify({ ...progress, attempt: { ...progress.attempt, runId: "../invalid" } }) })).toEqual({ ...progress, attempt: { graphId: "graph-1", key: "onboarding:request-1" } });
    const unavailable = { getItem: () => { throw new Error("storage blocked"); }, setItem: () => { throw new Error("storage full"); } };
    expect(readOnboardingProgress(unavailable)).toEqual({ step: "welcome" });
    expect(shouldOpenOnboarding(unavailable)).toBe(true);
    expect(writeOnboardingProgress(unavailable, progress)).toBe(false);
    expect(readOnboardingProgress(undefined)).toEqual({ step: "welcome" });
    expect(writeOnboardingProgress(undefined, progress)).toBe(false);
  });

  it("survives the authoritative workflow schema with only the intended project read", () => {
    expect(matchesFirstCheck(graph, project, graph.id)).toBe(true);
    expect(graph.nodes.map((node) => node.type)).toEqual(["manual", "project", "tool", "output"]);
    expect(graph.nodes.find((node) => node.type === "tool")?.config.tool).toBe("project_get");
  });

  it("rejects modified tool, project, disabled node and failure workflow execution semantics", () => {
    const changed: WorkflowGraph[] = [
      { ...graph, nodes: graph.nodes.map((node) => node.id === "inspect" ? { ...node, config: { tool: "exec_run" } } : node) },
      { ...graph, nodes: graph.nodes.map((node) => node.id === "project" ? { ...node, config: { project: "another/project" } } : node) },
      { ...graph, nodes: graph.nodes.map((node) => node.id === "inspect" ? { ...node, disabled: true } : node) },
      { ...graph, metadata: { ...graph.metadata, errorWorkflowId: "another-workflow" } },
    ];
    for (const value of changed) expect(matchesFirstCheck(value, project, graph.id)).toBe(false);
    expect(matchesFirstCheck({ ...graph, name: "Owner renamed the check" }, project, graph.id)).toBe(true);
  });
});
