import type { AgentGroupRun, AgentGroupView, AgentGroupsSnapshot } from "../types";

async function json<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `request failed (${response.status})`);
  return body as T;
}

export const loadAgentGroups = () => json<AgentGroupsSnapshot>("/api/v1/agent-groups");
export const loadAgentGroup = (id: string) => json<AgentGroupView>(`/api/v1/agent-groups?id=${encodeURIComponent(id)}`);
export const agentGroupAction = <T = unknown>(body: Record<string, unknown>) =>
  json<T>("/api/v1/agent-groups", { method: "POST", body: JSON.stringify(body) });

export const runAgentGroup = (id: string, prompt: string, members?: string[]) =>
  agentGroupAction<AgentGroupRun>({ action: "run", id, prompt, ...(members ? { members } : {}) });
export const stopAgentGroup = (runId: string) => agentGroupAction<AgentGroupRun>({ action: "stop", runId });

export type TelegramCredentialOption = { user: string; userLabel: string; id: string; label: string; state: string };

// Reuses the Channels snapshot the Integrations/Channels apps already expose:
// agent-group mirrors each member's reply through the same Telegram connections.
export async function loadTelegramCredentials() {
  const snapshot = await json<{ credentials: TelegramCredentialOption[] }>("/api/v1/channels");
  return snapshot.credentials.filter((item) => item.user && item.id);
}

