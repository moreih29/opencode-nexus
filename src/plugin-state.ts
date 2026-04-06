export interface NexusPluginState {
  lastPromptBySession: Map<string, string>;
  onboardedSessions: Set<string>;
  pendingSubagentInvocations: Map<string, Array<{ invocationID: string; startedAt: string; sessionID: string | null }>>;
  invocationCounter: number;
}

export function createPluginState(): NexusPluginState {
  return {
    lastPromptBySession: new Map(),
    onboardedSessions: new Set(),
    pendingSubagentInvocations: new Map(),
    invocationCounter: 0
  };
}
