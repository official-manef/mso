import type { DeviceRole } from "@/lib/auth/roles";
import type { WorkflowGraph, WorkflowGraphRun } from "@/lib/contracts/workflow-graph";
import { firstCheckGraph, matchesFirstCheck, type OnboardingProgress, type OnboardingProject } from "./onboarding-state";

export type HostReadiness = { linuxUser: string; readRoots: string[]; writeRoots: string[]; currentAccess: string; publicExposureWarning: string | null };
export type ModelReadiness = { provider: string; model: string; hasApiKey: boolean; providers?: Array<{ id: string; hasKey: boolean }> };
export type ProjectPage = { rows: Array<OnboardingProject & { path: string }>; hasMore: boolean; scan: { truncated?: boolean } };
export type Readiness = { host?: HostReadiness; model?: ModelReadiness; hostError?: string; modelError?: string };
export type ProviderCheck = { ok: boolean; provider?: string; model?: string; error?: string };
export type FirstCheckReceipt = Pick<WorkflowGraphRun, "id" | "graphId" | "graphName" | "idempotencyKey" | "state" | "startedAt" | "finishedAt" | "nodes">;

export class OnboardingRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function onboardingJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json", ...init.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? "Access is no longer available. Sign in with the required device role and reopen setup."
      : typeof body?.error === "string" ? body.error.slice(0, 300) : `The server could not complete the request (${response.status}).`;
    throw new OnboardingRequestError(message, response.status);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OnboardingRequestError("The server returned an invalid response. Refresh and try again.", response.status);
  return body as T;
}

export function onboardingError(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The server could not be reached. Try again.";
}

export async function loadReadiness(role: DeviceRole | null, signal?: AbortSignal): Promise<Readiness> {
  const [host, model] = await Promise.allSettled([
    onboardingJson<HostReadiness>("/api/status", { signal }),
    role === "owner" ? onboardingJson<ModelReadiness>("/api/config", { signal }) : Promise.resolve(undefined),
  ]);
  return {
    ...(host.status === "fulfilled" ? { host: host.value } : { hostError: onboardingError(host.reason) }),
    ...(model.status === "fulfilled" ? { model: model.value } : { modelError: onboardingError(model.reason) }),
  };
}

export async function loadOnboardingProjects(query = "", signal?: AbortSignal): Promise<ProjectPage> {
  const params = new URLSearchParams({ view: "projects", ...(query.trim() ? { q: query.trim().slice(0, 120) } : {}) });
  return (await onboardingJson<{ projects: ProjectPage }>(`/api/v1/alfa/cockpit?${params}`, { signal })).projects;
}

export function modelConfigured(model?: ModelReadiness): boolean {
  return Boolean(model?.model && (model.hasApiKey || model.providers?.find((row) => row.id === model.provider)?.hasKey));
}

export function readFirstCheckReceipt(runId: string, signal?: AbortSignal): Promise<FirstCheckReceipt> {
  return onboardingJson(`/api/v1/workflows?run_id=${encodeURIComponent(runId)}&wait_ms=1500`, { signal });
}

export function firstCheckComplete(run: FirstCheckReceipt | null, progress: OnboardingProgress): boolean {
  if (!run || !progress.project || !progress.attempt || run.state !== "completed"
    || run.graphId !== progress.attempt.graphId || run.idempotencyKey !== progress.attempt.key) return false;
  const expected = firstCheckGraph(progress.project, progress.attempt.graphId).nodes;
  if (run.nodes.length !== expected.length || !expected.every((node) => run.nodes.some((row) => row.id === node.id && row.type === node.type && row.state === "completed"))) return false;
  const output = run.nodes.find((node) => node.id === "inspect")?.output as { project?: { id?: string } } | undefined;
  return output?.project?.id === progress.project.id;
}

export async function runFirstCheck(progress: OnboardingProgress): Promise<FirstCheckReceipt> {
  const { project, attempt } = progress;
  if (!project || !attempt) throw new Error("Choose a project before running the check.");
  if (attempt.runId) return readFirstCheckReceipt(attempt.runId);
  const post = <T>(body: Record<string, unknown>) => onboardingJson<T>("/api/v1/workflows", { method: "POST", body: JSON.stringify(body) });
  let graph: WorkflowGraph;
  try {
    graph = (await onboardingJson<{ graph: WorkflowGraph }>(`/api/v1/workflows?graph_id=${encodeURIComponent(attempt.graphId)}`)).graph;
  } catch (cause) {
    if (!(cause instanceof OnboardingRequestError) || cause.status !== 404) throw cause;
    graph = (await post<{ graph: WorkflowGraph }>({ action: "create", graph: firstCheckGraph(project, attempt.graphId) })).graph;
  }
  if (!matchesFirstCheck(graph, project, attempt.graphId)) throw new Error("The saved check changed. Review it in Workflows before running it.");
  return post<FirstCheckReceipt>({ action: "run", graph_id: graph.id, expected_revision: graph.revision, input: {}, idempotency_key: attempt.key });
}
