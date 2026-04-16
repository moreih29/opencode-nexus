import path from "node:path";
import fs from "node:fs/promises";
import { NEXUS_PRIMARY_AGENT_ID } from "../agents/primary.js";
import { AGENT_META } from "../agents/generated/index.js";
import { NO_FILE_EDIT_TOOLS } from "../agents/prompts.js";
import {
  buildPlanContinuityAdapterHints,
  injectMissingPlanResumeArgs,
  readPlanParticipantContinuityFromCore
} from "../orchestration/plan-continuity-adapter.js";
import { evaluatePipelineSnapshot as evaluatePipelineSnapshotPure } from "../pipeline/evaluator.js";
import { SKILL_META } from "../skills/prompts.js";
import { evaluateQaAutoTrigger } from "../pipeline/qa-trigger.js";
import {
  createDelegationTrackerRegistrar,
  isInvocationActive,
  readAgentTracker,
  type DelegationTrackerRegistrar,
  writeAgentTracker
} from "../shared/agent-tracker.js";
import { TasksFileSchema } from "../shared/schema.js";
import { createNexusPaths, isNexusInternalPath } from "../shared/paths.js";
import { ensureNexusStructure, fileExists, readTasksSummary, resetAgentTracker } from "../shared/state.js";
import { aggregateFilesForSession, appendToolLogEntry, resetToolLog } from "../shared/tool-log.js";
import { buildTagNotice, detectAttendeeMentions, detectNexusTag, detectRuleTags } from "../shared/tag-parser.js";
import { buildNexusSystemPrompt } from "./system-prompt.js";
import type { NexusPluginState } from "../plugin-state.js";

interface PluginContext {
  directory: string;
  worktree?: string;
  state: NexusPluginState;
}

interface ToolInput {
  tool: string;
  agent?: string;
  agent_id?: string;
  agentID?: string;
  sessionID?: string;
  session_id?: string;
}

interface ToolOutput {
  args: Record<string, unknown>;
}

interface ChatOutput {
  parts: Array<{ type?: string; text?: string }>;
}

type PipelineTaskStatus = "pending" | "in_progress" | "completed";

interface PipelineEvaluatorSnapshot {
  hasTasksFile: boolean;
  hasTaskCycle: boolean;
  tasks: Array<{ id?: number; status: PipelineTaskStatus }>;
  qaTriggerReasons: string[];
}

interface PipelineEvaluatorResult {
  taskCycleState: "none" | "empty" | "active" | "completed-open";
  editsAllowed: boolean;
  canCloseCycle: boolean;
  shouldTriggerQa: boolean;
  nextGuidanceKey:
    | "task_cycle_required"
    | "add_first_task"
    | "resume_active_cycle"
    | "close_cycle"
    | "spawn_qa_then_close";
}

interface StatefulNoticeContext {
  branch: string;
  branchGuard: boolean;
  hasPlan: boolean;
  taskSummary: Awaited<ReturnType<typeof readTasksSummary>>;
  planReminder: string | null;
  ruleTags: string[] | null;
  attendeeMentions: string[];
}

let pipelineEvaluatorLoader: Promise<((snapshot: PipelineEvaluatorSnapshot) => PipelineEvaluatorResult) | null> | null = null;

const NEXUS_START = "<!-- NEXUS:START -->";
const NEXUS_END = "<!-- NEXUS:END -->";

function extractNexusBlock(content: string): string | null {
  const startIdx = content.indexOf(NEXUS_START);
  const endIdx = content.indexOf(NEXUS_END);
  if (startIdx === -1 || endIdx === -1) return null;
  return content.slice(startIdx + NEXUS_START.length, endIdx).trim();
}

function replaceNexusBlock(content: string, replacement: string): string {
  const startIdx = content.indexOf(NEXUS_START);
  const endIdx = content.indexOf(NEXUS_END);
  return (
    content.slice(0, startIdx + NEXUS_START.length) +
    "\n" +
    replacement +
    "\n" +
    content.slice(endIdx)
  );
}

async function syncAgentsMdTemplate(projectRoot: string): Promise<void> {
  const templatePath = new URL("../../templates/nexus-section.md", import.meta.url);
  let template: string;
  try {
    template = (await fs.readFile(templatePath, "utf8")).trim();
  } catch {
    return;
  }

  const agentsMdPath = path.join(projectRoot, "AGENTS.md");
  let agentsMd: string;
  try {
    agentsMd = await fs.readFile(agentsMdPath, "utf8");
  } catch {
    return;
  }

  const current = extractNexusBlock(agentsMd);
  if (current === null) return;
  if (current === template) return;

  const updated = replaceNexusBlock(agentsMd, template);
  await fs.writeFile(agentsMdPath, updated, "utf8");
  console.log("[nexus] AGENTS.md synced with latest template");
}

