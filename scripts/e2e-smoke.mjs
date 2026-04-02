import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxMeetDecide, nxMeetDiscuss, nxMeetJoin, nxMeetStart } from "../dist/tools/meet.js";
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

await nxMeetJoin.execute({ role: "architect", name: "Architect" }, ctx);

await nxMeetDiscuss.execute({ issue_id: "issue-1", speaker: "lead", message: "Collected current constraints.", kind: "research" }, ctx);
await nxMeetDiscuss.execute({ issue_id: "issue-1", speaker: "architect", message: "Prefer canonical-safe sidecars.", kind: "summary" }, ctx);
await nxMeetDiscuss.execute({ issue_id: "issue-1", speaker: "lead", message: "Recommend explicit task linkage.", kind: "summary" }, ctx);
await nxMeetDecide.execute({ issue_id: "issue-1", decision: "Use explicit meet-to-task linkage.", summary: "Link task ids back to the originating issue." }, ctx);

const addText = await nxTaskAdd.execute({ title: "Implement", owner: "engineer", meet_issue: "issue-1" }, ctx);
assert.match(addText, /Added task/);

const tasksRaw = JSON.parse(await fs.readFile(paths.TASKS_FILE, "utf8"));
assert.equal(tasksRaw.tasks.length, 1);

const meetRaw = JSON.parse(await fs.readFile(paths.MEET_FILE, "utf8"));
assert.equal(meetRaw.issues[0].status, "tasked");
assert.equal(Array.isArray(meetRaw.issues[0].discussion), true);
assert.equal(typeof meetRaw.issues[0].discussion[0].speaker, "string");
assert.equal(meetRaw.issues[0].task_refs.includes(tasksRaw.tasks[0].id), true);

const sidecarRaw = JSON.parse(await fs.readFile(paths.MEET_SIDECAR_FILE, "utf8"));
assert.equal(sidecarRaw.handoff.policy, "canonical-first");
assert.equal(sidecarRaw.panel.strategy, "how-fixed-panel");
assert.equal(sidecarRaw.panel.participants.some((item) => item.role === "architect"), true);
assert.equal(sidecarRaw.panel.participants.find((item) => item.role === "architect").last_summary, "Prefer canonical-safe sidecars.");
assert.equal(sidecarRaw.panel.participants.find((item) => item.role === "architect").task_id ?? null, null);

await nxTaskUpdate.execute({ id: tasksRaw.tasks[0].id, status: "completed" }, ctx);
const closeRaw = await nxTaskClose.execute({ archive: true }, ctx);
const close = JSON.parse(closeRaw);
assert.equal(close.closed, true);

const history = JSON.parse(await fs.readFile(paths.HISTORY_FILE, "utf8"));
assert.equal(Array.isArray(history.cycles), true);
assert.equal(history.cycles.length, 1);

const memoryEntries = await fs.readdir(path.join(paths.CORE_ROOT, "memory"));
assert.equal(memoryEntries.some((name) => name.startsWith("cycle-") && name.endsWith(".md")), true);

console.log("e2e smoke passed");
