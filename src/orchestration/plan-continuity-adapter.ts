import { pickContinuityFromTrackerState, readAgentTracker } from "../shared/agent-tracker.js";
import type { Invocation } from "../shared/schema.js";
import type { RunContinuityAdapterHints } from "./run-continuity-adapter.js";

export interface PlanParticipantContinuity {
  role: string;
  task_id: string | null;
  session_id: string | null;
  last_summary: string | null;
  updated_at: string | null;
  source: "orchestration-core";
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

  const continuity = pickContinuityForRole(tracker, normalizedRole);

  if (!continuity) {
    return null;
  }

  const invocation = findInvocationForContinuity(tracker.invocations, normalizedRole, continuity);

  return {
    role: normalizedRole,
    task_id: continuity.child_task_id ?? continuity.resume_task_id ?? null,
    session_id: continuity.child_session_id ?? continuity.resume_session_id ?? null,
    last_summary: invocation?.last_message ?? null,
    updated_at: invocation?.updated_at ?? null,
    source: "orchestration-core"
  };
}

export async function readPlanParticipantSnapshotFromCore(
  coreFilePath: string,
  role: string
): Promise<PlanParticipantContinuity | null> {
  const normalizedRole = role.toLowerCase();
  const tracker = await readAgentTracker(coreFilePath);
  const continuity = pickContinuityForRole(tracker, normalizedRole);
  const continuityInvocation = continuity
    ? findInvocationForContinuity(tracker.invocations, normalizedRole, continuity)
    : null;
  const latestSummaryInvocation = pickLatestRoleInvocationWithSummary(tracker.invocations, normalizedRole);
  const summaryInvocation = continuityInvocation?.last_message ? continuityInvocation : latestSummaryInvocation;
  const task_id = continuity?.child_task_id ?? continuity?.resume_task_id ?? null;
  const session_id = continuity?.child_session_id ?? continuity?.resume_session_id ?? null;
  const last_summary = summaryInvocation?.last_message ?? null;
  const updated_at = summaryInvocation ? pickInvocationTimestamp(summaryInvocation) : null;

  if (!task_id && !session_id && !last_summary) {
    return null;
  }

  return {
    role: normalizedRole,
    task_id,
    session_id,
    last_summary,
    updated_at,
    source: "orchestration-core"
  };
}

// Alias for consumers that prefer the tracker-oriented name.
export const readPlanParticipantContinuityFromTracker = readPlanParticipantContinuityFromCore;

function pickContinuityForRole(
  tracker: Awaited<ReturnType<typeof readAgentTracker>>,
  normalizedRole: string
) {
  return (
    pickContinuityFromTrackerState(tracker, {
      agent_type: normalizedRole,
      coordination_label: "plan-panel",
      prefer_running: true
    })
    ?? pickContinuityFromTrackerState(tracker, {
      agent_type: normalizedRole,
      prefer_running: true
    })
  );
}

function findInvocationForContinuity(
  invocations: Invocation[],
  normalizedRole: string,
  continuity: NonNullable<ReturnType<typeof pickContinuityFromTrackerState>>
) {
  return invocations.find((item) => {
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
}

function pickLatestRoleInvocationWithSummary(invocations: Invocation[], normalizedRole: string) {
  const candidates = invocations
    .filter((item) => item.agent_type.toLowerCase() === normalizedRole && typeof item.last_message === "string" && item.last_message.trim().length > 0)
    .sort((left, right) => {
      const leftPlanPanel = left.coordination_label === "plan-panel" ? 1 : 0;
      const rightPlanPanel = right.coordination_label === "plan-panel" ? 1 : 0;
      if (leftPlanPanel !== rightPlanPanel) {
        return rightPlanPanel - leftPlanPanel;
      }
      return getInvocationTimestamp(right) - getInvocationTimestamp(left);
    });
  return candidates[0] ?? null;
}

function pickInvocationTimestamp(invocation: Invocation): string | null {
  return invocation.updated_at ?? invocation.ended_at ?? invocation.started_at ?? null;
}

function getInvocationTimestamp(invocation: Invocation): number {
  const candidate = invocation.ended_at ?? invocation.updated_at ?? invocation.started_at;
  const value = Date.parse(candidate);
  return Number.isFinite(value) ? value : -1;
}
