import { AgentGroupError } from "./errors";
import type { AgentGroupMember, AgentGroupMemberTelegram } from "./types";

const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TELEGRAM_TARGET = /^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

const clean = (value: unknown, label: string, max = 120): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new AgentGroupError(`invalid_group_${label}`);
  }
  return value.trim();
};

function parseTelegram(raw: unknown): AgentGroupMemberTelegram | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new AgentGroupError("invalid_group_telegram");
  const row = raw as Record<string, unknown>;
  const target = clean(row.target, "telegram_target", 128);
  if (!TELEGRAM_TARGET.test(target)) throw new AgentGroupError("invalid_group_telegram_target");
  return { user: clean(row.user, "telegram_user"), connection: clean(row.connection, "telegram_connection"), target };
}

function parseMember(raw: unknown, index: number): AgentGroupMember {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AgentGroupError("invalid_group_member");
  const row = raw as Record<string, unknown>;
  const profile = clean(row.profile, "profile", 64);
  if (!PROFILE.test(profile)) throw new AgentGroupError("invalid_group_profile");
  const telegram = parseTelegram(row.telegram);
  return {
    id: typeof row.id === "string" && row.id ? row.id : `m${index + 1}`,
    name: clean(row.name, "member_name", 60),
    profile,
    ...(telegram ? { telegram } : {}),
  };
}

export type AgentGroupPatch = {
  name: string;
  members: AgentGroupMember[];
  maxRounds: number;
  enabled: boolean;
};

export function parseAgentGroupPatch(raw: Record<string, unknown>, previous?: AgentGroupPatch): AgentGroupPatch {
  const nameRaw = raw.name === undefined ? previous?.name : raw.name;
  const name = clean(nameRaw, "name");

  const membersRaw = raw.members === undefined ? previous?.members : raw.members;
  if (!Array.isArray(membersRaw) || membersRaw.length < 1 || membersRaw.length > 12) {
    throw new AgentGroupError("invalid_group_members");
  }
  const members = membersRaw.map((item, index) => parseMember(item, index));
  if (new Set(members.map((member) => member.id)).size !== members.length) {
    throw new AgentGroupError("duplicate_group_member");
  }
  if (new Set(members.map((member) => member.profile)).size !== members.length) {
    throw new AgentGroupError("duplicate_group_profile");
  }

  const roundsRaw = raw.maxRounds === undefined ? previous?.maxRounds : raw.maxRounds;
  const maxRounds = roundsRaw === undefined ? 1 : roundsRaw;
  if (typeof maxRounds !== "number" || !Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > 3) {
    throw new AgentGroupError("invalid_group_max_rounds");
  }

  const enabledRaw = raw.enabled === undefined ? previous?.enabled ?? true : raw.enabled;
  if (typeof enabledRaw !== "boolean") throw new AgentGroupError("invalid_group_enabled");

  return { name, members, maxRounds, enabled: enabledRaw };
}
