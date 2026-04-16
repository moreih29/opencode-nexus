import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-memory-access-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });
const paths = createNexusPaths(root);
await ensureNexusStructure(paths);

const memoryFile = path.join(paths.MEMORY_ROOT, "empirical-observation.md");
const nonMemoryFile = path.join(root, "notes.md");
await fs.writeFile(memoryFile, "memory note\n", "utf8");
await fs.writeFile(nonMemoryFile, "outside memory root\n", "utf8");

await assert.rejects(() => fs.access(paths.MEMORY_ACCESS_FILE), { code: "ENOENT" });

await hooks["tool.execute.after"](
  {
    tool: "read",
    args: { filePath: memoryFile },
    sessionID: "ses-memory-1"
  },
  { title: "read", output: "ok", metadata: { status: "completed" } }
);

const once = await readJsonl(paths.MEMORY_ACCESS_FILE);
assert.equal(once.length, 1, "first memory read should create one access record");
assert.equal(once[0].path, memoryFile);
assert.equal(once[0].access_count, 1);
assert.equal(once[0].last_agent, "ses-memory-1");
assert.ok(typeof once[0].last_accessed_ts === "string");

await hooks["tool.execute.after"](
  {
    tool: "read",
    args: { filePath: memoryFile },
    sessionID: "ses-memory-2",
    agent_id: "engineer"
  },
  { title: "read", output: "ok", metadata: { status: "completed" } }
);

const twice = await readJsonl(paths.MEMORY_ACCESS_FILE);
assert.equal(twice.length, 1, "same file should upsert, not append duplicates");
assert.equal(twice[0].access_count, 2);
assert.equal(twice[0].last_agent, "engineer");

await hooks["tool.execute.after"](
  {
    tool: "read",
    args: { filePath: paths.MEMORY_ROOT },
    sessionID: "ses-memory-3"
  },
  { title: "read", output: "ok", metadata: { status: "completed" } }
);

await hooks["tool.execute.after"](
  {
    tool: "read",
    args: { filePath: nonMemoryFile },
    sessionID: "ses-memory-4"
  },
  { title: "read", output: "ok", metadata: { status: "completed" } }
);

await hooks["tool.execute.after"](
  {
    tool: "write",
    args: { filePath: memoryFile },
    sessionID: "ses-memory-5"
  },
  { title: "write", output: "ok", metadata: { status: "completed" } }
);

await hooks["tool.execute.after"](
  {
    tool: "read",
    args: { filePath: memoryFile },
    sessionID: "ses-memory-6"
  },
  { title: "Error", output: "read failed", metadata: { status: "failed", error: true } }
);

const afterNegative = await readJsonl(paths.MEMORY_ACCESS_FILE);
assert.equal(afterNegative.length, 1, "non-eligible events must not create extra records");
assert.equal(afterNegative[0].access_count, 2, "negative cases must not change access_count");

await hooks.event({ event: { type: "session.deleted", properties: { sessionID: "ses-memory-1" } } });
await hooks.event({ event: { type: "session.created", sessionID: "ses-memory-7" } });

const persisted = await readJsonl(paths.MEMORY_ACCESS_FILE);
assert.equal(persisted.length, 1, "memory access records should persist across session lifecycle events");
assert.equal(persisted[0].access_count, 2);

console.log("e2e memory access observation passed");

async function readJsonl(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
