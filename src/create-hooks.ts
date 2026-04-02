import type { NexusPluginState } from "./plugin-state.js";
import { createHooks as createNexusHooks } from "./plugin/hooks.js";

export function createHooks(args: { directory: string; worktree?: string; state: NexusPluginState }) {
  return createNexusHooks(args);
}
