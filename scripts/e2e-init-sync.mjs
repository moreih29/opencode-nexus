import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxPlanStart } from "../dist/tools/plan.js";
import { nxTaskAdd, nxTaskClose, nxTaskUpdate } from "../dist/tools/task.js";
import { nxInit, nxSync } from "../dist/tools/workflow.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-init-sync-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");
await fs.writeFile(
  path.join(root, "package.json"),
  JSON.stringify({ name: "sample", scripts: { build: "tsc", test: "bun test" }, dependencies: { react: "1.0.0" } }, null, 2),
  "utf8"
);
await fs.writeFile(path.join(root, "README.md"), "# Sample\n", "utf8");
await fs.writeFile(path.join(root, "AGENTS.md"), "# Project Instructions\n", "utf8");
await fs.writeFile(path.join(root, "CLAUDE.md"), "# Legacy Claude Instructions\n", "utf8");
await fs.writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }, null, 2), "utf8");

const paths = createNexusPaths(root);
await ensureNexusStructure(paths);
await fs.writeFile(
  paths.AGENT_TRACKER_FILE,
  JSON.stringify(
    {
      harness_id: "opencode-nexus",
      started_at: "2000-01-01T00:00:00.000Z",
      invocations: [
        {
          invocation_id: "keep-me",
          agent_type: "engineer",
          status: "completed",
          started_at: "2000-01-01T00:00:00.000Z",
          ended_at: "2000-01-01T00:00:01.000Z"
        }
      ]
    },
    null,
    2
  ) + "\n",
  "utf8"
);
await fs.writeFile(paths.TOOL_LOG_FILE, '{"ts":"2000-01-01T00:00:00.000Z","agent_id":"keep-me","tool":"apply_patch","file":"src/x.ts"}\n', "utf8");

const ctx = {
  directory: root,
  worktree: root,
  sessionID: "s1",
  messageID: "m1",
  agent: "build",
  abort: new AbortController().signal,
  metadata() {},
  async ask() {}
};

const initResult = JSON.parse(
  await nxInit.execute(
    {
      mission: "Ship a practical Nexus migration for OpenCode.",
      design: "Keep orchestration state in .nexus and expose workflows via plugin tools.",
      roadmap: "Close parity gaps in hooks, workflows, and code intelligence.",
      setup_rules: true
    },
    ctx
  )
);
assert.equal(initResult.generatedFiles.includes(path.join("context", "architecture.md")), true);
assert.equal(initResult.generatedFiles.includes(path.join("rules", "dev-rules.md")), true);
assert.equal(initResult.primaryDocs.includes("AGENTS.md"), true);
assert.equal(initResult.legacyDocs.includes("CLAUDE.md"), true);
assert.equal(initResult.legacyInputsUsed.includes("CLAUDE.md"), true);
assert.equal(initResult.identityNeedsConfirmation, false);
assert.equal(initResult.instructionFiles.primary, "AGENTS.md");
assert.equal(initResult.instructionFiles.legacy, "CLAUDE.md");

await nxPlanStart.execute(
  {
    topic: "Init sync",
    research_summary: "repo scan complete",
    attendees: [{ role: "lead", name: "Lead" }],
    issues: ["Carry decisions into sync"]
  },
  ctx
);
await nxTaskAdd.execute({ title: "Implement sync flow", plan_issue: 1 }, ctx);
const tasksFile = JSON.parse(await fs.readFile(paths.TASKS_FILE, "utf8"));
await nxTaskUpdate.execute({ id: tasksFile.tasks[0].id, status: "completed" }, ctx);
await nxTaskClose.execute({ archive: true }, ctx);

const syncMessage = await nxSync.execute({}, ctx);
assert.equal(typeof syncMessage, "string");
assert.ok(syncMessage.length > 0, "nxSync should return a non-empty guidance message");

const tracker = JSON.parse(await fs.readFile(paths.AGENT_TRACKER_FILE, "utf8"));
assert.equal(tracker.started_at, "2000-01-01T00:00:00.000Z", "nxInit/nxSync should preserve existing tracker metadata");
assert.equal(tracker.invocations.length, 1, "nxInit/nxSync should preserve existing tracker invocations");
assert.equal(tracker.invocations[0].invocation_id, "keep-me", "nxInit/nxSync should not wipe tracker entries");

const toolLog = await fs.readFile(paths.TOOL_LOG_FILE, "utf8");
assert.match(toolLog, /keep-me/, "nxInit/nxSync should preserve existing tool-log content");

// Verify ensureNexusStructure was called: core nexus dirs must exist
const { access } = await import("node:fs/promises");
await access(path.join(root, ".nexus", "context"));
await access(path.join(root, ".nexus", "memory"));
await access(path.join(root, ".nexus", "state"));

console.log("e2e init sync passed");
