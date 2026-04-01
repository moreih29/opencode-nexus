import type { NexusPluginState } from "./plugin-state";
import { createHooks as createNexusHooks } from "./plugin/hooks";

export function createHooks(args: { directory: string; worktree?: string; state: NexusPluginState }) {
  return createNexusHooks(args);
}
