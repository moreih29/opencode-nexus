import path from "node:path";
import fs from "node:fs/promises";
import { NEXUS_AGENT_CATALOG } from "../agents/catalog.js";
import { NO_FILE_EDIT_TOOLS } from "../agents/prompts.js";
import { registerEnd, registerStart } from "../orchestration/core.js";
import {
  buildRunContinuityAdapterHints,
  injectMissingRunResumeArgs,
  selectRunContinuityFromCore
} from "../orchestration/run-continuity-adapter.js";
import {
  buildPlanContinuityAdapterHints,
  injectMissingPlanResumeArgs,
  readPlanParticipantContinuityFromCore
} from "../orchestration/plan-continuity-adapter.js";
import { evaluatePipelineSnapshot as evaluatePipelineSnapshotPure } from "../pipeline/evaluator.js";
import { canJoinPlanWithoutTeam, isKnownNexusAgent, requiresTeamInRunMode } from "../orchestration/team-policy.js";
import { NEXUS_SKILL_CATALOG } from "../skills/catalog.js";
import { evaluateQaAutoTrigger } from "../pipeline/qa-trigger.js";
import { appendAgentTracker, hasRunningTeam, markLatestTeamCompleted } from "../shared/agent-tracker.js";
import { appendGlobalAuditLog, appendSessionAuditLog, appendSubagentAuditLog, toAuditRecord } from "../shared/audit-log.js";
import { loadCanonicalPlan, syncPlanSidecar } from "../shared/plan-sidecar.js";
import { createNexusPaths, isNexusInternalPath } from "../shared/paths.js";
import { ensureNexusStructure, fileExists, readTasksSummary, resetAgentTracker } from "../shared/state.js";
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
}

interface ToolOutput {
  args: Record<string, unknown>;
}

interface ChatOutput {
  parts: Array<{ type?: string; text?: string }>;
}

