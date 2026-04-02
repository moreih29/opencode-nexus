import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { nxSetup } from "../dist/tools/setup.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

await execFileAsync("bun", ["scripts/generate-template.mjs"], { cwd: repoRoot });
const template = await fs.readFile(path.join(repoRoot, "templates", "nexus-section.md"), "utf8");
assert.match(template, /## Nexus Agent Orchestration/);
assert.match(template, /### Tags/);
assert.match(template, /### Operational Rules/);
assert.match(template, /### Platform Mapping/);

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-setup-"));
const ctx = { directory: root, worktree: root, abort: new AbortController().signal, metadata() {}, async ask() {} };

const result = JSON.parse(await nxSetup.execute({ scope: "project", install_plugin: true, init_after_setup: false }, ctx));
assert.equal(result.configured, true);
assert.equal(result.targetPaths.instructionsFile, path.join(root, "AGENTS.md"));
assert.equal(result.targetPaths.configFile, path.join(root, "opencode.json"));
assert.equal(result.mergePolicy.mergePluginArray, true);

const config = JSON.parse(await fs.readFile(path.join(root, "opencode.json"), "utf8"));
assert.equal(config.plugin.includes("opencode-nexus"), true);
assert.equal(config.instructions.includes("AGENTS.md"), true);

const agents = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
assert.match(agents, /<!-- NEXUS:START -->/);
assert.match(agents, /## Nexus Agent Orchestration/);
assert.match(agents, /coordination label/);

console.log("e2e setup template passed");
