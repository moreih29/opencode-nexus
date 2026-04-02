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
await nxTaskAdd.execute({ title: "Lifecycle task" }, ctx);
const tasksFile = JSON.parse(await fs.readFile(paths.TASKS_FILE, "utf8"));
const id = tasksFile.tasks[0].id;

await nxTaskUpdate.execute({ id, status: "completed" }, ctx);
await nxTaskUpdate.execute({ id, status: "pending" }, ctx);
await nxTaskUpdate.execute({ id, status: "blocked" }, ctx);
await nxTaskUpdate.execute({ id, status: "completed" }, ctx);

await fs.unlink(paths.RUN_FILE).catch(() => {});

const close = JSON.parse(await nxTaskClose.execute({ archive: true }, ctx));
assert.equal(close.memoryHint.hadLoopDetection, true);
assert.equal(close.memoryHint.reopenCount, 1);
assert.equal(close.memoryHint.blockedTransitions, 1);

const history = JSON.parse(await fs.readFile(paths.HISTORY_FILE, "utf8"));
assert.equal(history.cycles.at(-1).memoryHint.reopenCount, 1);
assert.equal(history.cycles.at(-1).memoryHint.blockedTransitions, 1);

console.log("e2e lifecycle passed");
