import assert from "node:assert/strict";

const corePath = "../dist/orchestration/core.js";
const core = await import(new URL(corePath, import.meta.url).href);

assert.equal(typeof core.applyRegisterStart, "function", "core must export applyRegisterStart");
assert.equal(typeof core.applyRegisterEnd, "function", "core must export applyRegisterEnd");
assert.equal(typeof core.pickContinuityFromState, "function", "core must export pickContinuityFromState");
assert.equal(typeof core.buildDelegationPlanFromState, "function", "core must export buildDelegationPlanFromState");
assert.equal(typeof core.createEmptyOrchestrationCoreState, "function", "core must export createEmptyOrchestrationCoreState");

let state = core.createEmptyOrchestrationCoreState("2026-04-02T00:00:00.000Z");

const startA = core.applyRegisterStart(
  state,
  {
    invocation_id: "inv-a",
    agent_type: "architect",
    coordination_label: "how-panel",
    team_name: "how-panel",
    purpose: "continuity-a"
  },
  "2026-04-02T00:00:01.000Z"
);
state = startA.nextState;
assert.equal(startA.invocation.status, "running", "register start should mark invocation as running");
assert.equal(state.invocations.length, 1, "register start should append invocation into state");

const endA = core.applyRegisterEnd(
  state,
  {
    invocation_id: "inv-a",
    status: "completed",
    runtime_metadata: {
      task_id: "task-old",
      session_id: "ses-old"
    }
  },
  "2026-04-02T00:00:02.000Z"
);
state = endA.nextState;
assert.equal(endA.invocation?.status, "completed", "register end should mark invocation as completed");

const selectedAfterA = core.pickContinuityFromState(state, {
  agent_type: "architect",
  coordination_label: "how-panel"
});
assert.deepEqual(
  pickHandles(selectedAfterA),
  { taskID: "task-old", sessionID: "ses-old" },
  "register end should capture observed handles"
);

state = core.applyRegisterStart(
  state,
  {
    invocation_id: "inv-b",
    agent_type: "architect",
    coordination_label: "how-panel",
    purpose: "continuity-b"
  },
  "2026-04-02T00:00:03.000Z"
).nextState;

state = core.applyRegisterEnd(
  state,
  {
    invocation_id: "inv-b",
    status: "completed",
    runtime_metadata: {
      task_id: "task-new",
      session_id: "ses-new"
    }
  },
  "2026-04-02T00:00:04.000Z"
).nextState;

const selectedFresh = core.pickContinuityFromState(state, {
  agent_type: "architect",
  coordination_label: "how-panel"
});
assert.deepEqual(
  pickHandles(selectedFresh),
  { taskID: "task-new", sessionID: "ses-new" },
  "continuity should prefer freshest valid handles"
);

state = core.applyRegisterStart(
  state,
  {
    invocation_id: "inv-resume-only",
    agent_type: "architect",
    coordination_label: "how-panel",
    purpose: "continuity-resume-only"
  },
  "2026-04-02T00:00:04.500Z"
).nextState;

state = core.applyRegisterEnd(
  state,
  {
    invocation_id: "inv-resume-only",
    status: "completed",
    runtime_metadata: {
      resume_task_id: "resume-task-newer",
      resume_session_id: "resume-ses-newer",
      resume_handles: {
        thread: "thread-123",
        cursor: "cursor-456"
      }
    }
  },
  "2026-04-02T00:00:04.600Z"
).nextState;

const latestRegardlessOfRunning = core.pickContinuityFromState(state, {
  agent_type: "architect",
  coordination_label: "how-panel",
  prefer_running: false
});
assert.equal(
  latestRegardlessOfRunning?.continuity?.resume_task_id,
  "resume-task-newer",
  "prefer_running=false should prefer freshest valid continuity even without child handles"
);
assert.equal(
  latestRegardlessOfRunning?.continuity?.resume_session_id,
  "resume-ses-newer",
  "prefer_running=false should expose freshest resume session"
);

