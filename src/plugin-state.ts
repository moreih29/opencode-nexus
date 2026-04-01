export interface NexusPluginState {
  lastPromptBySession: Map<string, string>;
  onboardedSessions: Set<string>;
}

export function createPluginState(): NexusPluginState {
  return {
    lastPromptBySession: new Map(),
    onboardedSessions: new Set()
  };
}
