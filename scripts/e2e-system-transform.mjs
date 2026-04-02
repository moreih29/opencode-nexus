import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-system-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });
const paths = createNexusPaths(root);
await ensureNexusStructure(paths);

const chatOutput = { parts: [{ type: "text", text: "[run] implement changes" }] };
await hooks["chat.message"]({ sessionID: "s1" }, chatOutput);

const systemOut = { system: [] };
await hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, systemOut);

assert.equal(systemOut.system.length > 0, true);
const merged = systemOut.system.join("\n");
assert.match(merged, /Active mode: run/);
assert.match(merged, /TASK PIPELINE/);
assert.match(merged, /Branch Guard/);
assert.match(merged, /DELEGATION PLAYBOOK/);
assert.match(merged, /OUTPUT CONTRACTS/);
assert.match(merged, /PLATFORM MAPPING/);
assert.match(merged, /Detailed role and skill procedures live in AGENTS\.md/);

console.log("e2e system transform passed");
