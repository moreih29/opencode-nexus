import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxMeetStart } from "../dist/tools/meet.js";
import { nxTaskAdd, nxTaskClose, nxTaskUpdate } from "../dist/tools/task.js";

const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-"));
await fs.mkdir(path.join(projectRoot, ".git"), { recursive: true });
await fs.writeFile(path.join(projectRoot, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const paths = createNexusPaths(projectRoot);
await ensureNexusStructure(paths);

const ctx = {
  sessionID: "s1",
  messageID: "m1",
  agent: "build",
  directory: projectRoot,
  worktree: projectRoot,
  abort: new AbortController().signal,
  metadata() {},
  async ask() {}
};

await nxMeetStart.execute(
  {
    topic: "Smoke workflow",
    research_summary: "basic",
    attendees: [{ role: "lead", name: "Lead" }],
    issues: ["Define cycle"]
  },
  ctx
);

const addText = await nxTaskAdd.execute({ title: "Implement", owner: "engineer" }, ctx);
assert.match(addText, /Added task/);

const tasksRaw = JSON.parse(await fs.readFile(paths.TASKS_FILE, "utf8"));
assert.equal(tasksRaw.tasks.length, 1);

await nxTaskUpdate.execute({ id: tasksRaw.tasks[0].id, status: "completed" }, ctx);
const closeRaw = await nxTaskClose.execute({ archive: true }, ctx);
const close = JSON.parse(closeRaw);
assert.equal(close.closed, true);

const history = JSON.parse(await fs.readFile(paths.HISTORY_FILE, "utf8"));
assert.equal(Array.isArray(history.cycles), true);
assert.equal(history.cycles.length, 1);

console.log("e2e smoke passed");
