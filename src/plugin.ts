import type { Plugin } from "@opencode-ai/plugin";
import { createCmuxClient } from "./infra/cmux.js";
import { createHooks } from "./hooks/session.js";
import { TaskRegistry } from "./tools/registry.js";
import { createBgTaskState } from "./tools/bg-state.js";
import { createTaskTool, createBgOutputTool, createBgCancelTool } from "./tools/task.js";

export const OpencodeNexus: Plugin = async ({ client, directory }) => {
  const cmux = createCmuxClient();
  const registry = new TaskRegistry();
  const bgState = createBgTaskState({ client, registry });

  const hooks = createHooks({ directory, cmux, bgState });
  const taskTool = createTaskTool({ client, directory, registry, bgState });
  const bgOutputTool = createBgOutputTool({ bgState });
  const bgCancelTool = createBgCancelTool({ client, registry, bgState });

  return {
    ...hooks,
    tool: {
      task: taskTool,
      nx_bg_output: bgOutputTool,
      nx_bg_cancel: bgCancelTool,
    },
  };
};

export default OpencodeNexus;