type PipelineTaskStatus = "pending" | "in_progress" | "completed" | "blocked";

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
    | "resolve_blocked_tasks"
    | "close_cycle"
    | "spawn_qa_then_close";
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

  return {
    event: async ({ event }: { event: { type: string } }) => {
      await writeAuditEntry(paths, {
        kind: "event",
        event_type: event.type,
        session_id: pickSessionID(event),
        payload: toAuditRecord(event)
      });

      if (event.type === "session.created") {
        await ensureNexusStructure(paths);
        await resetAgentTracker(paths.AGENT_TRACKER_FILE);
        try {
          await syncAgentsMdTemplate(paths.PROJECT_ROOT);
        } catch {
          // sync failure must not block session initialization
        }
      }
    },

    "tool.execute.before": async (input: ToolInput, output: ToolOutput) => {
      if (input.tool === "task") {
        output.args = await injectRunContinuityForTask(paths, output.args);
        output.args = await injectPlanContinuityForTask(paths, output.args);
      }

      const sessionID = pickSessionID(input) ?? pickSessionID(output.args);
      const subagentInvocation = input.tool === "task" ? registerSubagentInvocation(ctx.state, output.args, sessionID) : null;

      await writeAuditEntry(paths, {
        kind: "tool.execute.before",
        tool: input.tool,
        session_id: sessionID,
        args: toAuditRecord(output.args),
        subagent: subagentInvocation
          ? {
              invocation_id: subagentInvocation.invocationID,
              agent_type: subagentInvocation.agentType,
              team_name: subagentInvocation.teamName,
              fingerprint: subagentInvocation.fingerprint
            }
          : null
      });

      if (subagentInvocation) {
        await appendSubagentAuditLog(paths, sessionID, subagentInvocation.invocationID, {
          ts: new Date().toISOString(),
          kind: "subagent.lifecycle",
          phase: "before",
          invocation_id: subagentInvocation.invocationID,
          started_at: subagentInvocation.startedAt,
          agent_type: subagentInvocation.agentType,
          team_name: subagentInvocation.teamName,
          session_id: sessionID,
          args: toAuditRecord(output.args)
        });
      }

      if (input.tool === "nx_plan_start") {
        await validatePlanStart(output.args, paths.AGENT_TRACKER_FILE);
      }

      if (input.tool === "task") {
        await enforceTaskTeamPolicy(output.args, paths);
        await trackSubagentStart(output.args, paths.AGENT_TRACKER_FILE);
      }

      if (input.tool === "nx_task_close") {
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
      if (!evaluation.editsAllowed && evaluation.nextGuidanceKey === "task_cycle_required") {
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

      await writeAuditEntry(paths, {
        kind: "tool.execute.after",
        tool: input.tool,
        session_id: sessionID,
        title: output.title,
        output_preview: output.output.slice(0, 1000),
        metadata: toAuditRecord(output.metadata),
        subagent: subagentInvocation
          ? {
              invocation_id: subagentInvocation.invocationID,
              started_at: subagentInvocation.startedAt,
              agent_type: subagentInvocation.agentType,
              team_name: subagentInvocation.teamName,
              fingerprint: subagentInvocation.fingerprint,
              task_id: taskHandles.taskID ?? null,
              session_id: taskHandles.sessionID ?? null
            }
          : null
      });

      if (subagentInvocation) {
        await appendSubagentAuditLog(paths, sessionID, subagentInvocation.invocationID, {
          ts: new Date().toISOString(),
          kind: "subagent.lifecycle",
          phase: "after",
          invocation_id: subagentInvocation.invocationID,
          started_at: subagentInvocation.startedAt,
          agent_type: subagentInvocation.agentType,
          team_name: subagentInvocation.teamName,
          session_id: sessionID,
          subagent_task_id: taskHandles.taskID ?? null,
          subagent_session_id: taskHandles.sessionID ?? null,
          title: output.title,
          output_preview: output.output.slice(0, 1000),
          metadata: toAuditRecord(output.metadata)
        });
      }

      if (input.tool !== "task") {
        return;
      }

      const agentType = pickString(input.args, ["subagent_type", "agent", "type"]);
      if (!agentType) {
        return;
      }
      await markLatestTeamCompleted(paths.AGENT_TRACKER_FILE, agentType, output.output.slice(0, 500));
      await updateRunParticipantContinuity(paths, input.args, output, taskHandles, subagentInvocation?.invocationID ?? null);
      await updatePlanParticipantContinuity(paths, input.args, output);
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
        return;
      }
      const summary = await readTasksSummary(paths.TASKS_FILE);
      if (!summary || summary.total === 0) {
        await safeUnlink(paths.STOP_WARNED_FILE);
        return;
      }

      const evaluation = await evaluatePipelineFromSummary(summary);
      const status = getExitGuardStatus(evaluation);
      const previous = await readStopWarning(paths.STOP_WARNED_FILE);
      const repeated = previous === status;
      await fs.writeFile(paths.STOP_WARNED_FILE, `${status}\n`, "utf8");

      output.parts.push({
        type: "text",
        text: buildExitWarning(status, repeated)
      } as Record<string, unknown>);
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

      // Core file count
      try {
        let coreFileCount = 0;
        const coreLayers = ["identity", "codebase", "reference", "memory"] as const;
        for (const layer of coreLayers) {
          const layerDir = path.join(paths.CORE_ROOT, layer);
          try {
            const files = await fs.readdir(layerDir);
            coreFileCount += files.filter((f) => f.endsWith(".md")).length;
          } catch {
            // layer dir may not exist
          }
        }
        if (coreFileCount > 0) {
          parts.push(`core: ${coreFileCount} files`);
        }
      } catch {
        // skip core count on error
      }

      // Active agents
      try {
        const raw = await fs.readFile(paths.AGENT_TRACKER_FILE, "utf8");
        const tracker = JSON.parse(raw) as Array<{ agent_type?: string; status?: string }>;
        const active = tracker
          .filter((a) => a.status === "running" || a.status === "team-spawning")
          .map((a) => a.agent_type ?? "unknown");
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
          "[nexus] Quick start: use [plan] to decide, [run] to execute tasks, nx_task_close to archive when complete."
        );
        ctx.state.onboardedSessions.add(sessionID);
      }
      const prompt = sessionID ? ctx.state.lastPromptBySession.get(sessionID) ?? "" : "";
      const mode = detectNexusTag(prompt) ?? "idle";
      output.system.push(
        buildNexusSystemPrompt({
          mode,
          agents: NEXUS_AGENT_CATALOG,
          skills: NEXUS_SKILL_CATALOG
        })
      );
    }
  };
}

