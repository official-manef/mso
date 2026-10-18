export const PROFILE_READ_TOOLS = [
  "vps_status", "fs_list", "fs_read", "fs_search", "fs_usage", "projects_list",
  "project_get", "project_candidate_search", "project_capabilities",
] as const;
export interface AgentProfileConfig {
  name: string;
  avatar: string;
  instructions: string;
  runtime: "mso-readonly";
  model: { provider: string; model: string };
  tools: string[];
}
export type AgentProfileAction = "create" | "edit" | "clone" | "default" | "enable" | "disable";
export interface AgentProfileRevision {
  revision: number;
  at: string;
  actor: string;
  action: AgentProfileAction;
  reason: string;
  config: AgentProfileConfig;
  enabled: boolean;
}
export interface AgentProfile {
  id: string;
  owner: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  enabled: boolean;
  config: AgentProfileConfig;
  clonedFrom?: { id: string; revision: number };
  history: AgentProfileRevision[];
}
export interface AgentProfileStore {
  version: 1;
  revision: number;
  defaultProfileId: string | null;
  profiles: AgentProfile[];
}
export interface AgentProfileCatalog {
  store: AgentProfileStore;
  selectedModel: AgentProfileConfig["model"];
  tools: Array<{ name: string; description: string }>;
}
export interface AgentProfileRunResult {
  runId: string;
  profileId: string;
  profileRevision: number;
  model: AgentProfileConfig["model"];
  status: "completed" | "partial";
  text: string;
  rounds: number;
  toolCalls: Array<{ name: string; ok: boolean }>;
}
