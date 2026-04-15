import assert from "node:assert/strict";

const trackerPath = "../dist/shared/agent-tracker.js";
const tracker = await import(new URL(trackerPath, import.meta.url).href);

assert.equal(typeof tracker.applyInvocationStart, "function", "agent-tracker must export applyInvocationStart");
assert.equal(typeof tracker.applyInvocationEnd, "function", "agent-tracker must export applyInvocationEnd");
assert.equal(typeof tracker.pickContinuityFromTrackerState, "function", "agent-tracker must export pickContinuityFromTrackerState");
assert.equal(typeof tracker.buildDelegationPlanFromTracker, "function", "agent-tracker must export buildDelegationPlanFromTracker");
assert.equal(typeof tracker.createEmptyAgentTracker, "function", "agent-tracker must export createEmptyAgentTracker");
assert.equal(
  typeof tracker.createDelegationTrackerRegistrar,
  "function",
  "agent-tracker must export createDelegationTrackerRegistrar"
);

let state = tracker.createEmptyAgentTracker("2026-04-02T00:00:00.000Z");

state = tracker.applyInvocationStart(
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
{
  const inv = state.invocations.find((i) => i.invocation_id === "inv-a");
  assert.equal(inv?.status, "running", "invocation start should append invocation in running status");
  assert.equal(state.invocations.length, 1, "invocation start should append invocation into state");
}

state = tracker.applyInvocationEnd(
  state,
  "inv-a",
  {
    status: "completed",
    runtime_metadata: {
      task_id: "task-old",
      session_id: "ses-old"
    }
  },
  "2026-04-02T00:00:02.000Z"
);
{
  const inv = state.invocations.find((i) => i.invocation_id === "inv-a");
  assert.equal(inv?.status, "completed", "invocation end should mark invocation as completed");
}

const selectedAfterA = tracker.pickContinuityFromTrackerState(state, {
  agent_type: "architect",
  coordination_label: "how-panel"
});
assert.deepEqual(
  pickHandles(selectedAfterA),
  { taskID: "task-old", sessionID: "ses-old" },
  "invocation end should capture observed handles"
);

state = tracker.applyInvocationStart(
  state,
  {
    invocation_id: "inv-b",
    agent_type: "architect",
    coordination_label: "how-panel",
    purpose: "continuity-b"
  },
  "2026-04-02T00:00:03.000Z"
);

state = tracker.applyInvocationEnd(
  state,
  "inv-b",
  {
    status: "completed",
    runtime_metadata: {
      task_id: "task-new",
      session_id: "ses-new"
    }
  },
  "2026-04-02T00:00:04.000Z"
);

const selectedFresh = tracker.pickContinuityFromTrackerState(state, {
  agent_type: "architect",
  coordination_label: "how-panel"
});
assert.deepEqual(
  pickHandles(selectedFresh),
  { taskID: "task-new", sessionID: "ses-new" },
  "continuity should prefer freshest valid handles"
);

state = tracker.applyInvocationStart(
  state,
  {
    invocation_id: "inv-resume-only",
    agent_type: "architect",
    coordination_label: "how-panel",
    purpose: "continuity-resume-only"
  },
  "2026-04-02T00:00:04.500Z"
);

state = tracker.applyInvocationEnd(
  state,
  "inv-resume-only",
  {
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
);

const latestRegardlessOfRunning = tracker.pickContinuityFromTrackerState(state, {
  agent_type: "architect",
  coordination_label: "how-panel",
  prefer_running: false
});
assert.equal(
  latestRegardlessOfRunning?.resume_task_id,
  "resume-task-newer",
  "prefer_running=false should prefer freshest valid continuity even without child handles"
);
assert.equal(
  latestRegardlessOfRunning?.resume_session_id,
  "resume-ses-newer",
  "prefer_running=false should expose freshest resume session"
);

const resumeOnlyPlan = tracker.buildDelegationPlanFromTracker(state, {
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
  latestRegardlessOfRunning?.resume_handles,
  {
    thread: "thread-123",
    cursor: "cursor-456"
  },
  "resume handles should be captured from runtime metadata"
);

state = tracker.applyInvocationStart(
  state,
  {
    invocation_id: "inv-c",
    agent_type: "architect",
    coordination_label: "how-panel",
    purpose: "continuity-c"
  },
  "2026-04-02T00:00:05.000Z"
);

state = tracker.applyInvocationEnd(
  state,
  "inv-c",
  {
    status: "completed",
    runtime_metadata: {
      task_id: null,
      session_id: null,
      team_name: "how-panel"
    }
  },
  "2026-04-02T00:00:06.000Z"
);

const selectedAfterNull = tracker.pickContinuityFromTrackerState(state, {
  agent_type: "architect",
  coordination_label: "how-panel"
});
assert.equal(
  selectedAfterNull?.resume_task_id,
  "resume-task-newer",
  "partial/null metadata should not erase the freshest previously valid continuity record"
);
assert.equal(
  selectedAfterNull?.resume_session_id,
  "resume-ses-newer",
  "partial/null metadata should not erase the freshest previously valid continuity record"
);

state = tracker.applyInvocationStart(
  state,
  {
    invocation_id: "inv-team-only",
    agent_type: "strategist",
    coordination_label: "label-only",
    team_name: "label-only",
    purpose: "team-only"
  },
  "2026-04-02T00:00:07.000Z"
);

const teamOnlyPlan = tracker.buildDelegationPlanFromTracker(state, {
  agent_type: "strategist",
  coordination_label: "label-only",
  purpose: "team-only"
});
assert.equal(teamOnlyPlan.resume_from, undefined, "team label alone should not imply resumability");
assert.equal(teamOnlyPlan.adapter_hints.resume_task_id, undefined, "team-only plan should not have resume task id");
assert.equal(teamOnlyPlan.adapter_hints.resume_session_id, undefined, "team-only plan should not have resume session id");

let resumeOnlyState = tracker.createEmptyAgentTracker("2026-04-02T00:01:00.000Z");
resumeOnlyState = tracker.applyInvocationStart(
  resumeOnlyState,
  {
    invocation_id: "inv-resume-plan",
    agent_type: "researcher",
    coordination_label: "resume-only",
    purpose: "resume-plan"
  },
  "2026-04-02T00:01:01.000Z"
);
resumeOnlyState = tracker.applyInvocationEnd(
  resumeOnlyState,
  "inv-resume-plan",
  {
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
);

const resumeOnlyAdapterPlan = tracker.buildDelegationPlanFromTracker(resumeOnlyState, {
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

console.log(`e2e agent-tracker core passed (${trackerPath})`);

function pickHandles(continuity) {
  return {
    taskID: continuity?.child_task_id ?? null,
    sessionID: continuity?.child_session_id ?? null
  };
}
