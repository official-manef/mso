import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mutateAgentProfiles, readAgentProfiles, requireAgentProfile } from "./profile-store";
import { agentProfileFile } from "./profile-storage";
import type { AgentProfileConfig } from "@/lib/contracts/agent-profile";

const owner = "web:aaaaaaaaaaaaaaaa", other = "web:bbbbbbbbbbbbbbbb";
const config: AgentProfileConfig = { name: "Repository reader", avatar: "RR", instructions: "Inspect the requested repository.", runtime: "mso-readonly", model: { provider: "owner-provider", model: "exact/model" }, tools: ["fs_read"] };
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "mso-profiles-")); vi.stubEnv("OS_AGENT_PROFILES_DIR", root); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
const create = () => mutateAgentProfiles(owner, { action: "create", expectedRevision: 0, config, reason: "First profile" });

describe("saved owner profiles", () => {
  it("persists the exact config, revision, actor and default after a fresh read", async () => {
    const store = await create(), profile = store.profiles[0];
    expect(await readAgentProfiles(owner)).toEqual(store);
    expect(store.defaultProfileId).toBe(profile.id);
    expect(profile.history[0]).toMatchObject({ revision: 1, actor: owner, reason: "First profile", config });
    expect((await stat(agentProfileFile(owner))).mode & 0o777).toBe(0o600);
    expect(profile.config.model).toEqual(config.model);
  });
  it("isolates list, read and mutations by the server-derived device principal", async () => {
    const store = await create(), profile = store.profiles[0];
    expect((await readAgentProfiles(other)).profiles).toEqual([]);
    await expect(requireAgentProfile(other, profile.id, 1)).rejects.toThrow("profile_not_found");
    await expect(mutateAgentProfiles(other, { action: "edit", expectedRevision: 0, id: profile.id, profileRevision: 1, config, reason: "spoof" })).rejects.toThrow("profile_not_found");
    await expect(readAgentProfiles("../../owner")).rejects.toThrow("profile_owner_unsupported");
    await expect(mutateAgentProfiles(owner, { action: "create", expectedRevision: 1, owner: other, config, reason: "spoof" })).rejects.toThrow("unsupported_profile_field");
  });
  it("retains previous configurations, and clones only a new same-owner snapshot", async () => {
    let store = await create();
    const original = store.profiles[0];
    store = await mutateAgentProfiles(owner, { action: "edit", expectedRevision: 1, id: original.id, profileRevision: 1, config: { ...config, instructions: "New instructions" }, reason: "Refine instructions" });
    expect(store.profiles[0].history.map(row => row.config.instructions)).toEqual([config.instructions, "New instructions"]);
    store = await mutateAgentProfiles(owner, { action: "clone", expectedRevision: 2, id: original.id, profileRevision: 2, name: "Reader copy", reason: "Independent reader" });
    const clone = store.profiles[1];
    expect(clone.id).not.toBe(original.id);
    expect(clone.clonedFrom).toEqual({ id: original.id, revision: 2 });
    expect(clone.history).toHaveLength(1);
    expect(clone.config).toEqual({ ...store.profiles[0].config, name: "Reader copy" });
    expect(store.defaultProfileId).toBe(original.id);
    store = await mutateAgentProfiles(owner, { action: "default", expectedRevision: 3, id: clone.id, profileRevision: 1, reason: "Use reader copy" });
    expect((await readAgentProfiles(owner)).defaultProfileId).toBe(clone.id);
    expect(store.profiles[1].history.at(-1)).toMatchObject({ action: "default", reason: "Use reader copy" });
    store = await mutateAgentProfiles(owner, { action: "disable", expectedRevision: 4, id: clone.id, profileRevision: 2, reason: "Pause profile" });
    expect(store.defaultProfileId).toBeNull();
    await expect(requireAgentProfile(owner, clone.id, 3)).rejects.toThrow("profile_disabled");
    store = await mutateAgentProfiles(owner, { action: "enable", expectedRevision: 5, id: clone.id, profileRevision: 3, reason: "Resume profile" });
    expect(store.profiles[1]).toMatchObject({ enabled: true, revision: 4 });
  });
  it("serializes simultaneous revisions without silently losing either writer", async () => {
    const initial = await create(), id = initial.profiles[0].id;
    const outcomes = await Promise.allSettled(["first", "second"].map(name => mutateAgentProfiles(owner, { action: "edit", expectedRevision: 1, id, profileRevision: 1, config: { ...config, name }, reason: name })));
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find(result => result.status === "rejected")).toMatchObject({ reason: { message: "profile_store_revision_conflict" } });
    const saved = await readAgentProfiles(owner);
    expect(saved.revision).toBe(2); expect(saved.profiles[0].history).toHaveLength(2);
    await expect(requireAgentProfile(owner, id, 1)).rejects.toThrow("profile_revision_conflict");
  });
  it.each([
    { ...config, apiKey: "never-store-this" },
    { ...config, model: { ...config.model, token: "never-store-this" } },
    { ...config, tools: ["exec_run"] },
    { ...config, runtime: "acp" },
    { ...config, skills: ["unreviewed"] },
  ])("rejects secrets, unsupported assignments and stronger runtimes: %j", async candidate => {
    await expect(mutateAgentProfiles(owner, { action: "create", expectedRevision: 0, config: candidate, reason: "unsupported" })).rejects.toThrow();
    expect((await readAgentProfiles(owner)).profiles).toEqual([]);
  });
  it("rejects organization moves without creating a substitute identity boundary", async () => {
    await create();
    await expect(mutateAgentProfiles(owner, { action: "move", expectedRevision: 1, organizationId: "team", reason: "move" })).rejects.toThrow("profile_organization_move_unsupported");
    expect((await readAgentProfiles(owner)).revision).toBe(1);
  });
  it("does not commit when live authorization is withdrawn during the transaction", async () => {
    const authorize = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("owner revoked"));
    await expect(mutateAgentProfiles(owner, { action: "create", expectedRevision: 0, config, reason: "revoked save" }, authorize)).rejects.toThrow("owner revoked");
    expect(authorize).toHaveBeenCalledTimes(2);
    expect((await readAgentProfiles(owner)).revision).toBe(0);
  });
  it("does not overwrite a corrupt or overly readable policy store", async () => {
    await create(); const file = agentProfileFile(owner), before = await readFile(file, "utf8");
    await chmod(file, 0o644);
    await expect(readAgentProfiles(owner)).rejects.toThrow(/permissions/);
    expect(await readFile(file, "utf8")).toBe(before);
    await chmod(file, 0o600); await writeFile(file, "{broken");
    await expect(create()).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{broken");
  });
  it("refuses symlinked policy files and parent directories", async () => {
    const target = path.join(root, "target.json"); await writeFile(target, "sensitive", { mode: 0o600 });
    await symlink(target, agentProfileFile(owner));
    await expect(readAgentProfiles(owner)).rejects.toThrow();
    const alias = path.join(root, "alias"); await symlink(root, alias);
    vi.stubEnv("OS_AGENT_PROFILES_DIR", alias);
    await expect(readAgentProfiles(other)).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("sensitive");
  });
});
