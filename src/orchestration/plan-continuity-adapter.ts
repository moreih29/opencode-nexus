import { pickContinuityFromState } from "./core.js";
import { readOrchestrationCoreState } from "./core-store.js";

export interface PlanParticipantContinuity {
  role: string;
  task_id: string | null;
  session_id: string | null;
  last_summary: string | null;
  updated_at: string | null;
  source: "orchestration-core" | "plan-sidecar";
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
