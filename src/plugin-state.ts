export interface NexusPluginState {
  lastPromptBySession: Map<string, string>;
  onboardedSessions: Set<string>;
  pendingSubagentInvocations: Map<string, Array<{ invocationID: string; startedAt: string; sessionID: string | null }>>;
  softExitBlockedSessions: Set<string>;
  invocationCounter: number;
}

export function createPluginState(): NexusPluginState {
  return {
    lastPromptBySession: new Map(),
    onboardedSessions: new Set(),
    pendingSubagentInvocations: new Map(),
    softExitBlockedSessions: new Set(),
    invocationCounter: 0
  };
}
