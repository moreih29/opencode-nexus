import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-session-cleanup-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });
const paths = createNexusPaths(root);
await ensureNexusStructure(paths);

await hooks.event({ event: { type: "session.created", sessionID: "ses-cleanup-1" } });
await fs.writeFile(paths.TOOL_LOG_FILE, '{"tool":"write"}\n', "utf8");
await fs.writeFile(path.join(paths.ARTIFACTS_ROOT, "keep.md"), "artifact\n", "utf8");

await hooks.event({ event: { type: "session.deleted", properties: { sessionID: "ses-cleanup-1" } } });

await assert.rejects(() => fs.access(paths.AGENT_TRACKER_FILE), { code: "ENOENT" });
await assert.rejects(() => fs.access(paths.TOOL_LOG_FILE), { code: "ENOENT" });
await fs.access(path.join(paths.ARTIFACTS_ROOT, "keep.md"));

console.log("e2e session cleanup passed");
