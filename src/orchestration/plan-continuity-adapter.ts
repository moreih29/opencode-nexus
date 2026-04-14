import { pickContinuityFromTrackerState, readAgentTracker } from "../shared/agent-tracker.js";
import type { RunContinuityAdapterHints } from "./run-continuity-adapter.js";

export interface PlanParticipantContinuity {
  role: string;
  task_id: string | null;
  session_id: string | null;
  last_summary: string | null;
  updated_at: string | null;
  source: "orchestration-core" | "plan-sidecar";
}

/**
 * Build adapter hints for plan-mode resume injection into task tool args.
 *
 * NOTE on opencode 1.3.13 semantics: the task tool's `task_id` parameter
 * actually points to the *child session id* of the prior subagent invocation
 * (verified via task tool output messages: "task_id: ses_xxx (for resuming...)"
 * where ses_xxx is the child session id). Therefore we fall back to
 * continuity.session_id when explicit task_id is absent — both refer to the
 * same opencode-level resume target.
 */
export function buildPlanContinuityAdapterHints(
  continuity: PlanParticipantContinuity | null
): RunContinuityAdapterHints {
  return {
    resume_task_id: continuity?.task_id ?? continuity?.session_id ?? undefined,
    resume_session_id: continuity?.session_id ?? undefined,
    resume_handles: {}
  };
}

/**
 * Inject resume hint into opencode task tool args using opencode 1.3.13 native naming.
 * The opencode task tool accepts a single `task_id` field that points to the prior
 * subagent session to resume. This differs from the Claude Code-style
 * `resume_task_id` / `resume_session_id` naming used by injectMissingRunResumeArgs.
 *
 * Verified via audit log inspection (2026-04-13) — the LLM naturally fills
 * args.task_id when continuing a prior subagent session, but plugin-side injection
 * is needed as a fallback when the LLM omits it (e.g., cross-turn delegation
 * without explicit task_id reference).
 */
export function injectMissingPlanResumeArgs(
  args: Record<string, unknown>,
  hints: { resume_task_id?: string }
): Record<string, unknown> {
  if (
    !hints.resume_task_id ||
    Object.prototype.hasOwnProperty.call(args, "task_id") ||
    Object.prototype.hasOwnProperty.call(args, "taskId")
  ) {
    return args;
  }
  return { ...args, task_id: hints.resume_task_id };
}

export async function readPlanParticipantContinuityFromCore(
  coreFilePath: string,
  role: string
): Promise<PlanParticipantContinuity | null> {
  const normalizedRole = role.toLowerCase();
  const tracker = await readAgentTracker(coreFilePath);

  const continuity =
    pickContinuityFromTrackerState(tracker, {
      agent_type: normalizedRole,
      coordination_label: "plan-panel",
      prefer_running: true
    })
    ?? pickContinuityFromTrackerState(tracker, {
      agent_type: normalizedRole,
      prefer_running: true
    });

  if (!continuity) {
    return null;
  }

  const invocation = tracker.invocations.find((item) => {
    if (item.agent_type.toLowerCase() !== normalizedRole) {
      return false;
    }
    const c = item.continuity;
    if (!c) {
      return false;
    }
    if (continuity.child_session_id && c.child_session_id === continuity.child_session_id) {
      return true;
    }
    if (continuity.child_task_id && c.child_task_id === continuity.child_task_id) {
      return true;
    }
    if (continuity.resume_task_id && c.resume_task_id === continuity.resume_task_id) {
      return true;
    }
    return false;
  });

  return {
    role: normalizedRole,
    task_id: continuity.child_task_id ?? continuity.resume_task_id ?? null,
    session_id: continuity.child_session_id ?? continuity.resume_session_id ?? null,
    last_summary: invocation?.last_message ?? null,
    updated_at: invocation?.updated_at ?? null,
    source: "orchestration-core"
  };
}

// Alias for consumers that prefer the tracker-oriented name.
export const readPlanParticipantContinuityFromTracker = readPlanParticipantContinuityFromCore;
