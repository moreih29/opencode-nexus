import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/create-hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-tracker-reset-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const paths = createNexusPaths(root);
const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });

function summarizeInvocations(tracker) {
  return tracker.invocations.map((inv) => ({
    invocation_id: inv.invocation_id,
    agent_type: inv.agent_type,
    status: inv.status,
    child_session_id: inv.continuity?.child_session_id ?? null,
    files_touched: inv.files_touched ?? []
  }));
}

async function readTracker() {
  return JSON.parse(await fs.readFile(paths.AGENT_TRACKER_FILE, "utf8"));
}

async function readToolLog() {
  try {
    return (await fs.readFile(paths.TOOL_LOG_FILE, "utf8")).trim();
  } catch {
    return "";
  }
}

console.log("[experiment] initialize session");
await hooks.event({ event: { type: "session.created", sessionID: "ses-lead-1" } });

let tracker = await readTracker();
console.log("after lead session.created:", summarizeInvocations(tracker));
assert.equal(tracker.invocations.length, 0, "fresh session should start with empty tracker");

const taskArgs = { subagent_type: "engineer", description: "diagnostic child" };
const beforeOutput = { args: { ...taskArgs } };

console.log("[experiment] register subagent invocation");
await hooks["tool.execute.before"](
  { tool: "task", sessionID: "ses-lead-1" },
  beforeOutput
);

tracker = await readTracker();
console.log("after task before:", summarizeInvocations(tracker));
assert.equal(tracker.invocations.length, 1, "task start should append one invocation");
assert.equal(tracker.invocations[0]?.status, "running", "task start should mark invocation running");

console.log("[experiment] child session.created must not reset tracker");
await hooks.event({ event: { type: "session.created", sessionID: "ses-child-1", parent_session_id: "ses-lead-1" } });

tracker = await readTracker();
console.log("after child session.created:", summarizeInvocations(tracker));
assert.equal(
  tracker.invocations.length,
  1,
  "child session.created should keep in-flight invocation instead of clearing tracker"
);

console.log("[experiment] simulate child file edit before task completion");
await hooks["tool.execute.after"](
  {
    tool: "write",
    args: { filePath: path.join(root, "src", "feature.ts") },
    sessionID: "ses-child-1"
  },
  { title: "write", output: "ok", metadata: {} }
);

const toolLogBeforeEnd = await readToolLog();
console.log("tool-log before task end:", toolLogBeforeEnd || "<empty>");

console.log("[experiment] complete subagent invocation");
await hooks["tool.execute.after"](
  {
    tool: "task",
    args: beforeOutput.args,
    sessionID: "ses-lead-1"
  },
  {
    title: "task",
    output: "subagent finished",
    metadata: { task_id: "task-child-1", session_id: "ses-child-1" }
  }
);

tracker = await readTracker();
console.log("after task end:", summarizeInvocations(tracker));
assert.equal(tracker.invocations.length, 1, "task completion should preserve tracker entry");
assert.equal(tracker.invocations[0]?.status, "completed", "task completion should mark invocation completed");
assert.equal(
  tracker.invocations[0]?.continuity?.child_session_id,
  "ses-child-1",
  "task completion should capture child session continuity"
);

console.log("[experiment] trigger another primary session.created with different session id");
await hooks.event({ event: { type: "session.created", sessionID: "ses-lead-2" } });

tracker = await readTracker();
console.log("after second primary session.created:", summarizeInvocations(tracker));
assert.equal(
  tracker.invocations.length,
  0,
  "primary session.created should still reset the tracker"
);

console.log("[experiment] validate schema-fallback does not explain empty tracker");
await fs.writeFile(paths.AGENT_TRACKER_FILE, JSON.stringify({ unexpected: true }, null, 2), "utf8");
const invalidBeforeOutput = { args: { subagent_type: "architect", description: "fallback write" } };
await hooks["tool.execute.before"](
  { tool: "task", sessionID: "ses-lead-2" },
  invalidBeforeOutput
);

tracker = await readTracker();
console.log("after schema-invalid tracker + task before:", summarizeInvocations(tracker));
assert.equal(
  tracker.invocations.length,
  1,
  "schema/parse fallback followed by task start recreates a running invocation instead of writing an empty array"
);

console.log("evidence summary:");
console.log("- child session.created does not reset tracker");
console.log("- primary session.created still resets tracker");
console.log("- subagent task lifecycle writes tracker entries as expected");
console.log("- parse fallback alone does not yield an empty tracker after a task write path");
console.log("e2e agent-tracker-reset passed");
