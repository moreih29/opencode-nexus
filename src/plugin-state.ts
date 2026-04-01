export interface NexusPluginState {
  lastPromptBySession: Map<string, string>;
}

export function createPluginState(): NexusPluginState {
  return {
    lastPromptBySession: new Map()
  };
}
