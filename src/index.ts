import type { Plugin } from "@opencode-ai/plugin";
import { createConfigHook } from "./create-config";
import { createHooks } from "./create-hooks";
import { createPluginState } from "./plugin-state";
import { createTools } from "./create-tools";

const OpenCodeNexusPlugin: Plugin = async (ctx) => {
  const state = createPluginState();
  const hooks = createHooks({
    directory: ctx.directory,
    worktree: ctx.worktree,
    state
  });

  await ctx.client.app.log({
    body: {
      service: "opencode-nexus",
      level: "info",
      message: "plugin initialized"
    }
  });

  return {
    tool: createTools(),
    config: createConfigHook(),
    ...hooks
  };
};

export default OpenCodeNexusPlugin;
