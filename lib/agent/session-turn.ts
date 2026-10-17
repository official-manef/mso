import { randomUUID } from "node:crypto";
import type { CapabilityRunContext } from "@/lib/capabilities/tool";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import { resolveAgentSessionRef } from "./session-query";
import {
  appendAgentSessionEvent,
  getAgentSession,
  updateAgentSessionHistory,
} from "./session-store";
import { handoffOwnerLocalSession } from "@/lib/a2a/local-session";

const DEFAULT_EXECUTION_LEASE_MS = 15 * 60_000;

interface SessionTurnLease {
  claimedBy: string;
  leaseUntil: number;
}

const activeTurnLeases = new Map<string, SessionTurnLease>();

export function acquireSessionTurnLease(
  sessionId: string,
  claimedBy: string,
  leaseMs = DEFAULT_EXECUTION_LEASE_MS,
  now = Date.now(),
): boolean {
  const existing = activeTurnLeases.get(sessionId);
  if (existing && existing.leaseUntil > now) {
    return false;
  }
  activeTurnLeases.set(sessionId, {
    claimedBy,
    leaseUntil: now + leaseMs,
  });
  return true;
}

export function releaseSessionTurnLease(
  sessionId: string,
  claimedBy?: string,
): void {
  const existing = activeTurnLeases.get(sessionId);
  if (!existing) return;
  if (!claimedBy || existing.claimedBy === claimedBy) {
    activeTurnLeases.delete(sessionId);
  }
}

export function clearAllSessionTurnLeasesForTest(): void {
  activeTurnLeases.clear();
}

function extractTaskText(task: unknown): string {
  if (!task || typeof task !== "object") return "";
  const t = task as {
    artifacts?: Array<{ parts?: Array<{ text?: string }> }>;
    status?: { message?: { parts?: Array<{ text?: string }> }; error?: string };
    output?: string;
    error?: string;
  };
  const artifactText = t.artifacts?.flatMap((a) => a.parts ?? [])
    .map((p) => typeof p.text === "string" ? p.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
  if (artifactText) return artifactText;
  const statusText = t.status?.message?.parts
    ?.map((p) => typeof p.text === "string" ? p.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
  if (statusText) return statusText;
  if (typeof t.output === "string" && t.output.trim()) return t.output.trim();
  if (typeof t.error === "string" && t.error.trim()) return t.error.trim();
  if (typeof t.status?.error === "string" && t.status.error.trim()) return t.status.error.trim();
  return "";
}

function extractRounds(turn: unknown): number {
  if (!turn || typeof turn !== "object") return 1;
  const t = turn as Record<string, unknown>;
  const task = (t.task ?? {}) as Record<string, unknown>;
  if (typeof task.rounds === "number") return task.rounds;
  if (typeof t.rounds === "number") return t.rounds;
  return 1;
}

function extractToolCalls(turn: unknown): Array<{ name: string; ok: boolean }> {
  if (!turn || typeof turn !== "object") return [];
  const t = turn as Record<string, unknown>;
  const task = (t.task ?? {}) as Record<string, unknown>;
  if (Array.isArray(task.toolCalls)) return task.toolCalls as Array<{ name: string; ok: boolean }>;
  if (Array.isArray(t.toolCalls)) return t.toolCalls as Array<{ name: string; ok: boolean }>;
  return [];
}

export interface RunDurableSessionTurnInput {
  principal: string;
  sessionRef: string;
  objective: string;
  capabilities?: CapabilityRuntime;
  authority?: CapabilityRunContext;
  persist?: boolean;
}

export interface DurableSessionTurnResult {
  sessionRef: string;
  rounds: number;
  toolCalls: Array<{ name: string; ok: boolean }>;
  text: string;
}

export async function runDurableSessionTurn(
  input: RunDurableSessionTurnInput,
): Promise<DurableSessionTurnResult> {
  const { principal, sessionRef, objective, capabilities, authority, persist } = input;
  if (!sessionRef || !sessionRef.trim()) throw new Error("sessionRef is required for durable agent turn");
  if (!objective || !objective.trim()) throw new Error("agent turn requires objective");

  const session = await resolveAgentSessionRef(principal, sessionRef.trim());
  const claimant = `${principal}:${randomUUID()}`;
  if (!acquireSessionTurnLease(session.id, claimant)) {
    throw new Error(`session turn is already in progress for session ${session.id}`);
  }

  try {
    const runtimeCaps: CapabilityRuntime = capabilities ?? { list: () => [], invoke: async () => ({ content: [] }) };
    const turn = await handoffOwnerLocalSession(
      principal,
      session.id,
      objective.trim(),
      runtimeCaps,
      undefined,
      authority ? { authority, workflowId: authority.workflowId } : undefined,
    );

    const text = extractTaskText(turn.task);
    const rounds = extractRounds(turn);
    const toolCalls = extractToolCalls(turn);

    if (persist !== false) {
      const fresh = await getAgentSession(principal, session.id);
      const existingHistory = Array.isArray(fresh?.history) ? fresh.history : [];
      const updatedHistory = [
        ...existingHistory,
        { role: "user", text: objective.trim() },
        { role: "assistant", text },
      ];
      await updateAgentSessionHistory(principal, session.id, updatedHistory);
      await appendAgentSessionEvent(principal, session.id, {
        kind: "workflow",
        tool: "agent_turn",
        state: "completed",
        ...(authority?.workflowId ? { workflowId: authority.workflowId } : {}),
        detail: objective.trim().slice(0, 500),
      });
    }

    return {
      sessionRef,
      rounds,
      toolCalls,
      text,
    };
  } finally {
    releaseSessionTurnLease(session.id, claimant);
  }
}
