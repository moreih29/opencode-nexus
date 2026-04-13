import { pickContinuityFromState } from "./core.js";
import { readOrchestrationCoreState } from "./core-store.js";
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
  const state = await readOrchestrationCoreState(coreFilePath);

  const selected =
    pickContinuityFromState(state, {
      agent_type: normalizedRole,
      coordination_label: "plan-panel",
      prefer_running: true
    })
    ?? pickContinuityFromState(state, {
      agent_type: normalizedRole,
      prefer_running: true
    });

  if (!selected) {
    return null;
  }

  const invocation = state.invocations.find((item) => item.invocation_id === selected.invocation_id);

  return {
    role: selected.agent_type,
    task_id: selected.continuity.child_task_id ?? selected.continuity.resume_task_id ?? null,
    session_id: selected.continuity.child_session_id ?? selected.continuity.resume_session_id ?? null,
    last_summary: invocation?.last_message ?? null,
    updated_at: invocation?.updated_at ?? null,
    source: "orchestration-core"
  };
}
