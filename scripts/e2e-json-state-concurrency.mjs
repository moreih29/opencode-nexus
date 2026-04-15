import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { registerInvocationEnd, registerInvocationStart, readAgentTracker } from "../dist/shared/agent-tracker.js";
import { appendHistory } from "../dist/shared/history.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { appendToolLogEntry, readToolLog, resetToolLog } from "../dist/shared/tool-log.js";
import { nxPlanDecide, nxPlanStart, nxPlanUpdate } from "../dist/tools/plan.js";
import { nxTaskAdd } from "../dist/tools/task.js";

function isoFor(index) {
  const second = String(index % 60).padStart(2, "0");
  return `2026-04-15T00:00:${second}.000Z`;
}

async function makeRoot(suffix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `opencode-nexus-concurrency-${suffix}-`));
  await fs.mkdir(path.join(root, ".git"), { recursive: true });
  await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");
  return root;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

let passCount = 0;
function pass(label) {
  console.log(`  PASS: ${label}`);
  passCount += 1;
}

// Case 1: agent-tracker concurrent start/end updates keep all invocations.
{
  const root = await makeRoot("tracker");
  const trackerPath = path.join(root, "tracker.json");
  const count = 24;

  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      registerInvocationStart(trackerPath, {
        invocation_id: `inv-${i}`,
        agent_type: "architect",
        coordination_label: "panel",
        purpose: `run-${i}`
      })
    )
  );

  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      registerInvocationEnd(trackerPath, `inv-${i}`, {
        status: "completed",
        runtime_metadata: {
          task_id: `task-${i}`,
          session_id: `ses-${i}`
        }
      })
    )
  );

  const tracker = await readAgentTracker(trackerPath);
  assert.equal(tracker.invocations.length, count, "all concurrent tracker updates must persist");
  const completed = tracker.invocations.filter((inv) => inv.status === "completed").length;
  assert.equal(completed, count, "all invocations must reach completed status");
  pass("agent-tracker concurrent start/end does not lose entries");
}

// Case 2: history append concurrency preserves every cycle.
{
  const root = await makeRoot("history");
  const historyPath = path.join(root, "history.json");
  const count = 20;

  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      appendHistory(historyPath, {
        completed_at: isoFor(i),
        branch: `b-${i}`,
        plan: { id: i + 1 }
      })
    )
  );

  const history = await readJson(historyPath);
  assert.equal(history.cycles.length, count, "all concurrent history appends must persist");
  pass("history append keeps all concurrent entries");
}

// Case 3: task and plan concurrent mutations on the same file keep all rows.
{
  const root = await makeRoot("tools");
  const ctx = { directory: root, worktree: root };
  const paths = createNexusPaths(root);
  await ensureNexusStructure(paths);

  const taskCount = 18;
  await Promise.all(
    Array.from({ length: taskCount }, (_, i) =>
      nxTaskAdd.execute(
        {
          title: `task-${i}`,
          context: `concurrency task ${i}`
        },
        ctx
      )
    )
  );

  const tasksFile = await readJson(paths.TASKS_FILE);
  assert.equal(tasksFile.tasks.length, taskCount, "all concurrent task additions must persist");
  const taskIds = new Set(tasksFile.tasks.map((task) => task.id));
  assert.equal(taskIds.size, taskCount, "task IDs must remain unique under concurrency");
  pass("nxTaskAdd concurrent writes do not lose tasks or duplicate IDs");

  await nxPlanStart.execute(
    {
      topic: "Concurrency plan",
      research_summary: "Verifying same-file plan mutation locking.",
      issues: []
    },
    ctx
  );

  const issueCount = 14;
  await Promise.all(
    Array.from({ length: issueCount }, (_, i) =>
      nxPlanUpdate.execute(
        {
          action: "add",
          title: `issue-${i}`
        },
        ctx
      )
    )
  );

  const withIssues = await readJson(paths.PLAN_FILE);
  assert.equal(withIssues.issues.length, issueCount, "all concurrent plan issue adds must persist");

  await Promise.all(
    withIssues.issues.map((issue) =>
      nxPlanDecide.execute(
        {
          issue_id: issue.id,
          decision: `decision-${issue.id}`
        },
        ctx
      )
    )
  );

  const decidedPlan = await readJson(paths.PLAN_FILE);
  const decidedCount = decidedPlan.issues.filter((issue) => issue.status === "decided").length;
  assert.equal(decidedCount, issueCount, "all concurrent plan decisions must persist");
  pass("nxPlanUpdate/nxPlanDecide concurrent writes do not lose decisions");
}

// Case 4: tool-log append/reset serialization keeps deterministic same-file ordering.
{
  const root = await makeRoot("tool-log");
  const toolLogPath = path.join(root, "tool-log.jsonl");
  const count = 64;

  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      appendToolLogEntry(toolLogPath, {
        ts: isoFor(i),
        agent_id: `agent-${i}`,
        session_id: `session-${i}`,
        tool: "read",
        file: `file-${i}.ts`
      })
    )
  );

  const entries = await readToolLog(toolLogPath);
  assert.equal(entries.length, count, "all concurrent tool-log appends must persist");
  const files = new Set(entries.map((entry) => entry.file));
  assert.equal(files.size, count, "tool-log entries must remain unique under concurrency");
  pass("tool-log append keeps all concurrent entries");

  await Promise.all([
    appendToolLogEntry(toolLogPath, {
      ts: isoFor(70),
      agent_id: "agent-before-reset",
      tool: "read",
      file: "before-reset.ts"
    }),
    resetToolLog(toolLogPath),
    appendToolLogEntry(toolLogPath, {
      ts: isoFor(71),
      agent_id: "agent-after-reset",
      tool: "read",
      file: "after-reset.ts"
    })
  ]);

  const afterReset = await readToolLog(toolLogPath);
  assert.deepEqual(
    afterReset.map((entry) => entry.file),
    ["after-reset.ts"],
    "append/reset/append ordering must be serialized per file"
  );
  pass("tool-log reset serializes with appends on same file");
}

console.log(`e2e json-state concurrency passed (${passCount} assertions)`);
