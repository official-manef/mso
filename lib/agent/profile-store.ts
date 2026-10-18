import { randomUUID } from "node:crypto";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import type { AgentProfile, AgentProfileAction, AgentProfileStore } from "@/lib/contracts/agent-profile";
import { AgentProfileError, parseProfileConfig, profileFields, profileObject, profileRevision, profileText } from "./profile-schema";
import { agentProfileFile, readProfileStore, writeProfileStore } from "./profile-storage";

export const readAgentProfiles = readProfileStore;
export async function requireAgentProfile(principal: string, id: string | undefined, revision: number): Promise<AgentProfile> {
  const store = await readProfileStore(principal);
  const profile = store.profiles.find(row => row.id === (id ?? store.defaultProfileId));
  if (!profile) throw new AgentProfileError("profile_not_found", 404);
  if (!profile.enabled) throw new AgentProfileError("profile_disabled", 409);
  if (profile.revision !== profileRevision(revision)) throw new AgentProfileError("profile_revision_conflict", 409);
  return profile;
}
export async function mutateAgentProfiles(principal: string, input: unknown, authorize: () => Promise<void> = async () => {}) {
  const body = profileObject(input);
  if (body.action === "move") throw new AgentProfileError("profile_organization_move_unsupported", 501);
  profileFields(body, ["action", "expectedRevision", "id", "profileRevision", "config", "name", "reason"]);
  const action = String(body.action || "") as AgentProfileAction;
  if (!["create", "edit", "clone", "default", "enable", "disable"].includes(action)) throw new AgentProfileError("profile_action_unsupported", 422);
  const expected = profileRevision(body.expectedRevision, true), reason = profileText(body.reason, "reason", 400);
  return withSecurityStoreLock(agentProfileFile(principal), async () => {
    await authorize();
    const store = await readProfileStore(principal);
    if (store.revision !== expected) throw new AgentProfileError("profile_store_revision_conflict", 409);
    const now = new Date().toISOString(), previous = store.profiles.find(row => row.id === body.id);
    if (action !== "create") {
      if (!previous) throw new AgentProfileError("profile_not_found", 404);
      if (previous.revision !== profileRevision(body.profileRevision)) throw new AgentProfileError("profile_revision_conflict", 409);
    }
    if (["create", "clone"].includes(action) && store.profiles.length >= 100) throw new AgentProfileError("profile_count_limit", 409);
    let profile: AgentProfile;
    if (action === "create" || action === "clone") {
      const config = action === "create" ? parseProfileConfig(body.config) : { ...structuredClone(previous!.config), name: profileText(body.name, "name", 80) };
      profile = { id: `profile_${randomUUID()}`, owner: principal, revision: 1, createdAt: now, updatedAt: now, enabled: true, config, history: [],
        ...(action === "clone" ? { clonedFrom: { id: previous!.id, revision: previous!.revision } } : {}) };
      if (!store.profiles.length) store.defaultProfileId = profile.id;
    } else {
      profile = structuredClone(previous!);
      if (profile.history.length >= 200) throw new AgentProfileError("profile_revision_limit", 409);
      profile.revision += 1; profile.updatedAt = now;
      if (action === "edit") profile.config = parseProfileConfig(body.config);
      if (action === "disable") {
        profile.enabled = false;
        if (store.defaultProfileId === profile.id) store.defaultProfileId = null;
      }
      if (action === "enable") profile.enabled = true;
      if (action === "default") {
        if (!profile.enabled) throw new AgentProfileError("profile_disabled", 409);
        store.defaultProfileId = profile.id;
      }
    }
    profile.history.push({ revision: profile.revision, at: now, actor: principal, action, reason, config: structuredClone(profile.config), enabled: profile.enabled });
    const profiles = previous && action !== "clone" ? store.profiles.map(row => row.id === profile.id ? profile : row) : [...store.profiles, profile];
    const next: AgentProfileStore = { version: 1, revision: store.revision + 1, defaultProfileId: store.defaultProfileId, profiles };
    await writeProfileStore(principal, next, authorize);
    return next;
  });
}
