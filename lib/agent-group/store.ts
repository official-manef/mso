import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandOwnerStorePath } from "@/lib/owner-store-path.js";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { AgentGroupError } from "./errors";
import { parseAgentGroupPatch } from "./schema";
import type { AgentGroupRecord, AgentGroupRun, AgentGroupState } from "./types";

const MAX_BYTES = 1024 * 1024;
const MAX_RUNS = 50;
const MAX_TURNS_PER_RUN = 24;
const storePath = () =>
  expandOwnerStorePath(process.env.OS_AGENT_GROUP_STORE ?? path.join(os.homedir(), ".mso", "private", "agent-groups.json"));
const empty = (): AgentGroupState => ({ version: 1, revision: 0, groups: [], runs: [] });

function validRun(raw: unknown): AgentGroupRun {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AgentGroupError("invalid_group_store");
  const run = raw as AgentGroupRun;
  if (
    typeof run.id !== "string" ||
    typeof run.groupId !== "string" ||
    typeof run.prompt !== "string" ||
    !["running", "completed", "failed", "stopped"].includes(run.state) ||
    !Array.isArray(run.turns) ||
    typeof run.startedAt !== "string" ||
    typeof run.updatedAt !== "string"
  ) {
    throw new AgentGroupError("invalid_group_store");
  }
  return run;
}

function validateState(value: unknown): AgentGroupState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentGroupError("invalid_group_store");
  const state = value as Partial<AgentGroupState>;
  if (state.version !== 1 || !Number.isSafeInteger(state.revision) || (state.revision ?? -1) < 0 || !Array.isArray(state.groups)) {
    throw new AgentGroupError("invalid_group_store");
  }
  const ids = new Set<string>();
  const groups = state.groups.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AgentGroupError("invalid_group_store");
    const row = raw as AgentGroupRecord;
    if (typeof row.id !== "string" || !/^[0-9a-f-]{36}$/i.test(row.id) || ids.has(row.id)) throw new AgentGroupError("invalid_group_store");
    ids.add(row.id);
    const parsed = parseAgentGroupPatch(row as unknown as Record<string, unknown>);
    if (typeof row.createdAt !== "string" || typeof row.updatedAt !== "string") throw new AgentGroupError("invalid_group_store");
    return { id: row.id, ...parsed, createdAt: row.createdAt, updatedAt: row.updatedAt } satisfies AgentGroupRecord;
  });
  const runs = Array.isArray(state.runs) ? state.runs.map(validRun) : [];
  return { version: 1, revision: state.revision!, groups, runs };
}

async function readUnlocked(): Promise<AgentGroupState> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(storePath(), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES || stat.mode & 0o077) throw new AgentGroupError("unsafe_group_store");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new AgentGroupError("unsafe_group_store");
    return validateState(JSON.parse(await handle.readFile("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeUnlocked(state: AgentGroupState) {
  const file = storePath();
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  state.runs = state.runs.slice(-MAX_RUNS);
  const body = JSON.stringify(state, null, 2) + "\n";
  if (Buffer.byteLength(body) > MAX_BYTES) throw new AgentGroupError("agent_group_store_capacity", 409);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, body, { flag: "wx", mode: 0o600 });
    await fs.rename(temp, file);
    await fs.chmod(file, 0o600);
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }
}

export async function readAgentGroupState() {
  return structuredClone(await readUnlocked());
}

async function mutate<T>(fn: (state: AgentGroupState) => T | Promise<T>, bumpRevision = true) {
  return withSecurityStoreLock(storePath(), async () => {
    const state = await readUnlocked();
    const result = await fn(state);
    if (bumpRevision) state.revision += 1;
    await writeUnlocked(state);
    return { result, state: structuredClone(state) };
  });
}

export async function listAgentGroups() {
  return (await readUnlocked()).groups;
}

export async function agentGroupById(id: string) {
  const row = (await readUnlocked()).groups.find((item) => item.id === id);
  if (!row) throw new AgentGroupError("agent_group_not_found", 404);
  return structuredClone(row);
}

export async function createAgentGroup(raw: Record<string, unknown>) {
  return mutate((state) => {
    const now = new Date().toISOString();
    const row: AgentGroupRecord = { id: randomUUID(), ...parseAgentGroupPatch(raw), createdAt: now, updatedAt: now };
    state.groups.push(row);
    return structuredClone(row);
  });
}

export async function updateAgentGroup(id: string, expectedRevision: number, raw: Record<string, unknown>) {
  return mutate((state) => {
    if (state.revision !== expectedRevision) throw new AgentGroupError("agent_group_revision_changed", 409);
    const index = state.groups.findIndex((row) => row.id === id);
    if (index < 0) throw new AgentGroupError("agent_group_not_found", 404);
    const previous = state.groups[index]!;
    const row: AgentGroupRecord = {
      ...previous,
      ...parseAgentGroupPatch(raw, previous),
      id: previous.id,
      createdAt: previous.createdAt,
      updatedAt: new Date().toISOString(),
    };
    state.groups[index] = row;
    return structuredClone(row);
  });
}

export async function deleteAgentGroup(id: string, expectedRevision: number) {
  return mutate((state) => {
    if (state.revision !== expectedRevision) throw new AgentGroupError("agent_group_revision_changed", 409);
    const index = state.groups.findIndex((row) => row.id === id);
    if (index < 0) throw new AgentGroupError("agent_group_not_found", 404);
    const removed = state.groups.splice(index, 1)[0]!;
    state.runs = state.runs.filter((run) => run.groupId !== id);
    return structuredClone(removed);
  });
}

export async function readRun(id: string): Promise<AgentGroupRun> {
  const row = (await readUnlocked()).runs.find((run) => run.id === id);
  if (!row) throw new AgentGroupError("agent_group_run_not_found", 404);
  return structuredClone(row);
}

export async function listRuns(groupId: string): Promise<AgentGroupRun[]> {
  return (await readUnlocked())
    .runs.filter((run) => run.groupId === groupId)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export async function createRun(groupId: string, prompt: string) {
  return mutate((state) => {
    if (!state.groups.some((group) => group.id === groupId)) throw new AgentGroupError("agent_group_not_found", 404);
    const now = new Date().toISOString();
    const run: AgentGroupRun = { id: randomUUID(), groupId, prompt, turns: [], state: "running", startedAt: now, updatedAt: now };
    state.runs.push(run);
    state.runs = state.runs.slice(-MAX_RUNS);
    return structuredClone(run);
  });
}

export async function appendTurn(runId: string, turn: Omit<AgentGroupRun["turns"][number], "at">, state: AgentGroupRun["state"]) {
  return mutate((stored) => {
    const run = stored.runs.find((row) => row.id === runId);
    if (!run) throw new AgentGroupError("agent_group_run_not_found", 404);
    run.turns.push({ ...turn, at: new Date().toISOString() });
    run.turns = run.turns.slice(-MAX_TURNS_PER_RUN);
    run.state = state;
    run.updatedAt = new Date().toISOString();
    return structuredClone(run);
  }, false);
}

export async function finishRun(runId: string, state: AgentGroupRun["state"], error?: string) {
  return mutate((stored) => {
    const run = stored.runs.find((row) => row.id === runId);
    if (!run) throw new AgentGroupError("agent_group_run_not_found", 404);
    run.state = state;
    if (error) run.error = error.slice(0, 300);
    run.updatedAt = new Date().toISOString();
    return structuredClone(run);
  }, false);
}
