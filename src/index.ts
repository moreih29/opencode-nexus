import type { Plugin } from "@opencode-ai/plugin";
import { createConfigHook, installSkillFiles } from "./create-config.js";
import { createHooks } from "./create-hooks.js";
import { createPluginState } from "./plugin-state.js";
import { createTools } from "./create-tools.js";
import { readIsolatedConfig, mergeIsolatedConfigs } from "./shared/nexus-config.js";
import { getGlobalIsolatedConfigPath, getProjectIsolatedConfigPath } from "./shared/paths.js";

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

  const projectRoot = ctx.worktree ?? ctx.directory;
  const [globalResult, projectResult] = await Promise.all([
    readIsolatedConfig(getGlobalIsolatedConfigPath()),
    readIsolatedConfig(getProjectIsolatedConfigPath(projectRoot))
  ]);

  for (const result of [globalResult, projectResult]) {
    if (result.source === "missing") {
      continue;
    }

    for (const warning of result.warnings) {
      await ctx.client.app.log({
        body: {
          service: "opencode-nexus",
          level: "warn",
          message: `isolated-config: ${warning}`
        }
      });
    }
  }

  const isolatedConfig = mergeIsolatedConfigs(globalResult.config, projectResult.config);

  await installSkillFiles(ctx.directory, (args) => ctx.client.app.log(args));

  return {
    tool: createTools(),
    config: createConfigHook(isolatedConfig),
    ...hooks
  };
};

export default OpenCodeNexusPlugin;
