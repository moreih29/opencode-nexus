import path from "node:path";
import { appendAgentTracker, hasRunningTeam, markLatestTeamCompleted } from "../shared/agent-tracker";
import { createNexusPaths, isNexusInternalPath } from "../shared/paths";
import { ensureNexusStructure, fileExists, readTasksSummary, resetAgentTracker } from "../shared/state";
import { buildTagNotice, detectNexusTag } from "../shared/tag-parser";

interface PluginContext {
  directory: string;
  worktree?: string;
}

interface ToolInput {
  tool: string;
}

interface ToolOutput {
  args: Record<string, unknown>;
}

interface ChatOutput {
  parts: Array<{ type?: string; text?: string }>;
}

export function createHooks(ctx: PluginContext) {
  const projectRoot = ctx.worktree ?? ctx.directory;
  const paths = createNexusPaths(projectRoot);

  return {
    event: async ({ event }: { event: { type: string } }) => {
      if (event.type === "session.created") {
        await ensureNexusStructure(paths);
        await resetAgentTracker(paths.AGENT_TRACKER_FILE);
      }
    },

    "tool.execute.before": async (input: ToolInput, output: ToolOutput) => {
      if (input.tool === "nx_meet_start") {
        await validateMeetStart(output.args, paths.AGENT_TRACKER_FILE);
      }

      if (input.tool === "task") {
        await trackSubagentStart(output.args, paths.AGENT_TRACKER_FILE);
      }

      if (!isEditLikeTool(input.tool)) {
        return;
      }

      const targetPath = getTargetPath(output.args, projectRoot);
      if (targetPath && isNexusInternalPath(targetPath, projectRoot)) {
        return;
      }

      const summary = await readTasksSummary(paths.TASKS_FILE);
      if (!summary) {
        throw new Error("Task pipeline is required. Run nx_task_add before editing files.");
      }

      if (summary.total > 0 && summary.pending === 0 && summary.in_progress === 0) {
        throw new Error("All tasks are completed. Run nx_task_close or create a new task cycle.");
      }
    },

    "tool.execute.after": async (
      input: ToolInput & { args: Record<string, unknown> },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (input.tool !== "task") {
        return;
      }

      const agentType = pickString(input.args, ["subagent_type", "agent", "type"]);
      if (!agentType) {
        return;
      }
      await markLatestTeamCompleted(paths.AGENT_TRACKER_FILE, agentType, output.output.slice(0, 500));
    },

    "chat.message": async (_input: unknown, output: ChatOutput) => {
      const prompt = extractText(output.parts);
      if (!prompt) {
        return;
      }

      const mode = detectNexusTag(prompt);
      const notice = await buildStatefulNotice(mode, paths);
      if (!notice) {
        return;
      }

      output.parts.push({
        type: "text",
        text: `\n\n${notice}`
      });
    }
  };
}

function isEditLikeTool(toolName: string): boolean {
  return toolName === "edit" || toolName === "write" || toolName === "patch" || toolName === "multiedit";
}

function getTargetPath(args: Record<string, unknown>, projectRoot: string): string | null {
  const candidates = [args.filePath, args.path, args.file_path].filter((v): v is string => typeof v === "string");
  if (candidates.length === 0) {
    return null;
  }

  const picked = candidates[0];
  if (path.isAbsolute(picked)) {
    return picked;
  }
  return path.join(projectRoot, picked);
}

async function validateMeetStart(args: Record<string, unknown>, trackerFile: string): Promise<void> {
  const attendees = Array.isArray(args.attendees) ? args.attendees : [];
  const hasNonLead = attendees.some((a) => {
    if (!a || typeof a !== "object") {
      return false;
    }
    const role = (a as { role?: unknown }).role;
    return typeof role === "string" && role.toLowerCase() !== "lead";
  });

  if (!hasNonLead) {
    return;
  }

  const teamExists = await hasRunningTeam(trackerFile);
  if (!teamExists) {
    throw new Error("Attendees include non-lead agents. Create a team first with task tool and team_name.");
  }
}

async function trackSubagentStart(args: Record<string, unknown>, trackerFile: string): Promise<void> {
  const agentType = pickString(args, ["subagent_type", "agent", "type"]);
  if (!agentType) {
    return;
  }

  const teamName = pickString(args, ["team_name", "team"]);
  await appendAgentTracker(trackerFile, {
    agent_type: agentType,
    state: teamName ? "team-spawning" : "running",
    team_name: teamName ?? undefined,
    started_at: new Date().toISOString()
  });
}

function pickString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function extractText(parts: Array<{ type?: string; text?: string }>): string {
  return parts
    .filter((part) => (part.type ?? "text") === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n");
}

async function buildStatefulNotice(
  mode: ReturnType<typeof detectNexusTag>,
  paths: ReturnType<typeof createNexusPaths>
): Promise<string | null> {
  if (!mode) {
    return null;
  }

  const fallback = buildTagNotice(mode);
  const hasMeet = await fileExists(paths.MEET_FILE);
  const taskSummary = await readTasksSummary(paths.TASKS_FILE);

  if (mode === "meet") {
    return hasMeet
      ? "[nexus] Meet session is active. Continue with nx_meet_discuss / nx_meet_decide."
      : "[nexus] Meet mode detected. Start with nx_meet_start (topic, research_summary, issues).";
  }

  if (mode === "decide") {
    return hasMeet
      ? "[nexus] Decision tag detected. Record issue decisions with nx_meet_decide."
      : "[nexus] [d] detected but no active meet session. Run nx_meet_start first.";
  }

  if (mode === "run") {
    if (!taskSummary) {
      return "[nexus] Run mode detected. No task cycle yet. Create tasks with nx_task_add.";
    }
    if (taskSummary.pending > 0 || taskSummary.in_progress > 0 || taskSummary.blocked > 0) {
      return `[nexus] Run mode detected. Active tasks: pending=${taskSummary.pending}, in_progress=${taskSummary.in_progress}, blocked=${taskSummary.blocked}.`;
    }
    return "[nexus] Run mode detected. All tasks completed. Use nx_task_close to archive cycle.";
  }

  return fallback;
}
