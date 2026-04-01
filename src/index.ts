import type { Plugin } from "@opencode-ai/plugin";
import { createHooks } from "./plugin/hooks";
import { nexusTools } from "./tools";

const OpenCodeNexusPlugin: Plugin = async (ctx) => {
  const hooks = createHooks({
    directory: ctx.directory,
    worktree: ctx.worktree
  });

  await ctx.client.app.log({
    body: {
      service: "opencode-nexus",
      level: "info",
      message: "plugin initialized"
    }
  });

  return {
    tool: nexusTools,
    ...hooks
  };
};

export default OpenCodeNexusPlugin;
