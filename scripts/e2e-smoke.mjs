import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxPlanDecide, nxPlanStart } from "../dist/tools/plan.js";
import { nxTaskAdd, nxTaskClose, nxTaskUpdate } from "../dist/tools/task.js";

let passCount = 0;
function pass(label) {
  console.log(`  PASS: ${label}`);
  passCount += 1;
}

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

// Start plan — no attendees field in new API
const startResult = JSON.parse(
  await nxPlanStart.execute(
    {
      topic: "Smoke workflow",
      research_summary: "basic",
      issues: ["Define cycle"]
    },
    ctx
  )
);
assert.equal(startResult.created, true, "plan start: created should be true");
assert.equal(startResult.issueCount, 1, "plan start: issueCount should be 1");
pass("nxPlanStart creates plan with 1 issue");

// plan.json canonical fields — no attendees in new writes
const planRaw = JSON.parse(await fs.readFile(paths.PLAN_FILE, "utf8"));
assert.equal(typeof planRaw.id, "number", "plan.json: id is a number");
assert.equal(planRaw.topic, "Smoke workflow", "plan.json: topic correct");
assert.equal(Array.isArray(planRaw.issues), true, "plan.json: issues is array");
assert.equal(planRaw.issues.length, 1, "plan.json: issues length is 1");
assert.equal(planRaw.issues[0].status, "pending", "plan.json: issue default status is pending");
assert.equal(Object.hasOwn(planRaw, "attendees"), false, "plan.json: no attendees field in new write");
pass("plan.json has canonical fields and no attendees");

// Decide with how_agent_ids — architect registered as HOW panel participant
const decideResult = JSON.parse(
  await nxPlanDecide.execute(
    {
      issue_id: 1,
      decision: "Use explicit plan-to-task linkage.",
      how_agent_ids: { architect: "ses_arch_001" }
    },
    ctx
  )
);
assert.equal(decideResult.decided, true, "nxPlanDecide: decided should be true");
pass("nxPlanDecide registers decision with how_agent_ids");

const legacySidecarPath = path.join(projectRoot, ".nexus", "state", "opencode-nexus", "plan.extension.json");
await assert.rejects(
  fs.access(legacySidecarPath),
  { code: "ENOENT" },
  "legacy plan.extension.json sidecar must not be written"
);
pass("runtime does not create legacy plan.extension.json sidecar");

// Issue status is 'decided' — 'tasked' is a removed legacy status
const planAfterDecide = JSON.parse(await fs.readFile(paths.PLAN_FILE, "utf8"));
assert.equal(planAfterDecide.issues[0].status, "decided", "plan.json: issue status is decided");
pass("plan.json issue status transitions to decided (not tasked)");

// Add task linked to plan issue
const addText = JSON.parse(await nxTaskAdd.execute({ title: "Implement", context: "Implement the agreed plan", owner: "engineer", plan_issue: 1 }, ctx));
assert.match(addText.message, /Added task/);
assert.equal(typeof addText.task.id, "number");
pass("nxTaskAdd adds task with plan_issue link");

const tasksRaw = JSON.parse(await fs.readFile(paths.TASKS_FILE, "utf8"));
assert.equal(tasksRaw.tasks.length, 1, "tasks file: 1 task");
pass("tasks file has 1 task");

// Close cycle and archive to history
await nxTaskUpdate.execute({ id: tasksRaw.tasks[0].id, status: "completed" }, ctx);
const closeRaw = await nxTaskClose.execute({}, { ...ctx, agent: "nexus" });
const close = JSON.parse(closeRaw);
assert.equal(close.closed, true, "nxTaskClose: closed should be true");
pass("nxTaskClose closes the cycle");

const history = JSON.parse(await fs.readFile(paths.HISTORY_FILE, "utf8"));
assert.equal(Array.isArray(history.cycles), true, "history: cycles is array");
assert.equal(history.cycles.length, 1, "history: 1 cycle archived");
pass("history archives 1 completed cycle");

console.log(`e2e smoke passed (${passCount} assertions)`);