export function createHooks(ctx: PluginContext) {
  const projectRoot = ctx.worktree ?? ctx.directory;
  const paths = createNexusPaths(projectRoot);
  const delegationTracker = createDelegationTrackerRegistrar(paths.AGENT_TRACKER_FILE);

  return {
    event: async ({ event }: { event: { type: string } }) => {
      if (event.type === "session.created") {
        await ensureNexusStructure(paths);
        if (shouldResetAgentTrackerOnSessionCreated(event, ctx.state)) {
          await resetAgentTracker(paths.AGENT_TRACKER_FILE);
        }
        await resetToolLog(paths.TOOL_LOG_FILE);
        try {
          await syncAgentsMdTemplate(paths.PROJECT_ROOT);
        } catch {
          // sync failure must not block session initialization
        }
        return;
      }

      if (event.type === "session.deleted") {
        await cleanupHarnessSessionState(paths);
        clearDeletedSessionState(ctx.state, pickSessionID(event));
      }
    },

    "tool.execute.before": async (input: ToolInput, output: ToolOutput) => {
      if (input.tool === "task") {
        output.args = await injectPlanContinuityForTask(paths, output.args);
      }

      const sessionID = pickSessionID(input) ?? pickSessionID(output.args);
      const subagentInvocation = input.tool === "task" ? registerSubagentInvocation(ctx.state, output.args, sessionID) : null;

      if (input.tool === "task") {
        await enforceTaskTeamPolicy(input, output.args, paths);
        if (subagentInvocation) {
          const agentType = pickString(output.args, ["subagent_type", "agent", "type"]);
          const coordinationLabel = pickCoordinationLabel(output.args) ?? undefined;
          await delegationTracker.start({
            invocation_id: subagentInvocation.invocationID,
            agent_type: agentType ?? "unknown",
            coordination_label: coordinationLabel,
            team_name: coordinationLabel,
            purpose: pickString(output.args, ["description", "task", "prompt"]) ?? undefined
          });
        }
      }

      if (input.tool === "nx_task_close") {
        await enforceNexusLeadTaskClosePolicy(input, output.args, paths);
        const summary = await readTasksSummary(paths.TASKS_FILE);
        if (summary) {
          const evaluation = await evaluatePipelineFromSummary(summary);
          if (!evaluation.canCloseCycle && evaluation.taskCycleState !== "empty") {
            throw new Error("Cannot close cycle with active tasks. Complete or unblock remaining tasks first.");
          }
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
      const evaluation = await evaluatePipelineFromSummary(summary);
      if (summary && !evaluation.editsAllowed && evaluation.nextGuidanceKey === "task_cycle_required") {
        throw new Error("Task pipeline is required. Run nx_task_add before editing files.");
      }

      if (!evaluation.editsAllowed && (evaluation.nextGuidanceKey === "close_cycle" || evaluation.nextGuidanceKey === "spawn_qa_then_close")) {
        throw new Error("All tasks are completed. Run nx_task_close or create a new task cycle.");
      }
    },

    "tool.execute.after": async (
      input: ToolInput & { args: Record<string, unknown> },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      const subagentInvocation = input.tool === "task" ? resolveSubagentInvocation(ctx.state, input.args) : null;
      const sessionID = pickSessionID(input) ?? pickSessionID(output.metadata) ?? subagentInvocation?.sessionID ?? null;
      const taskHandles = input.tool === "task" ? extractParticipantHandles(output.metadata) : {};

      if (input.tool === "task") {
        const agentType = pickString(input.args, ["subagent_type", "agent", "type"]);
        if (agentType && subagentInvocation) {
          await delegationTracker.end({
            invocation_id: subagentInvocation.invocationID,
            status: "completed",
            last_message: output.output.slice(0, 500),
            runtime_metadata: output.metadata,
            continuity: {
              child_task_id: taskHandles.taskID,
              child_session_id: taskHandles.sessionID
            }
          });
          if (taskHandles.sessionID) {
            await mergeFilesTouchedForChildSession(
              paths.AGENT_TRACKER_FILE,
              paths.TOOL_LOG_FILE,
              taskHandles.sessionID,
              subagentInvocation.invocationID
            );
          }
        }
        await updateRunParticipantContinuity(
          delegationTracker,
          paths,
          input.args,
          output,
          taskHandles,
          subagentInvocation?.invocationID ?? null
        );
        await updatePlanParticipantContinuity(delegationTracker, paths, input.args, output);
        if (agentType) {
          const ownerWarning = await buildOwnerIncompleteTaskWarning(paths.TASKS_FILE, agentType);
          if (ownerWarning) {
            output.output = `${output.output}\n\n${ownerWarning}`;
          }
        }
        return;
      }

      if (isEditLikeTool(input.tool)) {
        const targetPath = getTargetPath(input.args, projectRoot);
        if (targetPath && !isNexusInternalPath(targetPath, projectRoot)) {
          try {
            if (sessionID) {
              await appendToolLogEntry(paths.TOOL_LOG_FILE, {
                ts: new Date().toISOString(),
                agent_id: sessionID,
                session_id: sessionID,
                tool: input.tool,
                file: targetPath
              });
              await mergeFilesTouchedForChildSession(paths.AGENT_TRACKER_FILE, paths.TOOL_LOG_FILE, sessionID);
            }
          } catch {
            // tool-log append failure must not block hook
          }
        }
      }
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
    },

    "command.execute.before": async (
      input: { command: string; sessionID: string },
      output: { parts: Array<Record<string, unknown>> }
    ) => {
      if (!isExitCommand(input.command)) {
        ctx.state.softExitBlockedSessions.delete(input.sessionID);
        return;
      }
      const summary = await readTasksSummary(paths.TASKS_FILE);
      if (!summary || summary.total === 0) {
        ctx.state.softExitBlockedSessions.delete(input.sessionID);
        return;
      }

      const evaluation = await evaluatePipelineFromSummary(summary);
      const status = getExitGuardStatus(evaluation);
      if (status !== "completed-open") {
        ctx.state.softExitBlockedSessions.delete(input.sessionID);
      }

      output.parts.push({
        type: "text",
        text: buildExitWarning(status)
      } as Record<string, unknown>);

      if (status === "active") {
        throw new Error(
          "[nexus] Exit blocked: active task cycle detected. Update pending/in-progress tasks and continue the cycle before exiting."
        );
      }

      if (status === "completed-open" && !ctx.state.softExitBlockedSessions.has(input.sessionID)) {
        ctx.state.softExitBlockedSessions.add(input.sessionID);
        throw new Error(
          "[nexus] Exit paused once: completed cycle is still open. Run nx_task_close to archive, then exit again if needed."
        );
      }
    },

    "experimental.session.compacting": async (_input: unknown, output: { context: string[]; prompt?: string }) => {
      const parts: string[] = [];

      // Mode: plan > run > idle
      const hasPlan = await fileExists(paths.PLAN_FILE);
      const hasTasks = await fileExists(paths.TASKS_FILE);
      const mode = hasPlan ? "plan" : hasTasks ? "run" : "idle";
      parts.push(`mode=${mode}`);

      // Task summary
      const taskSummary = await readTasksSummary(paths.TASKS_FILE);
      if (taskSummary) {
        const { total, pending, in_progress } = taskSummary;
        parts.push(`tasks: ${total} total (${pending} pending, ${in_progress} in_progress)`);
      }

      // Plan state
      if (hasPlan) {
        try {
          const raw = JSON.parse(await fs.readFile(paths.PLAN_FILE, "utf8")) as {
            topic?: unknown;
            issues?: Array<{ status?: unknown }>;
          };
          const issues = Array.isArray(raw.issues) ? raw.issues : [];
          const decidedCount = issues.filter((i) => i.status === "decided" || i.status === "tasked").length;
          parts.push(`plan: "${String(raw.topic ?? "unknown")}" (${decidedCount}/${issues.length} decided)`);
        } catch {
          // skip plan info on parse error
        }
      }

      // Context file count
      try {
        const contextFiles = await fs.readdir(paths.CONTEXT_ROOT);
        const contextFileCount = contextFiles.filter((f) => f.endsWith(".md")).length;
        if (contextFileCount > 0) {
          parts.push(`context: ${contextFileCount} files`);
        }
      } catch {
        // skip context count on error
      }

      // Active agents
      try {
        const tracker = await readAgentTracker(paths.AGENT_TRACKER_FILE);
        const active = tracker.invocations
          .filter((inv) => isInvocationActive(inv.status))
          .map((inv) => inv.agent_type ?? "unknown");
        if (active.length > 0) {
          parts.push(`active agents: ${active.join(", ")}`);
        }
      } catch {
        // skip agent list on error
      }

      output.context.push(`[nexus-state] ${parts.join(" | ")}`);
    },

    "experimental.chat.system.transform": async (
      input: { sessionID?: string },
      output: { system: string[] }
    ) => {
      const sessionID = input.sessionID;
      if (sessionID && !ctx.state.onboardedSessions.has(sessionID)) {
        output.system.push(
          "[nexus] Quick start: use [plan] to decide and [run] to execute. If a run cycle is already open, Nexus will surface state reminders."
        );
        ctx.state.onboardedSessions.add(sessionID);
      }
      const prompt = sessionID ? ctx.state.lastPromptBySession.get(sessionID) ?? "" : "";
      const detectedMode = detectNexusTag(prompt);
      const notice = await buildStatefulNotice(prompt, detectedMode, paths, projectRoot);
      if (notice) {
        output.system.push(notice);
      }
      const mode = detectedMode ?? "idle";
      output.system.push(
        buildNexusSystemPrompt({
          mode,
          agents: Object.values(AGENT_META),
          skills: Object.values(SKILL_META)
        })
      );
    }
  };
}

function isEditLikeTool(toolName: string): boolean {
  // Sourced from nexus-core capability `no_file_edit` via capability-map.yml resolution.
  // Generated into prompts.generated.ts — keeps opencode-nexus in sync with nexus-core.
  return NO_FILE_EDIT_TOOLS.includes(toolName) || toolName === "apply_patch";
}

function getTargetPath(args: Record<string, unknown>, projectRoot: string): string | null {
  const candidates = [args.filePath, args.path, args.file_path, extractTargetPathFromPatchText(args)].filter(
    (v): v is string => typeof v === "string"
  );
  if (candidates.length === 0) {
    return null;
  }

  const picked = candidates[0];
  if (path.isAbsolute(picked)) {
    return picked;
  }
  return path.join(projectRoot, picked);
}

function extractTargetPathFromPatchText(args: Record<string, unknown>): string | null {
  const patchText = args.patchText;
  if (typeof patchText !== "string") {
    return null;
  }
  const firstFileHeader = patchText.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/m);
  return firstFileHeader?.[1]?.trim() || null;
}


async function enforceTaskTeamPolicy(
  input: ToolInput,
  args: Record<string, unknown>,
  paths: ReturnType<typeof createNexusPaths>
): Promise<void> {
  const inputRecord: Record<string, unknown> = { ...input };
  const callerAgent = pickString(inputRecord, ["agent", "agent_id", "agentID", "agentId", "role"]);
  if (callerAgent && callerAgent.toLowerCase() !== NEXUS_PRIMARY_AGENT_ID) {
    throw new Error(`task is Nexus-lead only. Caller "${callerAgent}" is not allowed.`);
  }
  if (callerAgent && callerAgent.toLowerCase() === NEXUS_PRIMARY_AGENT_ID) {
    return;
  }

  const sessionID = pickSessionID(input) ?? pickSessionID(args);
  if (!sessionID) {
    throw new Error("task is Nexus-lead only. Missing caller provenance for task delegation.");
  }

  const sessionInvocation = await resolveLatestSessionInvocation(paths, sessionID);
  if (!sessionInvocation) {
    throw new Error("task is Nexus-lead only. Cannot verify caller provenance for task delegation.");
  }

  if (sessionInvocation.agent_type.toLowerCase() !== NEXUS_PRIMARY_AGENT_ID) {
    throw new Error(`task is Nexus-lead only. Session caller "${sessionInvocation.agent_type}" is not allowed.`);
  }
}

async function enforceNexusLeadTaskClosePolicy(
  input: ToolInput,
  args: Record<string, unknown>,
  paths: ReturnType<typeof createNexusPaths>
): Promise<void> {
  const inputRecord: Record<string, unknown> = { ...input };
  const callerAgent = pickString(inputRecord, ["agent", "agent_id", "agentID", "agentId", "role"]);
  if (callerAgent && callerAgent.toLowerCase() !== NEXUS_PRIMARY_AGENT_ID) {
    throw new Error(`nx_task_close is Nexus-lead only. Caller "${callerAgent}" is not allowed.`);
  }

  const sessionID = pickSessionID(input) ?? pickSessionID(args);
  if (!sessionID) {
    return;
  }

  const sessionInvocation = await resolveLatestSessionInvocation(paths, sessionID);

  if (sessionInvocation && sessionInvocation.agent_type.toLowerCase() !== NEXUS_PRIMARY_AGENT_ID) {
    throw new Error(
      `nx_task_close is Nexus-lead only. Session caller "${sessionInvocation.agent_type}" is not allowed.`
    );
  }
}

async function resolveLatestSessionInvocation(
  paths: ReturnType<typeof createNexusPaths>,
  sessionID: string
): Promise<(Awaited<ReturnType<typeof readAgentTracker>>["invocations"])[number] | undefined> {
  const tracker = await readAgentTracker(paths.AGENT_TRACKER_FILE);
  return tracker.invocations
    .filter((inv) => inv.continuity?.child_session_id === sessionID)
    .sort((left, right) => {
      const leftTs = Date.parse(left.updated_at ?? left.started_at ?? left.ended_at ?? "");
      const rightTs = Date.parse(right.updated_at ?? right.started_at ?? right.ended_at ?? "");
      return rightTs - leftTs;
    })[0];
}

async function updatePlanParticipantContinuity(
  delegationTracker: DelegationTrackerRegistrar,
  paths: ReturnType<typeof createNexusPaths>,
  args: Record<string, unknown>,
  output: { title: string; output: string; metadata: unknown }
): Promise<void> {
  const agentType = pickString(args, ["subagent_type", "agent", "type"]);
  if (!agentType || !isHowAgent(agentType)) {
    return;
  }

  if (!(await fileExists(paths.PLAN_FILE))) {
    return;
  }

  const handles = extractParticipantHandles(output.metadata);
  const continuityInvocationID = createPlanContinuityInvocationID(agentType);
  const coordinationLabel = pickCoordinationLabel(args) ?? undefined;
  await delegationTracker.start({
    invocation_id: continuityInvocationID,
    agent_type: agentType,
    coordination_label: coordinationLabel,
    team_name: coordinationLabel,
    purpose: pickString(args, ["description", "task", "prompt"]) ?? undefined
  });
  await delegationTracker.end({
    invocation_id: continuityInvocationID,
    status: "completed",
    last_message: output.output.slice(0, 500),
    runtime_metadata: output.metadata,
    continuity: {
      child_task_id: handles.taskID,
      child_session_id: handles.sessionID
    }
  });
}

async function updateRunParticipantContinuity(
  delegationTracker: DelegationTrackerRegistrar,
  paths: ReturnType<typeof createNexusPaths>,
  args: Record<string, unknown>,
  output: { title: string; output: string; metadata: unknown },
  handles: { taskID?: string; sessionID?: string },
  existingInvocationID: string | null
): Promise<void> {
  if (!(await isRunMode(paths))) {
    return;
  }

  const agentType = pickString(args, ["subagent_type", "agent", "type"]);
  if (!agentType || !isDoOrCheckAgent(agentType)) {
    return;
  }

  const coordinationLabel = pickCoordinationLabel(args) ?? undefined;
  const invocationID = existingInvocationID ?? createRunContinuityInvocationID(agentType, coordinationLabel);
  await delegationTracker.start({
    invocation_id: invocationID,
    agent_type: agentType,
    coordination_label: coordinationLabel,
    team_name: coordinationLabel,
    purpose: pickString(args, ["description", "task", "prompt"]) ?? undefined
  });
  await delegationTracker.end({
    invocation_id: invocationID,
    status: "completed",
    last_message: output.output.slice(0, 500),
    runtime_metadata: output.metadata,
    continuity: {
      child_task_id: handles.taskID,
      child_session_id: handles.sessionID
    }
  });
}

function createPlanContinuityInvocationID(agentType: string): string {
  const timestamp = Date.now();
  const nonce = Math.random().toString(36).slice(2, 8);
  return `plan-continuity-${agentType.toLowerCase()}-${timestamp}-${nonce}`;
}

function createRunContinuityInvocationID(agentType: string, coordinationLabel?: string): string {
  const timestamp = Date.now();
  const nonce = Math.random().toString(36).slice(2, 8);
  const label = (coordinationLabel ?? "solo").replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase();
  return `run-continuity-${agentType.toLowerCase()}-${label}-${timestamp}-${nonce}`;
}

async function injectPlanContinuityForTask(
  paths: ReturnType<typeof createNexusPaths>,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!(await fileExists(paths.PLAN_FILE))) {
    return args;
  }

  const agentType = pickString(args, ["subagent_type", "agent", "type"]);
  if (!agentType) {
    return args;
  }

  const continuity = await readPlanParticipantContinuityFromCore(
    paths.AGENT_TRACKER_FILE,
    agentType
  );
  if (!continuity) {
    if (process.env.NEXUS_DEBUG === "1") {
      console.error(`[plan-resume-inject] no continuity found for agent_type=${agentType}`);
    }
    return args;
  }

  const hints = buildPlanContinuityAdapterHints(continuity);
  const nextArgs = injectMissingPlanResumeArgs(args, { resume_task_id: hints.resume_task_id });
  if (process.env.NEXUS_DEBUG === "1" && nextArgs !== args && nextArgs.task_id) {
    console.error(`[plan-resume-inject] injected task_id=${nextArgs.task_id} for ${agentType}`);
  }
  return nextArgs;
}

