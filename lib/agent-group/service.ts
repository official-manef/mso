import { directConnectionValues } from "@/lib/infra/connection-service";
import { sendTelegramText } from "@/lib/channels/providers/telegram";
import { AgentGroupError } from "./errors";
import { runHermesTurn } from "./hermes-runner";
import { appendTurn, createRun, finishRun, listRuns, readAgentGroupState, readRun } from "./store";
import type { AgentGroupMember, AgentGroupRecord, AgentGroupRun, AgentGroupView } from "./types";

const active = new Map<string, AbortController>();

const MODERATOR =
  "You are one specialist in a live multi-agent discussion with other specialists. Keep each reply short (2-4 sentences), speak in your own role, build on or challenge what others said, and move the discussion forward. Do not use tools unless essential.";

const openingPrompt = (topic: string) => `${MODERATOR}\n\nDiscussion topic: ${topic}\n\nGive your opening position.`;
const continuingPrompt = (topic: string, transcript: string) =>
  `${MODERATOR}\n\nDiscussion topic: ${topic}\n\nDiscussion so far:\n${transcript}\n\nContinue the discussion now: respond to the others and add your next points.`;
const transcript = (turns: AgentGroupRun["turns"]) =>
  turns.map((turn) => `${turn.name}: ${turn.text || `(no reply: ${turn.error ?? "error"})`}`).join("\n").slice(-8000);

async function mirrorToTelegram(member: AgentGroupMember, text: string) {
  if (!member.telegram || !text.trim()) return;
  const values = await directConnectionValues("telegram", { user: member.telegram.user, connection: member.telegram.connection });
  if (!values.botToken) return;
  await sendTelegramText(values, member.telegram.target, `${member.name}:\n${text}`.slice(0, 4096));
}

async function execute(group: AgentGroupRecord, runId: string, prompt: string, signal: AbortSignal) {
  try {
    for (let round = 1; round <= group.maxRounds; round += 1) {
      for (const member of group.members) {
        if (signal.aborted) throw new AgentGroupError("agent_group_stopped", 409);
        const current = await readRun(runId);
        const query = round === 1 ? openingPrompt(prompt) : continuingPrompt(prompt, transcript(current.turns));
        try {
          const result = await runHermesTurn({ profile: member.profile, prompt: query, signal });
          const { result: updated } = await appendTurn(
            runId,
            { round, memberId: member.id, name: member.name, profile: member.profile, text: result.text },
            "running",
          );
          const latest = updated.turns.at(-1);
          if (latest && latest.error === undefined && result.text.trim()) await mirrorToTelegram(member, result.text).catch(() => undefined);
        } catch (error) {
          if (error instanceof AgentGroupError && error.code === "agent_group_stopped") throw error;
          await appendTurn(
            runId,
            { round, memberId: member.id, name: member.name, profile: member.profile, text: "", error: error instanceof AgentGroupError ? error.code : "agent_group_turn_failed" },
            "running",
          );
        }
      }
    }
    await finishRun(runId, "completed");
  } catch (error) {
    const code = error instanceof AgentGroupError ? error.code : "agent_group_run_failed";
    await finishRun(runId, code === "agent_group_stopped" ? "stopped" : "failed", code).catch(() => undefined);
  } finally {
    active.delete(runId);
  }
}

export async function agentGroupsSnapshot(): Promise<{ groups: AgentGroupView[]; revision: number }> {
  const state = await readAgentGroupState();
  const groups: AgentGroupView[] = [];
  for (const group of state.groups) groups.push({ ...group, runs: await listRuns(group.id) });
  return { groups, revision: state.revision };
}

export async function getAgentGroup(groupId: string): Promise<AgentGroupView> {
  const state = await readAgentGroupState();
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) throw new AgentGroupError("agent_group_not_found", 404);
  return { ...group, runs: await listRuns(groupId) };
}

export async function startAgentGroupRun(groupId: string, prompt: string, members?: string[]) {
  const { groups } = await readAgentGroupState();
  const group = groups.find((item) => item.id === groupId);
  if (!group) throw new AgentGroupError("agent_group_not_found", 404);
  if (!group.enabled) throw new AgentGroupError("agent_group_disabled", 409);
  const text = prompt.trim();
  if (!text || text.length > 4000) throw new AgentGroupError("invalid_group_prompt");
  const selected = members && members.length ? group.members.filter((member) => members.includes(member.id)) : group.members;
  if (!selected.length) throw new AgentGroupError("invalid_group_members");
  const { result: run } = await createRun(groupId, text);
  const controller = new AbortController();
  active.set(run.id, controller);
  void execute({ ...group, members: selected }, run.id, text, controller.signal);
  return run;
}

export async function stopAgentGroupRun(runId: string) {
  active.get(runId)?.abort(new AgentGroupError("agent_group_stopped", 409));
  active.delete(runId);
  const { result } = await finishRun(runId, "stopped", "agent_group_stopped");
  return result;
}
