import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createConfigHook } from "../dist/create-config.js";
import { nxSetup } from "../dist/tools/setup.js";
import { AGENT_META } from "../dist/agents/generated/index.js";

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

const userScopeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-user-scope-"));
const userScopeCtx = { directory: userScopeRoot, worktree: userScopeRoot, abort: new AbortController().signal, metadata() {}, async ask() {} };
const userScopeResult = JSON.parse(await nxSetup.execute({ install_plugin: false, init_after_setup: false }, userScopeCtx));
assert.equal(userScopeResult.scope, "user");
assert.equal(userScopeResult.targetPaths.configFile, path.join(os.homedir(), ".config", "opencode", "opencode.json"));

// ---------------------------------------------------------------------------
// Model configuration regression tests
// ---------------------------------------------------------------------------

function makeCtx(root) {
  return { directory: root, worktree: root, abort: new AbortController().signal, metadata() {}, async ask() {} };
}

async function setupWithModels(ctx, modelArgs) {
  const merged = { scope: "project", install_plugin: false, init_after_setup: false, ...modelArgs };
  const result = JSON.parse(await nxSetup.execute(merged, ctx));
  const config = JSON.parse(await fs.readFile(path.join(ctx.directory, "opencode.json"), "utf8"));
  return { result, config };
}

// Test: additive models with model_preset="skip" works independently
{
  const r = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-models-skip-"));
  const { result, config } = await setupWithModels(makeCtx(r), {
    model_preset: "skip",
    models: { unified: "openai/gpt-4o", how: "openai/gpt-4o", do: "openai/gpt-4o-mini", check: "openai/gpt-4o-mini" }
  });
  assert.equal(result.modelConfiguration.preset, "skip");
  assert.equal(config.agent.architect?.model, "openai/gpt-4o");
  assert.equal(config.agent.engineer?.model, "openai/gpt-4o-mini");
  assert.equal(config.agent.tester?.model, "openai/gpt-4o-mini");
  assert.equal(result.modelConfiguration.discovery.recommendedScope, "user");
}

// Test: provider discovery reports configured providers and models
{
  const r = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-models-discovery-"));
  await fs.writeFile(
    path.join(r, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      provider: {
        openai: { options: { apiKey: "{env:OPENAI_API_KEY}" } },
        anthropic: { options: { apiKey: "{env:ANTHROPIC_API_KEY}" } }
      },
      disabled_providers: ["anthropic"],
      enabled_providers: ["openai", "anthropic", "openrouter"],
      agent: { nexus: { model: "openai/gpt-4o" } },
      model: "openai/gpt-4.1",
      small_model: "openai/gpt-4.1-mini"
    }, null, 2),
    "utf8"
  );
  const { result } = await setupWithModels(makeCtx(r), { model_preset: "skip" });
  assert.deepEqual(result.modelConfiguration.discovery.configuredProviders, ["openai", "openrouter"]);
  assert.deepEqual(result.modelConfiguration.discovery.configuredModels, ["openai/gpt-4.1", "openai/gpt-4.1-mini", "openai/gpt-4o"]);
}

// Test: unified preset with lead_model
{
  const r = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-models-unified-"));
  const { result, config } = await setupWithModels(makeCtx(r), {
    model_preset: "unified",
    lead_model: "anthropic/claude-sonnet-4-5"
  });
  assert.equal(result.modelConfiguration.preset, "unified");
  assert.equal(config.agent.architect?.model, "anthropic/claude-sonnet-4-5");
  assert.equal(config.agent.designer?.model, "anthropic/claude-sonnet-4-5");
  assert.equal(config.agent.engineer?.model, "anthropic/claude-sonnet-4-5");
  assert.equal(config.agent.tester?.model, "anthropic/claude-sonnet-4-5");
  assert.equal(config.agent.nexus?.model, "anthropic/claude-sonnet-4-5");
}

