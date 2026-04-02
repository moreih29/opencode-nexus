import path from "node:path";
import fs from "node:fs/promises";
import { NEXUS_AGENT_CATALOG } from "../agents/catalog";
import { canJoinMeetWithoutTeam, isKnownNexusAgent, requiresTeamInRunMode } from "../orchestration/team-policy";
import { NEXUS_SKILL_CATALOG } from "../skills/catalog";
import { evaluateQaAutoTrigger } from "../pipeline/qa-trigger";
import { readRunState, setRunPhase } from "../shared/run-state";
import { appendAgentTracker, hasRunningTeam, markLatestTeamCompleted } from "../shared/agent-tracker";
import { createNexusPaths, isNexusInternalPath } from "../shared/paths";
import { ensureNexusStructure, fileExists, readTasksSummary, resetAgentTracker } from "../shared/state";
import { buildTagNotice, detectAttendeeMentions, detectNexusTag, detectRuleTags } from "../shared/tag-parser";
import { buildNexusSystemPrompt } from "./system-prompt";
import type { NexusPluginState } from "../plugin-state";

interface PluginContext {
  directory: string;
  worktree?: string;
  state: NexusPluginState;
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
        await enforceTaskTeamPolicy(output.args, paths);
        await trackSubagentStart(output.args, paths.AGENT_TRACKER_FILE);
      }

      if (input.tool === "nx_task_close") {
        const summary = await readTasksSummary(paths.TASKS_FILE);
        if (summary && (summary.pending > 0 || summary.in_progress > 0 || summary.blocked > 0)) {
          throw new Error("Cannot close cycle with active tasks. Complete or unblock remaining tasks first.");
        }
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

      const sessionID = pickSessionID(_input);
      if (sessionID) {
        ctx.state.lastPromptBySession.set(sessionID, prompt);
      }

      const mode = detectNexusTag(prompt);
      const notice = await buildStatefulNotice(prompt, mode, paths, projectRoot);
      if (!notice) {
        return;
      }

      output.parts.push({
        type: "text",
        text: `\n\n${notice}`
      });
    },

    "command.execute.before": async (
      input: { command: string; sessionID: string },
      output: { parts: Array<Record<string, unknown>> }
    ) => {
      if (!isExitCommand(input.command)) {
        return;
      }
      const summary = await readTasksSummary(paths.TASKS_FILE);
      if (!summary || summary.total === 0) {
        await safeUnlink(paths.STOP_WARNED_FILE);
        return;
      }

      const status = getExitGuardStatus(summary);
      const previous = await readStopWarning(paths.STOP_WARNED_FILE);
      const repeated = previous === status;
      await fs.writeFile(paths.STOP_WARNED_FILE, `${status}\n`, "utf8");

      output.parts.push({
        type: "text",
        text: buildExitWarning(status, repeated)
      } as Record<string, unknown>);
    },

    "experimental.chat.system.transform": async (
      input: { sessionID?: string },
      output: { system: string[] }
    ) => {
      const sessionID = input.sessionID;
      if (sessionID && !ctx.state.onboardedSessions.has(sessionID)) {
        output.system.push(
          "[nexus] Quick start: use [meet] to decide, [run] to execute tasks, nx_task_close to archive when complete."
        );
        ctx.state.onboardedSessions.add(sessionID);
      }
      const prompt = sessionID ? ctx.state.lastPromptBySession.get(sessionID) ?? "" : "";
      const mode = detectNexusTag(prompt) ?? "idle";
      if (mode === "run") {
        await setRunPhase(paths.RUN_FILE, "execute", "run tag detected", true);
      }
      if (mode === "meet") {
        await setRunPhase(paths.RUN_FILE, "design", "meet tag detected", true);
      }
      const run = await readRunState(paths.RUN_FILE);
      output.system.push(
        buildNexusSystemPrompt({
          mode,
          agents: NEXUS_AGENT_CATALOG,
          skills: NEXUS_SKILL_CATALOG,
          runPhase: run?.phase
        })
      );
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
    return typeof role === "string" && !canJoinMeetWithoutTeam(role);
  });

  if (!hasNonLead) {
    return;
  }

  const teamExists = await hasRunningTeam(trackerFile);
  if (!teamExists) {
    throw new Error("Attendees include non-lead agents. Start subagent coordination first with a shared team_name label.");
  }
}

