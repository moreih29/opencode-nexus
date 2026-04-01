import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxMeetStart } from "../dist/tools/meet.js";
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
assert.equal(initResult.generatedFiles.includes(path.join("core", "codebase", "architecture.md")), true);
assert.equal(initResult.generatedFiles.includes(path.join("rules", "dev-rules.md")), true);

await nxMeetStart.execute(
  {
    topic: "Init sync",
    research_summary: "repo scan complete",
    attendees: [{ role: "lead", name: "Lead" }],
    issues: ["Carry decisions into sync"]
  },
  ctx
);
await nxTaskAdd.execute({ title: "Implement sync flow", meet_issue: "issue-1" }, ctx);
const tasksFile = JSON.parse(await fs.readFile(paths.TASKS_FILE, "utf8"));
await nxTaskUpdate.execute({ id: tasksFile.tasks[0].id, status: "completed" }, ctx);
await nxTaskClose.execute({ archive: true }, ctx);

const syncResult = JSON.parse(await nxSync.execute({ scope: "all" }, ctx));
assert.equal(syncResult.synced, true);
assert.equal(syncResult.generatedFiles.includes(path.join("core", "memory", "recent-cycle-summary.md")), true);
assert.equal(syncResult.generatedFiles.includes(path.join("core", "codebase", "recent-changes.md")), true);
assert.equal(syncResult.generatedFiles.includes(path.join("core", "reference", "decision-log.md")), true);

console.log("e2e init sync passed");