// Test: tiered preset (HOW + nexus = lead_model, DO + CHECK = standard)
{
  const r = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-models-tiered-"));
  const { result, config } = await setupWithModels(makeCtx(r), {
    model_preset: "tiered",
    lead_model: "anthropic/claude-sonnet-4-5"
  });
  assert.equal(result.modelConfiguration.preset, "tiered");
  assert.equal(config.agent.architect?.model, "anthropic/claude-sonnet-4-5"); // HOW = high-cap
  assert.equal(config.agent.nexus?.model, "anthropic/claude-sonnet-4-5");       // nexus = high-cap
  assert.equal(config.agent.engineer?.model, "anthropic/claude-haiku-4-5");   // DO = standard
  assert.equal(config.agent.tester?.model, "anthropic/claude-haiku-4-5");     // CHECK = standard
}

// Test: legacy agent_models overrides still work on top of group resolution
{
  const r = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-models-agent-override-"));
  const { result, config } = await setupWithModels(makeCtx(r), {
    model_preset: "unified",
    lead_model: "openai/gpt-4o",
    agent_models: { architect: "openai/gpt-3-5-turbo" }
  });
  assert.equal(config.agent.architect?.model, "openai/gpt-3-5-turbo"); // override wins
  assert.equal(config.agent.engineer?.model, "openai/gpt-4o");        // group default
}

// Test: custom models with per-category assignments (models additive, preset=skip)
{
  const r = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-models-custom-"));
  const { result, config } = await setupWithModels(makeCtx(r), {
    model_preset: "skip",
    models: {
      unified: "openai/gpt-4o",
      nexus: "anthropic/claude-sonnet-4-5",
      how: "anthropic/claude-haiku-4-5",
      do: "openai/gpt-4o-mini",
      check: "openai/gpt-4o-mini"
    }
  });
  assert.equal(config.agent.nexus?.model, "anthropic/claude-sonnet-4-5");
  assert.equal(config.agent.architect?.model, "anthropic/claude-haiku-4-5");  // how category
  assert.equal(config.agent.designer?.model, "anthropic/claude-haiku-4-5");   // how category
  assert.equal(config.agent.engineer?.model, "openai/gpt-4o-mini");          // do category
  assert.equal(config.agent.tester?.model, "openai/gpt-4o-mini");           // check category
}

// Test: models.agents highest-precedence override
{
  const r = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-models-agents-override-"));
  const { result, config } = await setupWithModels(makeCtx(r), {
    model_preset: "unified",
    lead_model: "openai/gpt-4o",
    models: {
      unified: "openai/gpt-4o",
      agents: { architect: "openai/gpt-3-5-turbo", engineer: "openai/gpt-4-turbo" }
    }
  });
  assert.equal(config.agent.architect?.model, "openai/gpt-3-5-turbo");  // agents override
  assert.equal(config.agent.engineer?.model, "openai/gpt-4-turbo");     // agents override
  assert.equal(config.agent.tester?.model, "openai/gpt-4o");            // group default
}

// Verify all catalog agents get a model when groupModels is populated
{
  const r = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-models-all-agents-"));
  const { result, config } = await setupWithModels(makeCtx(r), {
    model_preset: "skip",
    models: { unified: "openai/gpt-4o", how: "openai/gpt-4o", do: "openai/gpt-4o-mini", check: "openai/gpt-4o-mini" }
  });
  const agentIds = Object.keys(AGENT_META);
  for (const id of agentIds) {
    const cat = AGENT_META[id].category;
    if (cat === "how") assert.equal(config.agent[id]?.model, "openai/gpt-4o", `${id} should be how-model`);
    else if (cat === "do") assert.equal(config.agent[id]?.model, "openai/gpt-4o-mini", `${id} should be do-model`);
    else if (cat === "check") assert.equal(config.agent[id]?.model, "openai/gpt-4o-mini", `${id} should be check-model`);
  }
}

console.log("e2e setup template passed");