async function enforceTaskTeamPolicy(
  args: Record<string, unknown>,
  paths: ReturnType<typeof createNexusPaths>
): Promise<void> {
  const agentType = pickString(args, ["subagent_type", "agent", "type"]);
  if (!agentType) {
    return;
  }
  if (!isKnownNexusAgent(agentType) || agentType.toLowerCase() === "explore") {
    return;
  }

  const hasMeet = await fileExists(paths.MEET_FILE);
  const hasTasks = await fileExists(paths.TASKS_FILE);
  const inRunMode = hasTasks && !hasMeet;
  if (!inRunMode || !requiresTeamInRunMode(agentType)) {
    return;
  }

  const teamName = pickString(args, ["team_name", "team"]);
  if (!teamName) {
    throw new Error(`Run mode requires a shared team_name coordination label for ${agentType} subagent tasks.`);
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
    coordination_label: teamName ?? undefined,
    lead_agent: "lead",
    purpose: pickString(args, ["description", "task", "prompt"]) ?? undefined,
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

function isExitCommand(command: string): boolean {
  return /^(exit|quit|:q|\/exit|\/quit)\b/i.test(command.trim());
}

function getExitGuardStatus(summary: { pending: number; in_progress: number; blocked: number; completed: number; total: number }) {
  if (summary.pending > 0 || summary.in_progress > 0 || summary.blocked > 0) {
    return "active" as const;
  }
  if (summary.completed > 0 && summary.completed === summary.total) {
    return "completed-open" as const;
  }
  return "clear" as const;
}

function buildExitWarning(status: "active" | "completed-open" | "clear", repeated: boolean): string {
  if (status === "active") {
    return repeated
      ? "[nexus] Active tasks still remain. Update task status or finish the cycle before exiting; use nx_task_close only after all tasks are complete."
      : "[nexus] Active task cycle detected. Do not abandon the cycle silently: update blocked/in-progress tasks, finish verification, and use nx_task_close only when the cycle is actually complete.";
  }

  if (status === "completed-open") {
    return repeated
      ? "[nexus] This completed cycle is still open. Archive it with nx_task_close before exiting."
      : "[nexus] A completed-but-not-closed cycle is still open. Verify if needed, run nx_sync when useful, then archive the cycle with nx_task_close before exiting.";
  }

  return "[nexus] No active Nexus cycle is blocking exit.";
}

async function readStopWarning(filePath: string): Promise<string | null> {
  if (!(await fileExists(filePath))) {
    return null;
  }
  try {
    return (await fs.readFile(filePath, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

function pickSessionID(input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const value = (input as { sessionID?: unknown }).sessionID;
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // noop
  }
}

async function readCurrentBranch(projectRoot: string): Promise<string> {
  try {
    const head = (await fs.readFile(path.join(projectRoot, ".git", "HEAD"), "utf8")).trim();
    if (!head.startsWith("ref: ")) {
      return "detached";
    }
    return head.slice(5).split("/").at(-1) ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function buildStatefulNotice(
  prompt: string,
  mode: ReturnType<typeof detectNexusTag>,
  paths: ReturnType<typeof createNexusPaths>,
  projectRoot: string
): Promise<string | null> {
  const branch = await readCurrentBranch(projectRoot);
  const branchGuard = branch === "main" || branch === "master";
  const hasMeet = await fileExists(paths.MEET_FILE);
  const taskSummary = await readTasksSummary(paths.TASKS_FILE);
  const meetReminder = hasMeet ? await buildMeetReminder(paths.MEET_FILE) : null;
  const ruleTags = detectRuleTags(prompt);
  const attendeeMentions = detectAttendeeMentions(prompt);

  if (attendeeMentions.length > 0) {
    if (hasMeet) {
      return `[nexus] Attendee request detected (${attendeeMentions.join(", ")}). Add them with nx_meet_join before continuing discussion.`;
    }
    return `[nexus] Attendee request detected (${attendeeMentions.join(", ")}). Start or resume a meet first, then use nx_meet_join.`;
  }

  if (!mode) {
    if (meetReminder) {
      return meetReminder;
    }
    if (taskSummary) {
      if (taskSummary.pending > 0 || taskSummary.in_progress > 0 || taskSummary.blocked > 0) {
        return [
          "[nexus] Active task cycle detected.",
          `pending=${taskSummary.pending}, in_progress=${taskSummary.in_progress}, blocked=${taskSummary.blocked}`,
          taskSummary.blocked > 0 ? "Resolve blocked tasks or explicitly re-plan before continuing implementation." : "",
          "Resume work, update task states with nx_task_update, verify when complete, and close with nx_task_close after optional nx_sync."
        ].join(" ");
      }
      return "[nexus] A completed task cycle is still open. Verify if needed, run nx_sync when useful, then nx_task_close before starting a new edit cycle.";
    }
    return null;
  }

  const fallback = buildTagNotice(mode);

  if (mode === "meet") {
    return hasMeet
      ? [
          "[nexus] Meet session is active.",
          meetReminder ?? "",
          "Continue one issue at a time. Record major deliberation with nx_meet_discuss, compare options with trade-offs, and use [d] -> nx_meet_decide only after discussion is logged. Do not open the next issue until the current issue is decided or explicitly deferred."
        ]
          .filter(Boolean)
          .join(" ")
      : [
          "[nexus] Meet mode detected.",
          "Research first, then start with nx_meet_start(topic, research_summary, issues). Do not open discussion until the current issue has grounded research.",
          "If non-lead attendees are needed, start grouped coordination before starting the meet.",
          "Keep the agenda one issue at a time and decide only after discussing trade-offs."
        ].join(" ");
  }

  if (mode === "decide") {
    return hasMeet
      ? "[nexus] Decision tag detected. Record supporting reasoning with nx_meet_discuss first if it is missing, then record the active issue with nx_meet_decide."
      : "[nexus] [d] detected but no active meet session. Run nx_meet_start first.";
  }

  if (mode === "run") {
    if (!taskSummary) {
      return [
        "[nexus] Run mode detected. No task cycle yet.",
        branchGuard ? `Branch Guard: current branch is ${branch}. Create a task branch before substantial execution.` : "",
        "TASK PIPELINE: check meet decisions, decompose work, register each task with nx_task_add, then edit.",
        "If decomposition yields multiple tasks or multiple target files, do not continue as Lead solo; delegate code execution units to Engineer.",
        "Use nx_briefing before specialist delegation when prior decisions or role-specific context matter.",
        "After implementation, update task states, verify, optionally nx_sync, and close with nx_task_close."
      ].join(" ");
    }
    if (taskSummary.pending > 0 || taskSummary.in_progress > 0 || taskSummary.blocked > 0) {
      return [
        "[nexus] Run mode detected.",
        branchGuard ? `Branch Guard: current branch is ${branch}. Avoid substantial execution on the default branch.` : "",
        `Active tasks: pending=${taskSummary.pending}, in_progress=${taskSummary.in_progress}, blocked=${taskSummary.blocked}.`,
        taskSummary.blocked > 0 ? "Resolve blocked tasks before opening more implementation scope." : "",
        "Keep edits scoped to active tasks, do not continue as Lead solo once work is decomposed, involve Engineer for code execution units, use nx_briefing before specialist delegation, and update status as each unit completes."
      ].join(" ");
    }
    const qa = await evaluateQaAutoTrigger(projectRoot, []);
    if (qa.shouldSpawn) {
      return `[nexus] Run mode detected. All tasks completed. Spawn QA before close (reasons: ${qa.reasons.join(",")}), then consider nx_sync before nx_task_close.`;
    }
    return "[nexus] Run mode detected. All tasks completed. Verify if needed, consider nx_sync, then use nx_task_close to archive the cycle.";
  }

  if (mode === "rule") {
    const suffix = ruleTags && ruleTags.length > 0 ? ` Tags requested: ${ruleTags.join(", ")}.` : " Infer stable rule tags from the instruction.";
    return `[nexus] Rule mode detected. Save durable conventions to .nexus/rules with nx_rules_write.${suffix}`;
  }

  return fallback;
}

async function buildMeetReminder(meetFile: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await fs.readFile(meetFile, "utf8")) as {
      topic?: unknown;
      issues?: Array<{ id?: unknown; title?: unknown; status?: unknown }>;
    };
    const issues = Array.isArray(raw.issues) ? raw.issues : [];
    const discussing = issues.find((issue) => issue.status === "discussing");
    const pending = issues.filter((issue) => issue.status === "pending");
    const current = discussing ?? pending[0];
    const currentText = current
      ? `Current issue: ${String(current.id ?? "unknown")} \"${String(current.title ?? "untitled")}\".`
      : "All issues are decided.";
    return `[nexus] Meet session \"${String(raw.topic ?? "unknown topic")}\" is active. ${currentText} Use one-issue-at-a-time discussion, record important reasoning in nx_meet_discuss, and do not open the next issue until the current issue is decided or explicitly deferred.`;
  } catch {
    return null;
  }
}
