import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-guards-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const hooks = createHooks({ directory: root, worktree: root });
const paths = createNexusPaths(root);
await ensureNexusStructure(paths);

let blocked = false;
try {
  await hooks["tool.execute.before"](
    { tool: "write" },
    { args: { filePath: path.join(root, "src", "a.ts") } }
  );
} catch {
  blocked = true;
}
assert.equal(blocked, true, "write should be blocked without tasks.json");

await fs.writeFile(paths.TASKS_FILE, JSON.stringify({ tasks: [] }, null, 2), "utf8");
await hooks["tool.execute.before"](
  { tool: "write" },
  { args: { filePath: path.join(root, "src", "a.ts") } }
);

console.log("e2e guardrails passed");
