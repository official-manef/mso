import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentGroupError } from "./errors";
import { parseAgentGroupPatch } from "./schema";
import { appendTurn, createAgentGroup, createRun, finishRun, listAgentGroups, readAgentGroupState, readRun, updateAgentGroup } from "./store";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "mso-agent-group-"));
  process.env.OS_AGENT_GROUP_STORE = path.join(dir, "agent-groups.json");
});
afterEach(async () => {
  delete process.env.OS_AGENT_GROUP_STORE;
  await rm(dir, { recursive: true, force: true });
});

const group = () => ({
  name: "Council",
  members: [
    { name: "Lara", profile: "default" },
    { name: "Dita", profile: "dita" },
  ],
  maxRounds: 2,
});

describe("agent-group schema", () => {
  it("rejects duplicate profiles, bad profile names, and out-of-range rounds", () => {
    expect(() => parseAgentGroupPatch({ ...group(), members: [{ name: "A", profile: "x" }, { name: "B", profile: "x" }] })).toThrow(AgentGroupError);
    expect(() => parseAgentGroupPatch({ ...group(), members: [{ name: "A", profile: "bad profile" }] })).toThrow(AgentGroupError);
    expect(() => parseAgentGroupPatch({ ...group(), maxRounds: 4 })).toThrow(AgentGroupError);
  });

  it("parses a valid member list with optional telegram routing", () => {
    const parsed = parseAgentGroupPatch({
      name: "Council",
      members: [{ name: "Dita", profile: "dita", telegram: { user: "owner", connection: "telegram-dita", target: "-100123" } }],
    });
    expect(parsed.members).toHaveLength(1);
    expect(parsed.members[0]!.telegram?.target).toBe("-100123");
    expect(parsed.maxRounds).toBe(1);
  });
});

describe("agent-group store", () => {
  it("creates, lists, updates and bumps revision", async () => {
    const created = await createAgentGroup(group());
    expect(created.state.revision).toBe(1);
    expect(created.result.members).toHaveLength(2);

    const updated = await updateAgentGroup(created.result.id, 1, { ...group(), name: "Council 2" });
    expect(updated.state.revision).toBe(2);
    expect(updated.result.name).toBe("Council 2");

    const state = await readAgentGroupState();
    expect(state.groups).toHaveLength(1);
    expect((await listAgentGroups())[0]!.name).toBe("Council 2");
  });

  it("rejects a stale update revision", async () => {
    const created = await createAgentGroup(group());
    await expect(updateAgentGroup(created.result.id, 999, { ...group(), name: "x" })).rejects.toThrow(AgentGroupError);
  });

  it("records a run transcript and terminal state", async () => {
    const created = await createAgentGroup(group());
    const { result: run } = await createRun(created.result.id, "Should we ship?");
    expect(run.state).toBe("running");

    const appended = await appendTurn(run.id, { round: 1, memberId: "m1", name: "Lara", profile: "default", text: "Yes." }, "running");
    expect(appended.state.runs[0]!.turns).toHaveLength(1);

    const finished = await finishRun(run.id, "completed");
    expect(finished.state.runs[0]!.state).toBe("completed");
    expect((await readRun(run.id)).turns[0]!.text).toBe("Yes.");
  });
});
