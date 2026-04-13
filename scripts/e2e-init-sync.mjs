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

const syncResult = JSON.parse(await nxSync.execute({ scope: "all" }, ctx));
assert.equal(syncResult.synced, true);
assert.equal(syncResult.sources.includes("archived cycle history"), true);
assert.equal(syncResult.scannedLayers.includes("codebase"), true);
assert.equal(syncResult.generatedFiles.includes(path.join("state", "auto", "recent-cycle-summary.md")), true);
assert.equal(syncResult.generatedFiles.includes(path.join("state", "auto", "recent-changes.md")), true);
assert.equal(syncResult.generatedFiles.includes(path.join("state", "auto", "decision-log.md")), true);
assert.equal(Array.isArray(syncResult.summary.changedFiles), true);
assert.equal(Array.isArray(syncResult.summary.recentCommits), true);

console.log("e2e init sync passed");
