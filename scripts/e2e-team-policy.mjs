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

await hooks["tool.execute.before"]({ tool: "task" }, { args: { subagent_type: "engineer", description: "no caller" } });

await hooks["tool.execute.before"](
  { tool: "task", sessionID: "ses-unknown" },
  { args: { subagent_type: "engineer", description: "unknown session" } }
);

await hooks["tool.execute.before"](
  { tool: "task", agent: "nexus" },
  { args: { subagent_type: "engineer", description: "do work" } }
);

await assert.rejects(
  () => hooks["tool.execute.before"]({ tool: "task", agent: "engineer" }, { args: { subagent_type: "engineer", description: "do work" } }),
  /recursion is blocked|not allowed/i
);

await assert.rejects(
  () => hooks["tool.execute.before"]({ tool: "task", agent: "general" }, { args: { subagent_type: "engineer", description: "general recurse" } }),
  /recursion is blocked|not allowed/i
);

await assert.rejects(
  () => hooks["tool.execute.before"]({ tool: "task", agent: "explore" }, { args: { subagent_type: "engineer", description: "explore recurse" } }),
  /recursion is blocked|not allowed/i
);

await hooks["tool.execute.before"](
  { tool: "task", sessionID: "ses-lead-1", agent: "nexus" },
  { args: { subagent_type: "engineer", description: "seed child session" } }
);
await hooks["tool.execute.after"](
  {
    tool: "task",
    args: { subagent_type: "engineer", description: "seed child session" },
    sessionID: "ses-lead-1"
  },
  {
    title: "ok",
    output: "done",
    metadata: { sessionID: "ses-eng-1" }
  }
);

await assert.rejects(
  () => hooks["tool.execute.before"]({ tool: "task", sessionID: "ses-eng-1" }, { args: { subagent_type: "engineer", description: "nested task" } }),
  /recursion is blocked|not allowed/i
);

await hooks["tool.execute.before"](
  { tool: "task", agent: "nexus" },
  { args: { subagent_type: "engineer", team_name: "impl-team", description: "do work" } }
);

await hooks["tool.execute.before"](
  { tool: "task", agent: "nexus" },
  {
    args: {
      subagent_type: "engineer",
      description: "do work",
      command: "[run] Engineer work team_name:impl-team"
    }
  }
);

console.log("e2e team policy passed");