function isEditLikeTool(toolName: string): boolean {
  // Sourced from nexus-core capability `no_file_edit` via capability-map.yml resolution.
  // Generated into prompts.generated.ts — keeps opencode-nexus in sync with nexus-core.
  return NO_FILE_EDIT_TOOLS.includes(toolName);
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

async function validatePlanStart(args: Record<string, unknown>, trackerFile: string): Promise<void> {
  const attendees = Array.isArray(args.attendees) ? args.attendees : [];
  const hasNonLead = attendees.some((a) => {
    if (!a || typeof a !== "object") {
      return false;
    }
    const role = (a as { role?: unknown }).role;
    return typeof role === "string" && !canJoinPlanWithoutTeam(role);
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

  const hasPlan = await fileExists(paths.PLAN_FILE);
  const hasTasks = await fileExists(paths.TASKS_FILE);
  const inRunMode = hasTasks && !hasPlan;
  if (!inRunMode || !requiresTeamInRunMode(agentType)) {
    return;
  }

  const teamName = pickCoordinationLabel(args);
  if (!teamName) {
    throw new Error(`Run mode requires a shared team_name coordination label for ${agentType} subagent tasks.`);
  }
}

async function trackSubagentStart(args: Record<string, unknown>, trackerFile: string): Promise<void> {
  const agentType = pickString(args, ["subagent_type", "agent", "type"]);
  if (!agentType) {
    return;
  }

  const teamName = pickCoordinationLabel(args);
  await appendAgentTracker(trackerFile, {
    agent_type: agentType,
    status: teamName ? "team-spawning" : "running",
    team_name: teamName ?? undefined,
    coordination_label: teamName ?? undefined,
    lead_agent: "lead",
    purpose: pickString(args, ["description", "task", "prompt"]) ?? undefined,
    started_at: new Date().toISOString()
  });
}

async function updatePlanParticipantContinuity(
  paths: ReturnType<typeof createNexusPaths>,
  args: Record<string, unknown>,
  output: { title: string; output: string; metadata: unknown }
): Promise<void> {
  const agentType = pickString(args, ["subagent_type", "agent", "type"]);
  if (!agentType || !isHowAgent(agentType)) {
    return;
  }

  const plan = await loadCanonicalPlan(paths.PLAN_FILE);
  if (!plan) {
    return;
  }

  const handles = extractParticipantHandles(output.metadata);
  const continuityInvocationID = createPlanContinuityInvocationID(agentType);
  const coordinationLabel = pickCoordinationLabel(args) ?? undefined;
  await registerStart(paths.ORCHESTRATION_CORE_FILE, {
    invocation_id: continuityInvocationID,
    agent_type: agentType,
    coordination_label: coordinationLabel,
    team_name: coordinationLabel,
    purpose: pickString(args, ["description", "task", "prompt"]) ?? undefined
  });
  await registerEnd(paths.ORCHESTRATION_CORE_FILE, {
    invocation_id: continuityInvocationID,
    status: "completed",
    last_message: output.output.slice(0, 500),
    runtime_metadata: output.metadata,
    continuity: {
      child_task_id: handles.taskID,
      child_session_id: handles.sessionID
    }
  });

  await syncPlanSidecar(paths.PLAN_SIDECAR_FILE, plan, {
    speaker: agentType,
    message: output.output.slice(0, 500),
    taskID: handles.taskID,
    sessionID: handles.sessionID,
    teamName: coordinationLabel
  });
}

async function updateRunParticipantContinuity(
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
  await registerStart(paths.ORCHESTRATION_CORE_FILE, {
    invocation_id: invocationID,
    agent_type: agentType,
    coordination_label: coordinationLabel,
    team_name: coordinationLabel,
    purpose: pickString(args, ["description", "task", "prompt"]) ?? undefined
  });
  await registerEnd(paths.ORCHESTRATION_CORE_FILE, {
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

async function injectRunContinuityForTask(
  paths: ReturnType<typeof createNexusPaths>,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!(await isRunMode(paths))) {
    return args;
  }

  const agentType = pickString(args, ["subagent_type", "agent", "type"]);
  if (!agentType) {
    return args;
  }

  const continuity = await selectRunContinuityFromCore(paths.ORCHESTRATION_CORE_FILE, {
    agent_type: agentType,
    coordination_label: pickCoordinationLabel(args) ?? undefined
  });

  if (!continuity) {
    return args;
  }

  const hints = buildRunContinuityAdapterHints(continuity);
  return injectMissingRunResumeArgs(args, hints);
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
    paths.ORCHESTRATION_CORE_FILE,
    agentType
  );
  if (!continuity) {
    console.error(`[plan-resume-inject] no continuity found for agent_type=${agentType}`);
    return args;
  }

  const hints = buildPlanContinuityAdapterHints(continuity);
  const nextArgs = injectMissingPlanResumeArgs(args, { resume_task_id: hints.resume_task_id });
  if (nextArgs !== args && nextArgs.task_id) {
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
  return NEXUS_AGENT_CATALOG.some((agent) => agent.category === "how" && agent.id === agentType.toLowerCase());
}

function isDoOrCheckAgent(agentType: string): boolean {
  const normalized = agentType.toLowerCase();
  return NEXUS_AGENT_CATALOG.some(
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
  if (result.nextGuidanceKey === "resume_active_cycle" || result.nextGuidanceKey === "resolve_blocked_tasks") {
    return "active" as const;
  }
  if (result.nextGuidanceKey === "close_cycle" || result.nextGuidanceKey === "spawn_qa_then_close") {
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

async function writeAuditEntry(
  paths: ReturnType<typeof createNexusPaths>,
  entry: Record<string, unknown>
): Promise<void> {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    ...entry
  };
  await appendGlobalAuditLog(paths, record);
  await appendSessionAuditLog(paths, typeof record.session_id === "string" ? record.session_id : null, record);
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
  const hasPlan = await fileExists(paths.PLAN_FILE);
  const taskSummary = await readTasksSummary(paths.TASKS_FILE);
  const planReminder = hasPlan ? await buildPlanReminder(paths.PLAN_FILE) : null;
  const ruleTags = detectRuleTags(prompt);
  const attendeeMentions = detectAttendeeMentions(prompt);

  if (attendeeMentions.length > 0) {
    if (hasPlan) {
      return `[nexus] Attendee request detected (${attendeeMentions.join(", ")}). Add them with nx_plan_join before continuing discussion.`;
    }
    return `[nexus] Attendee request detected (${attendeeMentions.join(", ")}). Start or resume a plan first, then use nx_plan_join.`;
  }

  if (!mode) {
    if (planReminder) {
      return planReminder;
    }
    if (taskSummary) {
      const evaluation = await evaluatePipelineFromSummary(taskSummary);
      if (evaluation.nextGuidanceKey === "resume_active_cycle" || evaluation.nextGuidanceKey === "resolve_blocked_tasks") {
        return [
          "[nexus] Active task cycle detected.",
          `pending=${taskSummary.pending}, in_progress=${taskSummary.in_progress}, blocked=${taskSummary.blocked}`,
          taskSummary.blocked > 0 ? "Resolve blocked tasks or explicitly re-plan before continuing implementation." : "",
          "Resume work, update task states with nx_task_update, verify when complete, and close with nx_task_close after optional nx_sync."
        ].join(" ");
      }
      if (evaluation.nextGuidanceKey === "close_cycle" || evaluation.nextGuidanceKey === "spawn_qa_then_close") {
        return "[nexus] A completed task cycle is still open. Verify if needed, run nx_sync when useful, then nx_task_close before starting a new edit cycle.";
      }
    }
    return null;
  }

  const fallback = buildTagNotice(mode);

  if (mode === "plan") {
    return hasPlan
      ? [
          "[nexus] Plan session is active.",
          planReminder ?? "",
          "Continue one issue at a time. Record major deliberation with nx_plan_discuss, compare options with trade-offs, and use [d] -> nx_plan_decide only after discussion is logged. Do not open the next issue until the current issue is decided or explicitly deferred."
        ]
          .filter(Boolean)
          .join(" ")
      : [
          "[nexus] Plan mode detected.",
          "Research first, then start with nx_plan_start(topic, research_summary, issues). Do not open discussion until the current issue has grounded research.",
          "If non-lead attendees are needed, start grouped coordination before starting the plan.",
          "Keep the agenda one issue at a time and decide only after discussing trade-offs."
        ].join(" ");
  }

  if (mode === "decide") {
    return hasPlan
      ? "[nexus] Decision tag detected. Record supporting reasoning with nx_plan_discuss first if it is missing, then record the active issue with nx_plan_decide."
      : "[nexus] [d] detected but no active plan session. Run nx_plan_start first.";
  }

  if (mode === "run") {
    let qaReasons: string[] = [];
    let evaluation = await evaluatePipelineFromSummary(taskSummary, qaReasons);
    if (taskSummary && evaluation.nextGuidanceKey === "close_cycle") {
      qaReasons = (await evaluateQaAutoTrigger(projectRoot, [])).reasons;
      evaluation = await evaluatePipelineFromSummary(taskSummary, qaReasons);
    }
    if (evaluation.nextGuidanceKey === "task_cycle_required") {
      return [
        "[nexus] Run mode detected. No task cycle yet.",
        branchGuard ? `Branch Guard: current branch is ${branch}. Create a task branch before substantial execution.` : "",
        "TASK PIPELINE: check plan decisions, decompose work, register each task with nx_task_add, then edit.",
        "If decomposition yields multiple tasks or multiple target files, do not continue as Lead solo; delegate code execution units to Engineer.",
        "Use nx_briefing before specialist delegation when prior decisions or role-specific context matter.",
        "After implementation, update task states, verify, optionally nx_sync, and close with nx_task_close."
      ].join(" ");
    }
    if (evaluation.nextGuidanceKey === "resume_active_cycle" || evaluation.nextGuidanceKey === "resolve_blocked_tasks") {
      const activeSummary = taskSummary ?? { pending: 0, in_progress: 0, blocked: 0 };
      return [
        "[nexus] Run mode detected.",
        branchGuard ? `Branch Guard: current branch is ${branch}. Avoid substantial execution on the default branch.` : "",
        `Active tasks: pending=${activeSummary.pending}, in_progress=${activeSummary.in_progress}, blocked=${activeSummary.blocked}.`,
        activeSummary.blocked > 0 ? "Resolve blocked tasks before opening more implementation scope." : "",
        "Keep edits scoped to active tasks, do not continue as Lead solo once work is decomposed, involve Engineer for code execution units, use nx_briefing before specialist delegation, and update status as each unit completes."
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
    return `[nexus] Rule mode detected. Save durable conventions to .nexus/rules with nx_rules_write.${suffix}`;
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
  summary: { pending: number; in_progress: number; blocked: number; completed: number; total: number } | null,
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

function expandSummaryTasks(
  summary: { pending: number; in_progress: number; blocked: number; completed: number } | null
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
  for (let i = 0; i < summary.blocked; i += 1) {
    tasks.push({ status: "blocked" });
  }
  for (let i = 0; i < summary.completed; i += 1) {
    tasks.push({ status: "completed" });
  }
  return tasks;
}

async function evaluatePipelineSnapshot(snapshot: PipelineEvaluatorSnapshot): Promise<PipelineEvaluatorResult> {
  return evaluatePipelineSnapshotPure(snapshot);
}

async function buildPlanReminder(planFile: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await fs.readFile(planFile, "utf8")) as {
      topic?: unknown;
      issues?: Array<{ id?: unknown; title?: unknown; status?: unknown; decision?: unknown; task_refs?: unknown[] }>;
    };
    const issues = Array.isArray(raw.issues) ? raw.issues : [];
    const active = issues.find((issue) => issue.status === "researching" || issue.status === "discussing");
    const queued = issues.find((issue) => issue.status === "pending" || issue.status === "deferred");
    const current = active ?? queued;
    const decidedCount = issues.filter((issue) => issue.status === "decided" || issue.status === "tasked").length;
    const currentText = current
      ? `Current issue: ${String(current.id ?? "unknown")} \"${String(current.title ?? "untitled")}\" (${String(current.status ?? "unknown")}).`
      : "All issues are decided or already linked to execution.";
    return `[nexus] Plan session \"${String(raw.topic ?? "unknown topic")}\" is active. ${currentText} Decided ${decidedCount}/${issues.length}. Use one-issue-at-a-time discussion, record important reasoning in nx_plan_discuss, and do not open the next issue until the current issue is decided or explicitly deferred.`;
  } catch {
    return null;
  }
}
