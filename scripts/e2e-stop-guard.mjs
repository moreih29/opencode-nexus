import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxTaskClose } from "../dist/tools/task.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-stop-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });
const paths = createNexusPaths(root);
await ensureNexusStructure(paths);
await fs.writeFile(
  paths.TASKS_FILE,
  JSON.stringify({ tasks: [{ id: 1, title: "x", status: "pending", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }, null, 2),
  "utf8"
);

const out1 = { parts: [] };
await assert.rejects(
  () => hooks["command.execute.before"]({ command: "exit", sessionID: "s1" }, out1),
  /Exit blocked: active task cycle detected/i
);
assert.equal(out1.parts.length > 0, true);
assert.match(out1.parts[0].text, /Active task cycle detected/i);

const out2 = { parts: [] };
await assert.rejects(
  () => hooks["command.execute.before"]({ command: "exit", sessionID: "s1" }, out2),
  /Exit blocked: active task cycle detected/i
);
assert.equal(out2.parts.length > 0, true);
assert.match(out2.parts[0].text, /Active task cycle detected/i);

await fs.writeFile(
  paths.TASKS_FILE,
  JSON.stringify({ tasks: [{ id: 2, title: "done", status: "completed", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }, null, 2),
  "utf8"
);

const out3 = { parts: [] };
await assert.rejects(
  () => hooks["command.execute.before"]({ command: "exit", sessionID: "s1" }, out3),
  /Exit paused once: completed cycle is still open/i
);
assert.equal(out3.parts.length > 0, true);
assert.match(out3.parts[0].text, /completed-but-not-closed cycle/i);

const out4 = { parts: [] };
await hooks["command.execute.before"]({ command: "exit", sessionID: "s1" }, out4);
assert.equal(out4.parts.length > 0, true);
assert.match(out4.parts[0].text, /completed-but-not-closed cycle/i);

await fs.writeFile(paths.TASKS_FILE, JSON.stringify({ tasks: [] }, null, 2), "utf8");

await assert.rejects(
  () => hooks["tool.execute.before"]({ tool: "nx_task_close", agent: "engineer" }, { args: { archive: true } }),
  /Nexus-lead only/i
);

await hooks["tool.execute.before"]({ tool: "nx_task_close", agent: "nexus" }, { args: { archive: true } });

await assert.rejects(
  () => nxTaskClose.execute({ archive: false }, { directory: root, worktree: root, agent: "engineer" }),
  /Nexus-lead only/i
);

await nxTaskClose.execute({ archive: false }, { directory: root, worktree: root, agent: "nexus" });

console.log("e2e stop guard passed");
