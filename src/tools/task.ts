import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { z } from "zod";
import { Effect } from "effect";
import type { TaskRegistry } from "./registry.js";
import type { BgTaskState } from "./bg-state.js";

function extractLastAssistantText(messages: Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info.role === "assistant") {
      const parts = messages[i].parts;
      for (let j = 0; j < parts.length; j++) {
        const part = parts[j];
        if (part.type === "text" && typeof part.text === "string") {
          return part.text;
        }
      }
    }
  }
  return "";
}

const taskArgs = {
  description: z.string(),
  prompt: z.string(),
  subagent_type: z.string(),
  async: z.boolean().optional().default(true),
  task_id: z.string().optional(),
  command: z.string().optional(),
};

export function createTaskTool(deps: {
  client: any;
  directory: string;
  registry: TaskRegistry;
  bgState: BgTaskState;
}): ToolDefinition {
  return tool({
    description: "Launch or resume background subagent tasks. Use the session_id returned in metadata as task_id to resume.",
    args: taskArgs,
    async execute(args, ctx) {
      const regEntry = args.task_id ? deps.registry.getBySessionId(args.task_id) : undefined;

      if (args.task_id && regEntry) {
        // Resume with new prompt → continue the existing session
        if (args.prompt) {
          const isAsync = args.async !== false;
          await Effect.runPromise(ctx.ask({
            permission: "task",
            patterns: ["*"],
            always: [],
            metadata: {},
          }));

          if (isAsync) {
            deps.registry.register({
              taskId: regEntry.sessionId,
              sessionId: regEntry.sessionId,
              parentSessionId: ctx.sessionID,
              agent: args.subagent_type || regEntry.agent,
              description: args.description || regEntry.description,
            });
            await deps.bgState.spawnTask(
              regEntry.sessionId, regEntry.sessionId, ctx.sessionID,
              args.subagent_type || regEntry.agent,
              args.description || regEntry.description,
              args.prompt,
            );
            return {
              output: `Resumed: ${regEntry.sessionId} (${args.subagent_type || regEntry.agent})`,
              metadata: { session_id: regEntry.sessionId, status: "running" },
            };
          }

          const promptRes = await deps.client.session.prompt({
            path: { id: regEntry.sessionId },
            body: { parts: [{ type: "text", text: args.prompt }] },
          });
          const resultText = extractLastAssistantText(promptRes.data);
          return {
            output: resultText,
            metadata: { status: "completed" },
          };
        }

        // Status query (no prompt) → return stored state
        if (regEntry.status === "idle") {
          const result = await deps.bgState.getResult(regEntry.sessionId);
          return {
            output: result.result ?? "",
            metadata: { session_id: regEntry.sessionId, status: result.status },
          };
        }
        if (regEntry.status === "running") {
          return {
            output: `Task ${regEntry.sessionId} still running`,
            metadata: { session_id: regEntry.sessionId, status: "running" },
          };
        }
        return {
          output: regEntry.error ?? "Unknown error",
          metadata: { session_id: regEntry.sessionId, status: "error" },
        };
      }

      const isAsync = args.async !== false;

      if (isAsync) {
        await Effect.runPromise(ctx.ask({
          permission: "task",
          patterns: ["*"],
          always: [],
          metadata: {},
        }));

        const res = await deps.client.session.create({
          body: { parentID: ctx.sessionID, title: args.description },
        });
        const session = res.data;

        deps.registry.register({
          taskId: session.id,
          sessionId: session.id,
          parentSessionId: ctx.sessionID,
          agent: args.subagent_type,
          description: args.description,
        });

        await deps.bgState.spawnTask(
          session.id, session.id, ctx.sessionID,
          args.subagent_type, args.description, args.prompt,
        );

        return {
          output: `Background task started: ${session.id} (${args.subagent_type})`,
          metadata: { session_id: session.id, status: "running" },
        };
      }

      await Effect.runPromise(ctx.ask({
        permission: "task",
        patterns: ["*"],
        always: [],
        metadata: {},
      }));

      const res = await deps.client.session.create({
        body: { parentID: ctx.sessionID, title: args.description },
      });
      const session = res.data;

      const promptRes = await deps.client.session.prompt({
        path: { id: session.id },
        body: { agent: args.subagent_type, parts: [{ type: "text", text: args.prompt }] },
      });

      const resultText = extractLastAssistantText(promptRes.data);

      return {
        output: resultText,
        metadata: { status: "completed" },
      };
    },
  });
}

export function createBgOutputTool(deps: {
  bgState: BgTaskState;
}): ToolDefinition {
  return tool({
    description: "Retrieve output from a completed background task",
    args: {
      task_id: z.string(),
    },
    async execute(args, _ctx) {
      const result = await deps.bgState.getResult(args.task_id);
      if (result.status === "idle" && result.result !== undefined) {
        return { output: result.result, metadata: { session_id: args.task_id, status: "idle" } };
      }
      if (result.status === "error" && result.error !== undefined) {
        return { output: result.error, metadata: { session_id: args.task_id, status: "error" } };
      }
      if (result.status === "running") {
        return { output: `Task ${args.task_id} is still running`, metadata: { session_id: args.task_id, status: "running" } };
      }
      return { output: `Task ${args.task_id} not found`, metadata: { session_id: args.task_id, status: "unknown" } };
    },
  });
}

export function createBgCancelTool(deps: {
  client: any;
  bgState: BgTaskState;
  registry: TaskRegistry;
}): ToolDefinition {
  return tool({
    description: "Cancel a running background task",
    args: {
      task_id: z.string(),
    },
    async execute(args, _ctx) {
      const entry = deps.registry.getBySessionId(args.task_id);
      if (!entry) {
        return { output: `Task ${args.task_id} not found`, metadata: { session_id: args.task_id, status: "unknown" } };
      }

      deps.client.session.delete({ path: { id: entry.sessionId } }).catch(() => {});
      deps.bgState.removeBySessionId(entry.sessionId);

      return {
        output: `Task ${args.task_id} cancelled`,
        metadata: { session_id: args.task_id, status: "cancelled" },
      };
    },
  });
}
