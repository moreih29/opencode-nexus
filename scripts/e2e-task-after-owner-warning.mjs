import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-owner-warning-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });
const paths = createNexusPaths(root);
await hooks.event({ event: { type: "session.created", sessionID: "ses-lead-1" } });

async function writeTasks(tasks) {
  await fs.mkdir(path.dirname(paths.TASKS_FILE), { recursive: true });
  await fs.writeFile(paths.TASKS_FILE, JSON.stringify({ tasks }, null, 2), "utf8");
}

await writeTasks([
  {
    id: 1,
    title: "Engineer pending",
    status: "pending",
    owner: "engineer",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 2,
    title: "Engineer in progress",
    status: "in_progress",
    owner_agent_id: "engineer",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 3,
    title: "Writer pending",
    status: "pending",
    owner: "writer",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
]);

const taskArgs = { subagent_type: "engineer", description: "owner warning test" };
const beforeOutput = { args: { ...taskArgs } };
await hooks["tool.execute.before"]({ tool: "task", sessionID: "ses-lead-1" }, beforeOutput);

const withIncomplete = {
  title: "task",
  output: "engineer completed reply",
  metadata: { task_id: "task-child-1", session_id: "ses-child-1" }
};
await hooks["tool.execute.after"]({ tool: "task", args: beforeOutput.args, sessionID: "ses-lead-1" }, withIncomplete);

assert.match(withIncomplete.output, /Escalation/i, "should append escalation when owner tasks remain incomplete");
assert.match(withIncomplete.output, /#1/, "should include pending owner task id");
assert.match(withIncomplete.output, /#2/, "should include in-progress owner task id");
assert.doesNotMatch(withIncomplete.output, /#3/, "should not include tasks owned by other agents");

await writeTasks([
  {
    id: 1,
    title: "Engineer pending",
    status: "completed",
    owner: "engineer",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 2,
    title: "Engineer in progress",
    status: "completed",
    owner_agent_id: "engineer",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
]);

const beforeOutput2 = { args: { ...taskArgs } };
await hooks["tool.execute.before"]({ tool: "task", sessionID: "ses-lead-1" }, beforeOutput2);

const withoutIncomplete = {
  title: "task",
  output: "engineer completed reply",
  metadata: { task_id: "task-child-2", session_id: "ses-child-2" }
};
await hooks["tool.execute.after"]({ tool: "task", args: beforeOutput2.args, sessionID: "ses-lead-1" }, withoutIncomplete);

assert.doesNotMatch(withoutIncomplete.output, /Escalation/i, "should not warn when owner tasks are complete");

console.log("e2e task-after owner warning passed");
