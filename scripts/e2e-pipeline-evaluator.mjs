import assert from "node:assert/strict";

const scenarios = [
  {
    name: "no tasks file / no cycle",
    snapshot: {
      hasTasksFile: false,
      hasTaskCycle: false,
      tasks: [],
      qaTriggerReasons: []
    },
    expected: {
      taskCycleState: "none",
      editsAllowed: false,
      canCloseCycle: false,
      shouldTriggerQa: false,
      nextGuidanceKey: "task_cycle_required"
    }
  },
  {
    name: "empty tasks array",
    snapshot: {
      hasTasksFile: true,
      hasTaskCycle: true,
      tasks: [],
      qaTriggerReasons: []
    },
    expected: {
      taskCycleState: "empty",
      editsAllowed: true,
      canCloseCycle: false,
      shouldTriggerQa: false,
      nextGuidanceKey: "add_first_task"
    }
  },
  {
    name: "active cycle: pending",
    snapshot: {
      hasTasksFile: true,
      hasTaskCycle: true,
      tasks: [{ id: "t-pending", status: "pending" }],
      qaTriggerReasons: []
    },
    expected: {
      taskCycleState: "active",
      editsAllowed: true,
      canCloseCycle: false,
      shouldTriggerQa: false,
      nextGuidanceKey: "resume_active_cycle"
    }
  },
  {
    name: "active cycle: in_progress",
    snapshot: {
      hasTasksFile: true,
      hasTaskCycle: true,
      tasks: [{ id: "t-progress", status: "in_progress" }],
      qaTriggerReasons: []
    },
    expected: {
      taskCycleState: "active",
      editsAllowed: true,
      canCloseCycle: false,
      shouldTriggerQa: false,
      nextGuidanceKey: "resume_active_cycle"
    }
  },
  {
    name: "active cycle: blocked",
    snapshot: {
      hasTasksFile: true,
      hasTaskCycle: true,
      tasks: [{ id: "t-blocked", status: "blocked" }],
      qaTriggerReasons: []
    },
    expected: {
      taskCycleState: "active",
      editsAllowed: true,
      canCloseCycle: false,
      shouldTriggerQa: false,
      nextGuidanceKey: "resolve_blocked_tasks"
    }
  },
  {
    name: "completed-open cycle",
    snapshot: {
      hasTasksFile: true,
      hasTaskCycle: true,
      tasks: [{ id: "t-done", status: "completed" }],
      qaTriggerReasons: []
    },
    expected: {
      taskCycleState: "completed-open",
      editsAllowed: false,
      canCloseCycle: true,
      shouldTriggerQa: false,
      nextGuidanceKey: "close_cycle"
    }
  },
  {
    name: "QA-triggered completed-open cycle",
    snapshot: {
      hasTasksFile: true,
      hasTaskCycle: true,
      tasks: [{ id: "t-done-qa", status: "completed" }],
      qaTriggerReasons: ["changed_files>=3"]
    },
    expected: {
      taskCycleState: "completed-open",
      editsAllowed: false,
      canCloseCycle: true,
      shouldTriggerQa: true,
      nextGuidanceKey: "spawn_qa_then_close"
    }
  }
];

let evaluatePipelineSnapshot;
try {
  ({ evaluatePipelineSnapshot } = await import("../dist/pipeline/evaluator.js"));
} catch (error) {
  throw new Error(
    "Missing evaluator contract at dist/pipeline/evaluator.js. Implement evaluatePipelineSnapshot(snapshot).",
    { cause: error }
  );
}

assert.equal(typeof evaluatePipelineSnapshot, "function", "evaluatePipelineSnapshot must be a function");

for (const scenario of scenarios) {
  const actual = evaluatePipelineSnapshot(scenario.snapshot);
  const normalized = {
    taskCycleState: actual.taskCycleState,
    editsAllowed: actual.editsAllowed,
    canCloseCycle: actual.canCloseCycle,
    shouldTriggerQa: actual.shouldTriggerQa,
    nextGuidanceKey: actual.nextGuidanceKey
  };

  assert.deepEqual(normalized, scenario.expected, `scenario failed: ${scenario.name}`);
}

console.log("e2e pipeline evaluator passed");
