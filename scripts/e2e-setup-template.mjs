import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createConfigHook } from "../dist/create-config.js";
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
assert.equal(result.profile, "full");
assert.equal(result.pluginStrategy, "package");
assert.equal(result.defaultAgent, "nexus");
assert.equal(result.mergePolicy.mergePluginArray, true);

const config = JSON.parse(await fs.readFile(path.join(root, "opencode.json"), "utf8"));
assert.equal(config.plugin.includes("opencode-nexus"), true);
assert.equal(config.instructions.includes("AGENTS.md"), true);
assert.equal(config.default_agent, "nexus");
assert.equal(config.agent.nexus.mode, "primary");

const agents = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
assert.match(agents, /<!-- NEXUS:START -->/);
assert.match(agents, /## Nexus Agent Orchestration/);
assert.match(agents, /coordination label/);

const selfHostedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-self-host-"));
await fs.mkdir(path.join(selfHostedRoot, ".opencode", "plugins"), { recursive: true });
await fs.writeFile(path.join(selfHostedRoot, ".opencode", "plugins", "opencode-nexus.js"), "export {}\n", "utf8");
await fs.writeFile(
  path.join(selfHostedRoot, "opencode.json"),
  JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: ["opencode-nexus", "another-plugin"] }, null, 2),
  "utf8"
);

const selfHostedCtx = {
  directory: selfHostedRoot,
  worktree: selfHostedRoot,
  abort: new AbortController().signal,
  metadata() {},
  async ask() {}
};
const selfHostedResult = JSON.parse(
  await nxSetup.execute({ scope: "project", profile: "auto", install_plugin: true, init_after_setup: false }, selfHostedCtx)
);
assert.equal(selfHostedResult.profile, "minimal");
assert.equal(selfHostedResult.pluginStrategy, "local-shim");
assert.equal(selfHostedResult.warnings.length > 0, true);

const selfHostedConfig = JSON.parse(await fs.readFile(path.join(selfHostedRoot, "opencode.json"), "utf8"));
assert.equal(selfHostedConfig.plugin.includes("opencode-nexus"), false);
assert.equal(selfHostedConfig.plugin.includes("another-plugin"), true);
assert.equal(selfHostedConfig.instructions.includes("AGENTS.md"), true);
assert.equal(selfHostedConfig.default_agent, "nexus");

const preservedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-preserve-agent-"));
await fs.writeFile(
  path.join(preservedRoot, "opencode.json"),
  JSON.stringify({ $schema: "https://opencode.ai/config.json", default_agent: "build" }, null, 2),
  "utf8"
);
const preservedCtx = {
  directory: preservedRoot,
  worktree: preservedRoot,
  abort: new AbortController().signal,
  metadata() {},
  async ask() {}
};
await nxSetup.execute({ scope: "project", install_plugin: true, init_after_setup: false }, preservedCtx);
const preservedConfig = JSON.parse(await fs.readFile(path.join(preservedRoot, "opencode.json"), "utf8"));
assert.equal(preservedConfig.default_agent, "build");

const configHook = createConfigHook();
const runtimeConfig = {};
await configHook(runtimeConfig);
assert.equal(runtimeConfig.default_agent, "nexus");
assert.equal(runtimeConfig.agent.nexus.mode, "primary");
assert.match(runtimeConfig.agent.nexus.prompt, /coordinator-first primary agent/i);

const preservedRuntimeConfig = { default_agent: "build" };
await configHook(preservedRuntimeConfig);
assert.equal(preservedRuntimeConfig.default_agent, "build");

console.log("e2e setup template passed");
