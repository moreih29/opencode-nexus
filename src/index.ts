import type { Plugin } from "@opencode-ai/plugin";
import { createConfigHook, installSkillFiles } from "./create-config.js";
import { createHooks } from "./create-hooks.js";
import { createPluginState } from "./plugin-state.js";
import { createTools } from "./create-tools.js";

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

  await installSkillFiles(ctx.directory, (args) => ctx.client.app.log(args));

  return {
    tool: createTools(),
    config: createConfigHook(),
    ...hooks
  };
};

export default OpenCodeNexusPlugin;
