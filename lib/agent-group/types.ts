export type AgentGroupMemberTelegram = {
  user: string;
  connection: string;
  target: string;
};

export type AgentGroupMember = {
  id: string;
  name: string;
  profile: string;
  telegram?: AgentGroupMemberTelegram;
};

export type AgentGroupRecord = {
  id: string;
  name: string;
  members: AgentGroupMember[];
  maxRounds: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
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

export type AgentGroupRunState = "running" | "completed" | "failed" | "stopped";

export type AgentGroupRun = {
  id: string;
  groupId: string;
  prompt: string;
  turns: AgentGroupTurn[];
  state: AgentGroupRunState;
  error?: string;
  startedAt: string;
  updatedAt: string;
};

export type AgentGroupState = {
  version: 1;
  revision: number;
  groups: AgentGroupRecord[];
  runs: AgentGroupRun[];
};

export type AgentGroupView = AgentGroupRecord & {
  runs: AgentGroupRun[];
};
