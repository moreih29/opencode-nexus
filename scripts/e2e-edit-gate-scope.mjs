import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/create-hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-edit-gate-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });
const paths = createNexusPaths(root);
await hooks.event({ event: { type: "session.created", sessionID: "ses-lead-1" } });

async function attemptEdit(label) {
  const output = { args: { filePath: path.join(root, "src", `${label}.ts`) } };
  try {
    await hooks["tool.execute.before"]({ tool: "write", sessionID: "ses-lead-1" }, output);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function writeTasks(tasks) {
  await fs.mkdir(path.dirname(paths.TASKS_FILE), { recursive: true });
  await fs.writeFile(paths.TASKS_FILE, JSON.stringify({ tasks }, null, 2), "utf8");
}

await fs.rm(paths.TASKS_FILE, { force: true });
const noTasks = await attemptEdit("no-tasks");
console.log("no tasks file:", noTasks);

await writeTasks([]);
const emptyTasks = await attemptEdit("empty-tasks");
console.log("empty tasks file:", emptyTasks);

await writeTasks([
  { id: 1, title: "active", status: "pending", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
]);
const activeCycle = await attemptEdit("active-cycle");
console.log("active cycle:", activeCycle);

await writeTasks([
  { id: 2, title: "done", status: "completed", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
]);
const completedOpen = await attemptEdit("completed-open");
console.log("completed-open cycle:", completedOpen);

assert.equal(noTasks.ok, true, "no tasks file should not block edits outside a run cycle");
assert.equal(noTasks.error, null, "no tasks file should not return a gate error");

assert.equal(emptyTasks.ok, true, "empty task file is allowed");
assert.equal(activeCycle.ok, true, "active task cycle is allowed");

assert.equal(completedOpen.ok, false, "completed-open cycle blocks further edits");
assert.match(completedOpen.error ?? "", /All tasks are completed/i);

console.log("evidence summary:");
console.log("- no tasks file allows free edits outside an explicit run cycle");
console.log("- empty tasks file allows edits");
console.log("- active task cycle allows edits");
console.log("- completed-open cycle blocks edits");
console.log("e2e edit-gate-scope passed");
