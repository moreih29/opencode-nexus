// e2e-isolated-config.mjs
// 7 시나리오: isolated config schema, 5-step merge chain 검증
// Usage: bun scripts/e2e-isolated-config.mjs

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const { createConfigHook } = await import("../dist/create-config.js");
const { readIsolatedConfig, mergeIsolatedConfigs } = await import("../dist/shared/nexus-config.js");
const { ALLOWED_AGENT_IDS } = await import("../dist/shared/nexus-config-schema.js");
const { AGENT_META } = await import("../dist/agents/prompts.js");

const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "nxe2e-isolated-"));

let failed = 0;
const assert = (cond, msg) => {
  if (cond) console.log(`  ✅ ${msg}`);
  else { console.log(`  ❌ ${msg}`); failed++; }
};

// === 시나리오 1: isolated config 만 있을 때 ===
console.log("[1] isolated config only");
{
  const config = { agent: {} };
  const isolated = { version: 1, agents: { architect: { model: "iso-m" } } };
  const hook = createConfigHook(isolated);
  await hook(config);
  assert(config.agent.architect?.model === "iso-m", "architect.model = iso-m (Step 2 반영)");
}

// === 시나리오 2: isolated + opencode.json 둘 다 (opencode.json 우선) ===
console.log("[2] isolated + opencode.json (opencode wins)");
{
  const config = { agent: { architect: { model: "user-m" } } };
  const isolated = { version: 1, agents: { architect: { model: "iso-m" } } };
  const hook = createConfigHook(isolated);
  await hook(config);
  assert(config.agent.architect?.model === "user-m", "architect.model = user-m (Step 4 > Step 2)");
}

// === 시나리오 3: global + project merge (project 우선) ===
console.log("[3] global + project (project wins)");
{
  const global = { version: 1, agents: { engineer: { model: "global-m" } } };
  const project = { version: 1, agents: { engineer: { model: "project-m" } } };
  const merged = mergeIsolatedConfigs(global, project);
  assert(merged.agents.engineer.model === "project-m", "engineer.model = project-m");
}

// === 시나리오 4: TASK_DELEGATION_DISABLED_TOOLS override 시도 ===
console.log("[4] hard-lock override blocked");
{
  const config = { agent: {} };
  const isolated = { version: 1, agents: { architect: { tools: { task: true, nx_task_close: true } } } };
  const hook = createConfigHook(isolated);
  await hook(config);
  assert(config.agent.architect.tools.task === false, "tools.task forced false");
  assert(config.agent.architect.tools.nx_task_close === false, "tools.nx_task_close forced false");
}

// === 시나리오 5: Missing isolated config → silent fallback ===
console.log("[5] missing isolated config");
{
  const missingPath = path.join(TMP, "does-not-exist.jsonc");
  const result = await readIsolatedConfig(missingPath);
  assert(result.source === "missing", "source === 'missing'");
  assert(result.warnings.length === 0, "no warnings");
  assert(result.config.version === 1 && Object.keys(result.config.agents).length === 0, "empty fallback");
}

// === 시나리오 6: Parse error → warn + fallback ===
console.log("[6] parse error isolated config");
{
  const badPath = path.join(TMP, "bad.jsonc");
  await fs.writeFile(badPath, "{ invalid json content");
  const result = await readIsolatedConfig(badPath);
  assert(result.source === "parse-error", "source === 'parse-error'");
  assert(result.warnings.length > 0, "has warnings");
  assert(result.config.version === 1, "empty fallback");
}

// === 시나리오 7: Sparse config (일부 agent 만) ===
console.log("[7] sparse isolated config");
{
  const config = { agent: {} };
  const isolated = { version: 1, agents: { architect: { model: "arch-m" } } };
  const hook = createConfigHook(isolated);
  await hook(config);
  assert(config.agent.architect?.model === "arch-m", "architect gets isolated model");
  assert(config.agent.engineer?.model !== undefined, "engineer has canonical model (not missing)");
  // engineer canonical model 은 AGENT_META.engineer.model 이어야 함
  const engineerMeta = AGENT_META["engineer"];
  assert(config.agent.engineer?.model === engineerMeta?.model, `engineer.model = canonical (${engineerMeta?.model})`);
}

// Cleanup
await fs.rm(TMP, { recursive: true, force: true });

console.log(`\n=== isolated-config e2e: ${failed === 0 ? "PASS" : "FAIL"} (${failed} failures) ===`);
process.exit(failed === 0 ? 0 : 1);