const resumeOnlyPlan = core.buildDelegationPlanFromState(state, {
  agent_type: "architect",
  coordination_label: "how-panel",
  purpose: "follow-up"
});
assert.equal(
  resumeOnlyPlan.adapter_hints.resume_task_id,
  "resume-task-newer",
  "delegation should use the selected continuity record, then prefer child vs resume handles within that record"
);
assert.equal(
  resumeOnlyPlan.adapter_hints.resume_session_id,
  "resume-ses-newer",
  "delegation should use the selected continuity record, then prefer child vs resume handles within that record"
);
assert.deepEqual(
  latestRegardlessOfRunning?.continuity?.resume_handles,
  {
    thread: "thread-123",
    cursor: "cursor-456"
  },
  "resume handles should be captured from runtime metadata"
);

state = core.applyRegisterStart(
  state,
  {
    invocation_id: "inv-c",
    agent_type: "architect",
    coordination_label: "how-panel",
    purpose: "continuity-c"
  },
  "2026-04-02T00:00:05.000Z"
).nextState;

state = core.applyRegisterEnd(
  state,
  {
    invocation_id: "inv-c",
    status: "completed",
    runtime_metadata: {
      task_id: null,
      session_id: null,
      team_name: "how-panel"
    }
  },
  "2026-04-02T00:00:06.000Z"
).nextState;

const selectedAfterNull = core.pickContinuityFromState(state, {
  agent_type: "architect",
  coordination_label: "how-panel"
});
assert.equal(
  selectedAfterNull?.continuity?.resume_task_id,
  "resume-task-newer",
  "partial/null metadata should not erase the freshest previously valid continuity record"
);
assert.equal(
  selectedAfterNull?.continuity?.resume_session_id,
  "resume-ses-newer",
  "partial/null metadata should not erase the freshest previously valid continuity record"
);

state = core.applyRegisterStart(
  state,
  {
    invocation_id: "inv-team-only",
    agent_type: "strategist",
    coordination_label: "label-only",
    team_name: "label-only",
    purpose: "team-only"
  },
  "2026-04-02T00:00:07.000Z"
).nextState;

const teamOnlyPlan = core.buildDelegationPlanFromState(state, {
  agent_type: "strategist",
  coordination_label: "label-only",
  purpose: "team-only"
});
assert.equal(teamOnlyPlan.resume_from, undefined, "team label alone should not imply resumability");
assert.equal(teamOnlyPlan.adapter_hints.resume_task_id, undefined, "team-only plan should not have resume task id");
assert.equal(teamOnlyPlan.adapter_hints.resume_session_id, undefined, "team-only plan should not have resume session id");

let resumeOnlyState = core.createEmptyOrchestrationCoreState("2026-04-02T00:01:00.000Z");
resumeOnlyState = core.applyRegisterStart(
  resumeOnlyState,
  {
    invocation_id: "inv-resume-plan",
    agent_type: "researcher",
    coordination_label: "resume-only",
    purpose: "resume-plan"
  },
  "2026-04-02T00:01:01.000Z"
).nextState;
resumeOnlyState = core.applyRegisterEnd(
  resumeOnlyState,
  {
    invocation_id: "inv-resume-plan",
    status: "completed",
    runtime_metadata: {
      resume_task_id: "resume-task-only",
      resume_session_id: "resume-session-only",
      resume_handles: {
        ticket: "ticket-1"
      }
    }
  },
  "2026-04-02T00:01:02.000Z"
).nextState;

const resumeOnlyAdapterPlan = core.buildDelegationPlanFromState(resumeOnlyState, {
  agent_type: "researcher",
  coordination_label: "resume-only",
  purpose: "resume-plan"
});
assert.equal(
  resumeOnlyAdapterPlan.adapter_hints.resume_task_id,
  "resume-task-only",
  "delegation should expose resume_task_id when no child task handle exists"
);
assert.equal(
  resumeOnlyAdapterPlan.adapter_hints.resume_session_id,
  "resume-session-only",
  "delegation should expose resume_session_id when no child session handle exists"
);
assert.deepEqual(
  resumeOnlyAdapterPlan.adapter_hints.resume_handles,
  { ticket: "ticket-1" },
  "delegation should preserve resume_handles for adapter use"
);

console.log(`e2e orchestration core passed (${corePath})`);

function pickHandles(selection) {
  return {
    taskID: selection?.continuity?.child_task_id ?? null,
    sessionID: selection?.continuity?.child_session_id ?? null
  };
}
