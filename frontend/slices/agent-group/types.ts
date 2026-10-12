export type AgentGroupMemberTelegram = { user: string; connection: string; target: string };

export type AgentGroupMember = {
  id: string;
  name: string;
  profile: string;
  telegram?: AgentGroupMemberTelegram;
};

export type AgentGroupTurn = {
  round: number;
  memberId: string;
  name: string;
  profile: string;
  text: string;
  at: string;
  error?: string;
};

export type AgentGroupRun = {
  id: string;
  groupId: string;
  prompt: string;
  turns: AgentGroupTurn[];
  state: "running" | "completed" | "failed" | "stopped";
  error?: string;
  startedAt: string;
  updatedAt: string;
};

export type AgentGroupView = {
  id: string;
  name: string;
  members: AgentGroupMember[];
  maxRounds: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  runs: AgentGroupRun[];
};

export type AgentGroupsSnapshot = {
  groups: AgentGroupView[];
  revision: number;
};
