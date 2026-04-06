import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxTaskAdd, nxTaskClose, nxTaskUpdate } from "../dist/tools/task.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-lifecycle-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const paths = createNexusPaths(root);
await ensureNexusStructure(paths);

const ctx = { directory: root, worktree: root };
const addResult = JSON.parse(await nxTaskAdd.execute({ title: "Lifecycle task" }, ctx));
assert.equal(addResult.nexus_task_id.startsWith("task-"), true);
assert.equal(addResult.status, "pending");
const id = addResult.nexus_task_id;

let updateResult = JSON.parse(await nxTaskUpdate.execute({ id, status: "completed" }, ctx));
assert.equal(updateResult.nexus_task_id, id);
assert.equal(updateResult.status, "completed");

updateResult = JSON.parse(await nxTaskUpdate.execute({ id, status: "pending" }, ctx));
assert.equal(updateResult.status, "pending");

updateResult = JSON.parse(await nxTaskUpdate.execute({ id, status: "blocked" }, ctx));
assert.equal(updateResult.status, "blocked");

updateResult = JSON.parse(await nxTaskUpdate.execute({ id, status: "completed" }, ctx));
assert.equal(updateResult.status, "completed");

await assert.rejects(
  () => nxTaskUpdate.execute({ id: "ses_regression_wrong_id", status: "in_progress" }, ctx),
  (error) => {
    assert.match(error.message, /opencode session id/i);
    assert.match(error.message, /nx_task_update expects a nexus task id/i);
    return true;
  }
);

const close = JSON.parse(await nxTaskClose.execute({ archive: true }, ctx));
assert.equal(close.memoryHint.hadLoopDetection, true);
assert.equal(close.memoryHint.reopenCount, 1);
assert.equal(close.memoryHint.blockedTransitions, 1);

const history = JSON.parse(await fs.readFile(paths.HISTORY_FILE, "utf8"));
assert.equal(history.cycles.at(-1).memoryHint.reopenCount, 1);
assert.equal(history.cycles.at(-1).memoryHint.blockedTransitions, 1);

await fs.writeFile(paths.TASKS_FILE, JSON.stringify({ tasks: [] }, null, 2), "utf8");
const emptyClose = JSON.parse(await nxTaskClose.execute({ archive: false }, ctx));
assert.equal(emptyClose.closed, true, "empty task cycles should still be closable");

console.log("e2e lifecycle passed");