async function isRunMode(paths: ReturnType<typeof createNexusPaths>): Promise<boolean> {
  const [hasPlan, hasTasks] = await Promise.all([fileExists(paths.PLAN_FILE), fileExists(paths.TASKS_FILE)]);
  return hasTasks && !hasPlan;
}

function extractParticipantHandles(metadata: unknown): { taskID?: string; sessionID?: string } {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }

  const source = metadata as Record<string, unknown>;
  return {
    taskID: pickNestedString(source, ["task_id", "taskID", "taskId", "id"]),
    sessionID: pickNestedString(source, ["session_id", "sessionID", "sessionId"])
  };
}

function pickNestedString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = source[key];
    if (typeof direct === "string" && direct.trim().length > 0) {
      return direct;
    }
  }

  for (const value of Object.values(source)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const nested = pickNestedString(value as Record<string, unknown>, keys);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function isHowAgent(agentType: string): boolean {
  return Object.values(AGENT_META).some((agent) => agent.category === "how" && agent.id === agentType.toLowerCase());
}

function isDoOrCheckAgent(agentType: string): boolean {
  const normalized = agentType.toLowerCase();
  return Object.values(AGENT_META).some(
    (agent) => (agent.category === "do" || agent.category === "check") && agent.id === normalized
  );
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

function getExitGuardStatus(result: PipelineEvaluatorResult) {
  if (result.nextGuidanceKey === "resume_active_cycle") {
    return "active" as const;
  }
  if (result.nextGuidanceKey === "close_cycle" || result.nextGuidanceKey === "spawn_qa_then_close") {
    return "completed-open" as const;
  }
  return "clear" as const;
}

function buildExitWarning(status: "active" | "completed-open" | "clear"): string {
  if (status === "active") {
    return "[nexus] Active task cycle detected. Do not abandon the cycle silently: update pending/in-progress tasks, finish verification, and use nx_task_close only when the cycle is actually complete.";
  }

  if (status === "completed-open") {
    return "[nexus] A completed-but-not-closed cycle is still open. Verify if needed, run nx_sync when useful, then archive the cycle with nx_task_close before exiting.";
  }

  return "[nexus] No active Nexus cycle is blocking exit.";
}

function pickSessionID(input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const source = input as Record<string, unknown>;
  const direct = source.sessionID;
  if (typeof direct === "string" && direct.length > 0) {
    return direct;
  }

  const snake = source.session_id;
  if (typeof snake === "string" && snake.length > 0) {
    return snake;
  }

  for (const value of Object.values(source)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const nested = pickSessionID(value);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function shouldResetAgentTrackerOnSessionCreated(event: unknown, state: NexusPluginState): boolean {
  if (!event || typeof event !== "object") {
    return true;
  }

  const source = event as Record<string, unknown>;
  const parentSessionID = pickString(source, ["parent_session_id", "parentSessionID", "parentSessionId"]);
  if (parentSessionID) {
    return false;
  }

  const createdSessionID = pickSessionID(source);
  if (!createdSessionID) {
    return true;
  }

  return !looksLikePendingSubagentSession(createdSessionID, state);
}

function looksLikePendingSubagentSession(createdSessionID: string, state: NexusPluginState): boolean {
  for (const queue of state.pendingSubagentInvocations.values()) {
    for (const pending of queue) {
      if (pending.sessionID && pending.sessionID !== createdSessionID) {
        return true;
      }
    }
  }
  return false;
}

async function mergeFilesTouchedForChildSession(
  trackerFilePath: string,
  toolLogFilePath: string,
  childSessionID: string,
  invocationID?: string
): Promise<void> {
  const filesTouched = await aggregateFilesForSession(toolLogFilePath, childSessionID);
  if (filesTouched.length === 0) {
    return;
  }

  const tracker = await readAgentTracker(trackerFilePath);
  const updated = tracker.invocations.map((invocation) => {
    if (invocationID && invocation.invocation_id !== invocationID) {
      return invocation;
    }
    if (invocation.continuity?.child_session_id !== childSessionID) {
      return invocation;
    }
    return {
      ...invocation,
      files_touched: filesTouched
    };
  });

  await writeAgentTracker(trackerFilePath, { ...tracker, invocations: updated });
}

function registerSubagentInvocation(
  state: NexusPluginState,
  args: Record<string, unknown>,
  sessionID: string | null
): { invocationID: string; startedAt: string; agentType: string | null; teamName: string | null; fingerprint: string; sessionID: string | null } {
  const startedAt = new Date().toISOString();
  state.invocationCounter += 1;
  const invocationID = `subagent-${state.invocationCounter}`;
  const fingerprint = buildSubagentFingerprint(args);
  const queue = state.pendingSubagentInvocations.get(fingerprint) ?? [];
  queue.push({ invocationID, startedAt, sessionID });
  state.pendingSubagentInvocations.set(fingerprint, queue);
  return {
    invocationID,
    startedAt,
    agentType: pickString(args, ["subagent_type", "agent", "type"]),
    teamName: pickCoordinationLabel(args),
    fingerprint,
    sessionID
  };
}

function resolveSubagentInvocation(
  state: NexusPluginState,
  args: Record<string, unknown>
): { invocationID: string; startedAt: string; sessionID: string | null; agentType: string | null; teamName: string | null; fingerprint: string } | null {
  const fingerprint = buildSubagentFingerprint(args);
  const queue = state.pendingSubagentInvocations.get(fingerprint) ?? [];
  const pending = queue.shift();
  if (queue.length > 0) {
    state.pendingSubagentInvocations.set(fingerprint, queue);
  } else {
    state.pendingSubagentInvocations.delete(fingerprint);
  }
  if (!pending) {
    return null;
  }
  return {
    invocationID: pending.invocationID,
    startedAt: pending.startedAt,
    sessionID: pending.sessionID,
    agentType: pickString(args, ["subagent_type", "agent", "type"]),
    teamName: pickCoordinationLabel(args),
    fingerprint
  };
}

function buildSubagentFingerprint(args: Record<string, unknown>): string {
  const signature = {
    agentType: pickString(args, ["subagent_type", "agent", "type"]),
    teamName: pickCoordinationLabel(args),
    description: pickString(args, ["description", "task", "prompt"]),
    resumeTaskID: pickString(args, ["resume_task_id", "resumeTaskID", "resumeTaskId"]),
    resumeSessionID: pickString(args, ["resume_session_id", "resumeSessionID", "resumeSessionId"])
  };
  return JSON.stringify(signature);
}

function pickCoordinationLabel(args: Record<string, unknown>): string | null {
  const direct = pickString(args, ["team_name", "team"]);
  if (direct) {
    return direct;
  }

  const command = pickString(args, ["command"]);
  if (!command) {
    return null;
  }

  const match = command.match(/(?:^|\s)(?:team_name|team):([A-Za-z0-9._-]+)/);
  return match?.[1] ?? null;
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // noop
  }
}

async function cleanupHarnessSessionState(paths: ReturnType<typeof createNexusPaths>): Promise<void> {
  await Promise.all([safeUnlink(paths.AGENT_TRACKER_FILE), safeUnlink(paths.TOOL_LOG_FILE)]);
}

function clearDeletedSessionState(state: NexusPluginState, sessionID: string | null): void {
  if (!sessionID) {
    return;
  }

  state.lastPromptBySession.delete(sessionID);
  state.onboardedSessions.delete(sessionID);
  state.softExitBlockedSessions.delete(sessionID);

  for (const [fingerprint, queue] of state.pendingSubagentInvocations.entries()) {
    const filtered = queue.filter((pending) => pending.sessionID !== sessionID);
    if (filtered.length > 0) {
      state.pendingSubagentInvocations.set(fingerprint, filtered);
    } else {
      state.pendingSubagentInvocations.delete(fingerprint);
    }
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
  const noticeContext = await buildStatefulNoticeContext(prompt, paths, projectRoot);
  const { attendeeMentions, hasPlan, planReminder, taskSummary, branch, branchGuard, ruleTags } = noticeContext;

  if (attendeeMentions.length > 0) {
    if (hasPlan) {
      return `[nexus] Attendee request detected (${attendeeMentions.join(", ")}). Delegate to HOW agents via subagent coordination before deciding the issue.`;
    }
    return `[nexus] Attendee request detected (${attendeeMentions.join(", ")}). Start a plan with nx_plan_start first, then delegate to HOW agents.`;
  }

  if (!mode) {
    return buildIdleStatefulNotice(planReminder, taskSummary);
  }

  const fallback = buildTagNotice(mode);

  if (mode === "plan") {
    return hasPlan
      ? [
          "[nexus] Plan session is active.",
          planReminder ?? "",
          "Continue one issue at a time. Before asking for a decision, present a comparison table with pros, cons, trade-offs, and a recommendation; then use [d] -> nx_plan_decide. Do not open the next issue until the current issue is decided."
        ]
          .filter(Boolean)
          .join(" ")
      : [
          "[nexus] Plan mode detected.",
          "Research first, then start with nx_plan_start(topic, research_summary, issues). Do not open discussion until the current issue has grounded research.",
          "Keep the agenda one issue at a time. Before asking for a decision, present a comparison table with pros, cons, trade-offs, and a recommendation."
        ].join(" ");
  }

  if (mode === "decide") {
    return hasPlan
      ? "[nexus] Decision tag detected. Record the active issue decision with nx_plan_decide."
      : "[nexus] [d] detected but no active plan session. Run nx_plan_start first.";
  }

  if (mode === "run") {
    const { evaluation, qaReasons } = await evaluateRunNoticeGuidance(taskSummary, projectRoot);
    if (evaluation.nextGuidanceKey === "task_cycle_required") {
      return [
        "[nexus] Run mode detected. No task cycle yet.",
        branchGuard ? `Branch Guard: current branch is ${branch}. Create a task branch before substantial execution.` : "",
        "TASK PIPELINE: check plan decisions, decompose work, register each task with nx_task_add, then edit.",
        "If decomposition yields multiple tasks or multiple target files, do not continue as Lead solo; delegate code execution units to Engineer.",
        "Read relevant .nexus/ files before specialist delegation when prior decisions or role-specific context matter.",
        "After implementation, update task states, verify, optionally nx_sync, and close with nx_task_close."
      ].join(" ");
    }
    if (evaluation.nextGuidanceKey === "resume_active_cycle") {
      const activeSummary = taskSummary ?? { pending: 0, in_progress: 0, completed: 0, total: 0 };
      return [
        "[nexus] Run mode detected.",
        branchGuard ? `Branch Guard: current branch is ${branch}. Avoid substantial execution on the default branch.` : "",
        `Active tasks: pending=${activeSummary.pending}, in_progress=${activeSummary.in_progress}.`,
        "Keep edits scoped to active tasks, do not continue as Lead solo once work is decomposed, involve Engineer for code execution units, read relevant .nexus/ files before specialist delegation, and update status as each unit completes."
      ].join(" ");
    }
    if (evaluation.nextGuidanceKey === "spawn_qa_then_close") {
      const reasonText = qaReasons.join(",");
      return `[nexus] Run mode detected. All tasks completed. Spawn QA before close (reasons: ${reasonText}), then consider nx_sync before nx_task_close.`;
    }
    if (evaluation.nextGuidanceKey === "close_cycle") {
      return "[nexus] Run mode detected. All tasks completed. Verify if needed, consider nx_sync, then use nx_task_close to archive the cycle.";
    }
    if (evaluation.nextGuidanceKey === "add_first_task") {
      return "[nexus] Run mode detected. Start by registering the first execution unit with nx_task_add before editing files.";
    }
    return fallback;
  }

  if (mode === "rule") {
    const suffix = ruleTags && ruleTags.length > 0 ? ` Tags requested: ${ruleTags.join(", ")}.` : " Infer stable rule tags from the instruction.";
    return `[nexus] Rule mode detected. Save durable conventions to .nexus/rules via Nexus rule tooling.${suffix}`;
  }

  if (mode === "sync") {
    return "[nexus] Sync mode detected. Invoke skill({name:'nx-sync'}) to synchronize .nexus/context/ with current project state. Check for upstream drift after updating.";
  }

  if (mode === "memory") {
    const userContent = prompt.replace(/\[m\]/gi, "").trim();
    return `[nexus] Memory save mode. Compress and write to .nexus/memory/{appropriate_topic}.md. Update existing related files first; create new if none exists. Content: ${userContent}`;
  }

  if (mode === "memory_gc") {
    return "[nexus] Memory GC mode. Use Glob to list .nexus/memory/*.md, then merge related entries and delete redundant files using Write tool.";
  }

  return fallback;
}

async function evaluatePipelineFromSummary(
  summary: { pending: number; in_progress: number; completed: number; total: number } | null,
  qaTriggerReasons: string[] = []
): Promise<PipelineEvaluatorResult> {
  const snapshot: PipelineEvaluatorSnapshot = {
    hasTasksFile: summary !== null,
    hasTaskCycle: summary !== null,
    tasks: expandSummaryTasks(summary),
    qaTriggerReasons
  };
  return evaluatePipelineSnapshot(snapshot);
}

async function buildStatefulNoticeContext(
  prompt: string,
  paths: ReturnType<typeof createNexusPaths>,
  projectRoot: string
): Promise<StatefulNoticeContext> {
  const branch = await readCurrentBranch(projectRoot);
  const hasPlan = await fileExists(paths.PLAN_FILE);
  const taskSummary = await readTasksSummary(paths.TASKS_FILE);
  return {
    branch,
    branchGuard: branch === "main" || branch === "master",
    hasPlan,
    taskSummary,
    planReminder: hasPlan ? await buildPlanReminder(paths.PLAN_FILE) : null,
    ruleTags: detectRuleTags(prompt),
    attendeeMentions: detectAttendeeMentions(prompt)
  };
}

async function buildIdleStatefulNotice(
  planReminder: string | null,
  taskSummary: Awaited<ReturnType<typeof readTasksSummary>>
): Promise<string | null> {
  if (planReminder) {
    return planReminder;
  }
  if (!taskSummary) {
    return null;
  }

  const evaluation = await evaluatePipelineFromSummary(taskSummary);
  if (evaluation.nextGuidanceKey === "resume_active_cycle") {
    return [
      "[nexus] Active task cycle detected.",
      `pending=${taskSummary.pending}, in_progress=${taskSummary.in_progress}`,
      "Use [run] when you are ready to continue the run cycle workflow."
    ].join(" ");
  }

  if (evaluation.nextGuidanceKey === "close_cycle" || evaluation.nextGuidanceKey === "spawn_qa_then_close") {
    return "[nexus] A completed task cycle is still open. Use [run] to finish cycle closure workflow before starting a new edit cycle.";
  }

  return null;
}

async function evaluateRunNoticeGuidance(
  taskSummary: Awaited<ReturnType<typeof readTasksSummary>>,
  projectRoot: string
): Promise<{ evaluation: PipelineEvaluatorResult; qaReasons: string[] }> {
  let qaReasons: string[] = [];
  let evaluation = await evaluatePipelineFromSummary(taskSummary, qaReasons);
  if (taskSummary && evaluation.nextGuidanceKey === "close_cycle") {
    qaReasons = (await evaluateQaAutoTrigger(projectRoot, [])).reasons;
    evaluation = await evaluatePipelineFromSummary(taskSummary, qaReasons);
  }
  return { evaluation, qaReasons };
}

function expandSummaryTasks(
  summary: { pending: number; in_progress: number; completed: number } | null
): Array<{ status: PipelineTaskStatus }> {
  if (!summary) {
    return [];
  }

  const tasks: Array<{ status: PipelineTaskStatus }> = [];
  for (let i = 0; i < summary.pending; i += 1) {
    tasks.push({ status: "pending" });
  }
  for (let i = 0; i < summary.in_progress; i += 1) {
    tasks.push({ status: "in_progress" });
  }
  for (let i = 0; i < summary.completed; i += 1) {
    tasks.push({ status: "completed" });
  }
  return tasks;
}

async function evaluatePipelineSnapshot(snapshot: PipelineEvaluatorSnapshot): Promise<PipelineEvaluatorResult> {
  return evaluatePipelineSnapshotPure(snapshot);
}

async function buildOwnerIncompleteTaskWarning(tasksFile: string, agentType: string): Promise<string | null> {
  if (!(await fileExists(tasksFile))) {
    return null;
  }

  try {
    const raw = JSON.parse(await fs.readFile(tasksFile, "utf8"));
    const parsed = TasksFileSchema.safeParse(raw);
    if (!parsed.success) {
      return null;
    }

    const normalizedAgent = agentType.trim().toLowerCase();
    const incomplete = parsed.data.tasks.filter((task) => {
      if (task.status !== "pending" && task.status !== "in_progress") {
        return false;
      }
      const owner = task.owner?.trim().toLowerCase();
      const ownerAgentID = task.owner_agent_id?.trim().toLowerCase();
      return owner === normalizedAgent || ownerAgentID === normalizedAgent;
    });

    if (incomplete.length === 0) {
      return null;
    }

    const taskRefs = incomplete.map((task) => `#${task.id}`).join(", ");
    return `[nexus] Escalation: ${normalizedAgent} returned, but owner tasks remain incomplete (${taskRefs}). Update these with nx_task_update or re-dispatch before proceeding.`;
  } catch {
    return null;
  }
}

async function buildPlanReminder(planFile: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await fs.readFile(planFile, "utf8")) as {
      topic?: unknown;
      issues?: Array<{ id?: unknown; title?: unknown; status?: unknown; decision?: unknown }>;
    };
    const issues = Array.isArray(raw.issues) ? raw.issues : [];
    const current = issues.find((issue) => issue.status === "pending") ?? null;
    const decidedCount = issues.filter((issue) => issue.status === "decided" || issue.status === "tasked").length;
    if (!current && issues.length > 0) {
      return `[nexus] Plan \"${String(raw.topic ?? "unknown topic")}\" allComplete (${decidedCount}/${issues.length}). Step 7 now: immediately create execution tasks with nx_task_add before any edits.`;
    }
    if (current) {
      return `[nexus] Plan \"${String(raw.topic ?? "unknown topic")}\" active. Current issue: ${String(current.id ?? "unknown")} \"${String(current.title ?? "untitled")}\". Decided ${decidedCount}/${issues.length}.`;
    }
    return `[nexus] Plan \"${String(raw.topic ?? "unknown topic")}\" active. No pending issue selected yet.`;
  } catch {
    return null;
  }
}
