import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-stop-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });
const paths = createNexusPaths(root);
await ensureNexusStructure(paths);
await fs.writeFile(
  paths.TASKS_FILE,
  JSON.stringify({ tasks: [{ id: "t1", title: "x", status: "pending", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }, null, 2),
  "utf8"
);

const out1 = { parts: [] };
await hooks["command.execute.before"]({ command: "exit", sessionID: "s1" }, out1);
assert.equal(out1.parts.length > 0, true);

const out2 = { parts: [] };
await hooks["command.execute.before"]({ command: "exit", sessionID: "s1" }, out2);
assert.equal(out2.parts.length > 0, true);

console.log("e2e stop guard passed");
