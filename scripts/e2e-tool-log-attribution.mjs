import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/create-hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-tool-log-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const paths = createNexusPaths(root);
const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });

async function readTracker() {
  return JSON.parse(await fs.readFile(paths.AGENT_TRACKER_FILE, "utf8"));
}

async function readToolLogLines() {
  try {
    const raw = await fs.readFile(paths.TOOL_LOG_FILE, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

await hooks.event({ event: { type: "session.created", sessionID: "ses-lead-1" } });

const taskArgs = { subagent_type: "engineer", description: "tool-log attribution test" };
const beforeOutput = { args: { ...taskArgs } };

console.log("[experiment] start task invocation");
await hooks["tool.execute.before"](
  { tool: "task", sessionID: "ses-lead-1" },
  beforeOutput
);

console.log("[experiment] child edit before task completion");
await hooks["tool.execute.after"](
  {
    tool: "apply_patch",
    args: {
      patchText: `*** Begin Patch
*** Add File: src/before-end.ts
+export const before = true;
*** End Patch`
    },
    sessionID: "ses-child-1"
  },
  { title: "apply_patch", output: "ok", metadata: {} }
);

let toolLog = await readToolLogLines();
console.log("tool-log after pre-end edit:", toolLog);
assert.equal(toolLog.length, 1, "child edit should be recorded by session even before task completion");
assert.equal(toolLog[0]?.session_id, "ses-child-1", "tool-log entry should carry child session id");

console.log("[experiment] complete task invocation");
await hooks["tool.execute.after"](
  {
    tool: "task",
    args: beforeOutput.args,
    sessionID: "ses-lead-1"
  },
  {
    title: "task",
    output: "done",
    metadata: { task_id: "task-child-1", session_id: "ses-child-1" }
  }
);

let tracker = await readTracker();
console.log("tracker after task completion:", tracker.invocations);
assert.deepEqual(
  tracker.invocations[0]?.files_touched ?? [],
  [path.join(root, "src", "before-end.ts")],
  "task completion should retroactively join session-scoped edits into files_touched"
);

console.log("[experiment] child edit after task completion");
await hooks["tool.execute.after"](
  {
    tool: "apply_patch",
    args: {
      patchText: `*** Begin Patch
*** Add File: src/after-end.ts
+export const after = true;
*** End Patch`
    },
    sessionID: "ses-child-1"
  },
  { title: "apply_patch", output: "ok", metadata: {} }
);

toolLog = await readToolLogLines();
console.log("tool-log after post-end edit:", toolLog);
assert.equal(toolLog.length, 2, "post-end child edit should also be recorded by session");

tracker = await readTracker();
console.log("final tracker:", tracker.invocations);
assert.deepEqual(
  tracker.invocations[0]?.files_touched ?? [],
  [path.join(root, "src", "before-end.ts"), path.join(root, "src", "after-end.ts")],
  "session-scoped join should deterministically keep files_touched in sync"
);

console.log("evidence summary:");
console.log("- child edits are logged by session regardless of task completion order");
console.log("- task completion retroactively joins prior session edits into files_touched");
console.log("- later child edits update files_touched deterministically via session-scoped join");
console.log("e2e tool-log-attribution passed");
