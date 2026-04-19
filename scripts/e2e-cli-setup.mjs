// e2e-cli-setup.mjs
// 4 시나리오: CLI setup 명령어 검증
// Usage: bun scripts/e2e-cli-setup.mjs

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const CLI = path.resolve("dist/cli.js");

async function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI, ...args], { env: { ...process.env, ...env } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => stdout += d);
    child.stderr.on("data", (d) => stderr += d);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "nxe2e-setup-"));
let failed = 0;
const assert = (cond, msg) => {
  if (cond) console.log(`  ✅ ${msg}`);
  else { console.log(`  ❌ ${msg}`); failed++; }
};

// === 시나리오 1: setup --scope project → isolated에만 기록, opencode.json 안 건드림 ===
console.log("[1] setup: isolated only, opencode.json untouched");
{
  const projectDir = path.join(TMP, "s1");
  await fs.mkdir(path.join(projectDir, ".opencode"), { recursive: true });
  
  // 기존 opencode.json (model 있음)
  await fs.writeFile(path.join(projectDir, "opencode.json"), JSON.stringify({
    agent: { architect: { model: "user-model", description: "user desc" } }
  }));
  const opencodeBefore = await fs.readFile(path.join(projectDir, "opencode.json"), "utf8");
  
  // setup 실행: --how-model로 HOW agents 모델 지정
  const { code } = await runCli([
    "setup", "--scope", "project", "--directory", projectDir,
    "--how-model", "setup-how-model"
  ]);
  assert(code === 0, "exit 0");
  
  // opencode.json 변하지 않음
  const opencodeAfter = await fs.readFile(path.join(projectDir, "opencode.json"), "utf8");
  assert(opencodeAfter === opencodeBefore, "opencode.json unchanged");
  
  // isolated config에 기록됨
  const isolatedPath = path.join(projectDir, ".opencode/opencode-nexus.jsonc");
  const isolatedExists = await fs.stat(isolatedPath).then(() => true, () => false);
  assert(isolatedExists, "isolated config created");
  
  const isolated = JSON.parse(await fs.readFile(isolatedPath, "utf8"));
  // HOW agents: architect, designer, postdoc, strategist
  assert(isolated.agents?.architect?.model === "setup-how-model", "architect.model set in isolated");
  assert(isolated.agents?.designer?.model === "setup-how-model", "designer.model set in isolated");
  assert(isolated.agents?.postdoc?.model === "setup-how-model", "postdoc.model set in isolated");
  assert(isolated.agents?.strategist?.model === "setup-how-model", "strategist.model set in isolated");
}

// === 시나리오 2: --how-model만 지정 → HOW category 4 agent에 flatten 저장 ===
console.log("[2] setup: --how-model targets 4 HOW agents");
{
  const projectDir = path.join(TMP, "s2");
  await fs.mkdir(path.join(projectDir, ".opencode"), { recursive: true });
  
  const { code } = await runCli([
    "setup", "--scope", "project", "--directory", projectDir,
    "--how-model", "my-how-model"
  ]);
  assert(code === 0, "exit 0");
  
  const isolated = JSON.parse(await fs.readFile(
    path.join(projectDir, ".opencode/opencode-nexus.jsonc"), "utf8"
  ));
  
  // HOW category agents
  assert(isolated.agents?.architect?.model === "my-how-model", "architect model = my-how-model");
  assert(isolated.agents?.designer?.model === "my-how-model", "designer model = my-how-model");
  assert(isolated.agents?.postdoc?.model === "my-how-model", "postdoc model = my-how-model");
  assert(isolated.agents?.strategist?.model === "my-how-model", "strategist model = my-how-model");
  
  // DO/CHECK agents는 影响 안 받음
  assert(!isolated.agents?.engineer?.model, "engineer.model not set by --how-model");
  assert(!isolated.agents?.reviewer?.model, "reviewer.model not set by --how-model");
}

// === 시나리오 3: 기존 isolated에 agents[id].tools 있으면 setup이 tools 보존 ===
console.log("[3] setup: existing tools preserved");
{
  const projectDir = path.join(TMP, "s3");
  await fs.mkdir(path.join(projectDir, ".opencode"), { recursive: true });
  
  // 기존 isolated config (tools 포함)
  await fs.writeFile(path.join(projectDir, ".opencode/opencode-nexus.jsonc"), JSON.stringify({
    version: 1,
    agents: {
      architect: { model: "old-model", tools: { customTool: true } }
    }
  }));
  
  const { code } = await runCli([
    "setup", "--scope", "project", "--directory", projectDir,
    "--how-model", "new-how-model"
  ]);
  assert(code === 0, "exit 0");
  
  const isolated = JSON.parse(await fs.readFile(
    path.join(projectDir, ".opencode/opencode-nexus.jsonc"), "utf8"
  ));
  
  assert(isolated.agents?.architect?.model === "new-how-model", "architect.model updated");
  assert(isolated.agents?.architect?.tools?.customTool === true, "architect.tools.customTool preserved");
}

// === 시나리오 4: --all-model로 전체 agent 일괄 ===
console.log("[4] setup: --all-model sets all agent categories");
{
  const projectDir = path.join(TMP, "s4");
  await fs.mkdir(path.join(projectDir, ".opencode"), { recursive: true });
  
  const { code } = await runCli([
    "setup", "--scope", "project", "--directory", projectDir,
    "--all-model", "universal-model"
  ]);
  assert(code === 0, "exit 0");
  
  const isolated = JSON.parse(await fs.readFile(
    path.join(projectDir, ".opencode/opencode-nexus.jsonc"), "utf8"
  ));
  
  // 모든 agent에 universal-model 설정
  assert(isolated.agents?.architect?.model === "universal-model", "architect model set");
  assert(isolated.agents?.designer?.model === "universal-model", "designer model set");
  assert(isolated.agents?.engineer?.model === "universal-model", "engineer model set");
  assert(isolated.agents?.tester?.model === "universal-model", "tester model set");
  assert(isolated.agents?.reviewer?.model === "universal-model", "reviewer model set");
  assert(isolated.agents?.researcher?.model === "universal-model", "researcher model set");
  assert(isolated.agents?.writer?.model === "universal-model", "writer model set");
  assert(isolated.agents?.postdoc?.model === "universal-model", "postdoc model set");
  assert(isolated.agents?.strategist?.model === "universal-model", "strategist model set");
  assert(isolated.agents?.general?.model === "universal-model", "general model set");
  assert(isolated.agents?.explore?.model === "universal-model", "explore model set");
}

await fs.rm(TMP, { recursive: true, force: true });
console.log(`\n=== cli-setup e2e: ${failed === 0 ? "PASS" : "FAIL"} (${failed} failures) ===`);
process.exit(failed === 0 ? 0 : 1);
