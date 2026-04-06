import type { OrchestrationCoreState } from "../shared/schema.js";
import { type ContinuitySelection, pickContinuityFromState } from "./core.js";
import { readOrchestrationCoreState } from "./core-store.js";

export interface RunContinuityQuery {
  agent_type: string;
  coordination_label?: string;
}

export interface RunContinuitySelection {
  selected: ContinuitySelection;
  matched_by: "agent+coordination_label" | "agent";
}

export interface RunContinuityAdapterHints {
  resume_task_id?: string;
  resume_session_id?: string;
  resume_handles: Record<string, string>;
}

export async function selectRunContinuityFromCore(
  coreFilePath: string,
  query: RunContinuityQuery
): Promise<RunContinuitySelection | null> {
  const state = await readOrchestrationCoreState(coreFilePath);
  return selectRunContinuityFromState(state, query);
}

export function selectRunContinuityFromState(
  state: OrchestrationCoreState,
  query: RunContinuityQuery
): RunContinuitySelection | null {
  const normalizedAgentType = normalizeRequired(query.agent_type);
  if (!normalizedAgentType) {
    return null;
  }

  const normalizedLabel = normalizeOptional(query.coordination_label);
  if (normalizedLabel) {
    const matchedByLabel = pickContinuityFromState(state, {
      agent_type: normalizedAgentType,
      coordination_label: normalizedLabel,
      prefer_running: true
    });
    if (matchedByLabel) {
      return {
        selected: matchedByLabel,
        matched_by: "agent+coordination_label"
      };
    }
  }

  const matchedByAgent = pickContinuityFromState(state, {
    agent_type: normalizedAgentType,
    prefer_running: true
  });

  if (!matchedByAgent) {
    return null;
  }

  return {
    selected: matchedByAgent,
    matched_by: "agent"
  };
}

export function buildRunContinuityAdapterHints(
  continuity: RunContinuitySelection | ContinuitySelection | null
): RunContinuityAdapterHints {
  const selected = isSelectionEnvelope(continuity) ? continuity.selected : continuity;
  const handles = selected?.continuity;
  return {
    resume_task_id: handles?.child_task_id ?? handles?.resume_task_id,
    resume_session_id: handles?.child_session_id ?? handles?.resume_session_id,
    resume_handles: { ...(handles?.resume_handles ?? {}) }
  };
}

export function injectMissingRunResumeArgs(
  args: Record<string, unknown>,
  hints: RunContinuityAdapterHints
): Record<string, unknown> {
  const nextArgs: Record<string, unknown> = { ...args };

  if (!hasAnyKey(args, ["resume_task_id", "resumeTaskID", "resumeTaskId"]) && hints.resume_task_id) {
    nextArgs.resume_task_id = hints.resume_task_id;
  }

  if (!hasAnyKey(args, ["resume_session_id", "resumeSessionID", "resumeSessionId"]) && hints.resume_session_id) {
    nextArgs.resume_session_id = hints.resume_session_id;
  }

  if (!hasAnyKey(args, ["resume_handles", "resumeHandles", "resume"]) && Object.keys(hints.resume_handles).length > 0) {
    nextArgs.resume_handles = { ...hints.resume_handles };
  }

  return nextArgs;
}

function isSelectionEnvelope(
  value: RunContinuitySelection | ContinuitySelection | null
): value is RunContinuitySelection {
  return Boolean(value && typeof value === "object" && "selected" in value);
}

function hasAnyKey(source: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(source, key));
}

function normalizeRequired(value: string): string | null {
  const normalized = normalizeOptional(value);
  return normalized ?? null;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
