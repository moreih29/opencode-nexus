import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-run-continuity-persist-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const paths = createNexusPaths(root);
await ensureNexusStructure(paths);
await fs.writeFile(
  paths.TASKS_FILE,
  JSON.stringify(
    {
      tasks: [
        {
          id: "task-run-persist-1",
          title: "Run continuity persistence",
          status: "in_progress",
          owner: "engineer",
          plan_issue: 1,
          deps: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
    },
    null,
    2
  ) + "\n",
  "utf8"
);

const args = {
  subagent_type: "engineer",
  team_name: "persist-team",
  description: "Run continuity persistence"
};

const hooksA = createHooks({ directory: root, worktree: root, state: createPluginState() });
const beforeSeed = { args: { ...args } };
await hooksA["tool.execute.before"]({ tool: "task" }, beforeSeed);
assert.equal(beforeSeed.args.resume_task_id, undefined, "seed before should not inject without continuity");

await hooksA["tool.execute.after"](
  { tool: "task", args: beforeSeed.args },
  {
    title: "ok",
    output: "older continuity",
    metadata: {
      task_id: "task-old",
      session_id: "session-old",
      resume_task_id: "resume-task-old",
      resume_session_id: "resume-session-old"
    }
  }
);

const beforeOld = { args: { ...args } };
await hooksA["tool.execute.before"]({ tool: "task" }, beforeOld);
assert.equal(beforeOld.args.resume_task_id, "task-old", "before should use older continuity first");
assert.equal(beforeOld.args.resume_session_id, "session-old", "before should use older continuity first");

await hooksA["tool.execute.after"](
  { tool: "task", args: beforeOld.args },
  {
    title: "ok",
    output: "newer continuity",
    metadata: {
      task: { id: "task-new" },
      session: { session_id: "session-new" },
      resume_task_id: "resume-task-new",
      resume_session_id: "resume-session-new",
      resume_handles: {
        ticket: "ticket-new",
        cursor: "cursor-new"
      }
    }
  }
);

const hooksB = createHooks({ directory: root, worktree: root, state: createPluginState() });
const beforeNew = { args: { ...args } };
await hooksB["tool.execute.before"]({ tool: "task" }, beforeNew);
assert.equal(beforeNew.args.resume_task_id, "task-new", "later before should use newer continuity task handle");
assert.equal(beforeNew.args.resume_session_id, "session-new", "later before should use newer continuity session handle");

const tracker = JSON.parse(await fs.readFile(paths.AGENT_TRACKER_FILE, "utf8"));
const latest = tracker.invocations
  .filter((item) => item.agent_type === "engineer" && item.ended_at)
  .sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at))[0];

assert.equal(latest.continuity.child_task_id, "task-new", "core state should retain newest child task id");
assert.equal(latest.continuity.child_session_id, "session-new", "core state should retain newest child session id");
assert.equal(latest.continuity.resume_task_id, "resume-task-new", "core state should retain newest resume task id");
assert.equal(latest.continuity.resume_session_id, "resume-session-new", "core state should retain newest resume session id");
assert.deepEqual(
  latest.continuity.resume_handles,
  {
    ticket: "ticket-new",
    cursor: "cursor-new"
  },
  "core state should retain newest resume handles"
);

console.log("[inspect:persistence] agent-tracker");
console.log(JSON.stringify(tracker, null, 2));

console.log("e2e run continuity persistence passed");

function parseJsonl(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
