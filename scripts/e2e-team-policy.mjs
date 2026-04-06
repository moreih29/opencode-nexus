import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-team-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });
const paths = createNexusPaths(root);
await ensureNexusStructure(paths);
await fs.writeFile(paths.TASKS_FILE, JSON.stringify({ tasks: [] }, null, 2), "utf8");

let blocked = false;
let blockedMessage = "";
try {
  await hooks["tool.execute.before"](
    { tool: "task" },
    { args: { subagent_type: "engineer", description: "do work" } }
  );
} catch (error) {
  blocked = true;
  blockedMessage = String(error);
}
assert.equal(blocked, true);
assert.match(blockedMessage, /coordination label/i);

await hooks["tool.execute.before"](
  { tool: "task" },
  { args: { subagent_type: "engineer", team_name: "impl-team", description: "do work" } }
);

await hooks["tool.execute.before"](
  { tool: "task" },
  {
    args: {
      subagent_type: "engineer",
      description: "do work",
      command: "[run] Engineer work team_name:impl-team"
    }
  }
);

console.log("e2e team policy passed");
