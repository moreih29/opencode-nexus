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
assert.equal(typeof addResult.task.id, "number");
assert.equal(addResult.task.status, "pending");
const id = addResult.task.id;

let updateResult = JSON.parse(await nxTaskUpdate.execute({ id, status: "completed" }, ctx));
assert.equal(updateResult.task.id, id);
assert.equal(updateResult.task.status, "completed");

updateResult = JSON.parse(await nxTaskUpdate.execute({ id, status: "pending" }, ctx));
assert.equal(updateResult.task.status, "pending");

updateResult = JSON.parse(await nxTaskUpdate.execute({ id, status: "blocked" }, ctx));
assert.equal(updateResult.task.status, "blocked");

updateResult = JSON.parse(await nxTaskUpdate.execute({ id, status: "completed" }, ctx));
assert.equal(updateResult.task.status, "completed");

await assert.rejects(
  () => nxTaskUpdate.execute({ id: 999, status: "in_progress" }, ctx),
  (error) => {
    assert.match(error.message, /not found/i);
    return true;
  }
);

const close = JSON.parse(await nxTaskClose.execute({ archive: true }, ctx));
assert.equal(close.closed, true);
assert.equal(typeof close.memoryHint.taskCount, "number");

const history = JSON.parse(await fs.readFile(paths.HISTORY_FILE, "utf8"));
assert.equal(history.cycles.at(-1).memoryHint.taskCount, 1);

await fs.writeFile(paths.TASKS_FILE, JSON.stringify({ tasks: [] }, null, 2), "utf8");
const emptyClose = JSON.parse(await nxTaskClose.execute({ archive: false }, ctx));
assert.equal(emptyClose.closed, true, "empty task cycles should still be closable");

console.log("e2e lifecycle passed");
