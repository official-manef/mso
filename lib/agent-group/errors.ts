export class AgentGroupError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code);
  }
}

export function agentGroupError(error: unknown): AgentGroupError {
  return error instanceof AgentGroupError ? error : new AgentGroupError("agent_group_operation_failed", 400);
}
