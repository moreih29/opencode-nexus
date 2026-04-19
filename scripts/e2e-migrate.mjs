// e2e-migrate.mjs
// 6 시나리오: migrate 명령어 검증
// Usage: bun scripts/e2e-migrate.mjs

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

const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "nxe2e-migrate-"));
let failed = 0;
const assert = (cond, msg) => {
  if (cond) console.log(`  ✅ ${msg}`);
  else { console.log(`  ❌ ${msg}`); failed++; }
};

// === 시나리오 1: 기본 migrate (dry-run 아닌) ===
console.log("[1] migrate: basic");
{
  const projectDir = path.join(TMP, "s1");
  await fs.mkdir(path.join(projectDir, ".opencode"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "opencode.json"), JSON.stringify({
    plugin: ["opencode-nexus@0.8.0"],
    agent: {
      architect: { model: "m-a", description: "custom desc" },
      engineer: { model: "m-e" },
      customAgent: { model: "m-c" },
    }
  }));
  const { code } = await runCli(["migrate", "--scope", "project", "--directory", projectDir]);
  assert(code === 0, "exit 0");
  
  const opencodeAfter = JSON.parse(await fs.readFile(path.join(projectDir, "opencode.json"), "utf8"));
  assert(!opencodeAfter.agent.architect?.model, "architect.model removed from opencode.json");
  assert(opencodeAfter.agent.architect?.description === "custom desc", "architect.description preserved");
  assert(!opencodeAfter.agent.engineer, "engineer removed (empty after cleanup)");
  assert(opencodeAfter.agent.customAgent?.model === "m-c", "customAgent preserved");
  
  const isolated = JSON.parse(await fs.readFile(path.join(projectDir, ".opencode/opencode-nexus.jsonc"), "utf8"));
  assert(isolated.agents?.architect?.model === "m-a", "architect model migrated");
  assert(isolated.agents?.engineer?.model === "m-e", "engineer model migrated");
  assert(!isolated.agents?.customAgent, "customAgent not migrated (not in ALLOWED_AGENT_IDS)");
}

// === 시나리오 2: --dry-run ===
console.log("[2] migrate: --dry-run");
{
  const projectDir = path.join(TMP, "s2");
  await fs.mkdir(path.join(projectDir, ".opencode"), { recursive: true });
  const opencodeJson = { agent: { architect: { model: "m-a" } } };
  await fs.writeFile(path.join(projectDir, "opencode.json"), JSON.stringify(opencodeJson));
  const before = await fs.readFile(path.join(projectDir, "opencode.json"), "utf8");
  
  const { code, stdout } = await runCli(["migrate", "--scope", "project", "--directory", projectDir, "--dry-run"]);
  assert(code === 0, "exit 0");
  assert(stdout.toLowerCase().includes("dry") || stdout.toLowerCase().includes("diff"), "output mentions dry-run/diff");
  
  const after = await fs.readFile(path.join(projectDir, "opencode.json"), "utf8");
  assert(before === after, "opencode.json unchanged");
  
  const isolatedExists = await fs.stat(path.join(projectDir, ".opencode/opencode-nexus.jsonc")).then(() => true, () => false);
  assert(!isolatedExists, "isolated config not created (dry-run)");
}

// === 시나리오 3: idempotency ===
console.log("[3] migrate: idempotency");
{
  const projectDir = path.join(TMP, "s3");
  await fs.mkdir(path.join(projectDir, ".opencode"), { recursive: true });
  
  // 첫 번째 migrate
  await fs.writeFile(path.join(projectDir, "opencode.json"), JSON.stringify({
    agent: { architect: { model: "m-a" }, engineer: { model: "m-e" } }
  }));
  const { code: code1 } = await runCli(["migrate", "--scope", "project", "--directory", projectDir]);
  assert(code1 === 0, "first migrate exit 0");
  
  // 두 번째 migrate (idempotency)
  const { code: code2 } = await runCli(["migrate", "--scope", "project", "--directory", projectDir]);
  assert(code2 === 0, "second migrate exit 0");
  
  // 같은 값이므로变了하지 않음
  const isolated = JSON.parse(await fs.readFile(path.join(projectDir, ".opencode/opencode-nexus.jsonc"), "utf8"));
  assert(isolated.agents?.architect?.model === "m-a", "architect model still present");
  assert(isolated.agents?.engineer?.model === "m-e", "engineer model still present");
}

// === 시나리오 4: overwrite conflict ===
console.log("[4] migrate: overwrite conflict");
{
  const projectDir = path.join(TMP, "s4");
  await fs.mkdir(path.join(projectDir, ".opencode"), { recursive: true });
  
  // Isolated config 먼저 생성 (architect.model = "isolated-model")
  await fs.writeFile(path.join(projectDir, ".opencode/opencode-nexus.jsonc"), JSON.stringify({
    version: 1,
    agents: { architect: { model: "isolated-model" }, engineer: { model: "iso-eng" } }
  }));
  
  // opencode.json에 다른 모델 값 설정 후 migrate (overwrite 없이)
  await fs.writeFile(path.join(projectDir, "opencode.json"), JSON.stringify({
    agent: { architect: { model: "opencode-model" }, engineer: { model: "opencode-eng" } }
  }));
  
  // 첫 번째 migrate: isolated 값 보존 (opencode.json 우선이나 이미 isolated에 값 있음)
  const { code: code1 } = await runCli(["migrate", "--scope", "project", "--directory", projectDir]);
  assert(code1 === 0, "migrate exit 0");
  let isolated = JSON.parse(await fs.readFile(path.join(projectDir, ".opencode/opencode-nexus.jsonc"), "utf8"));
  assert(isolated.agents?.architect?.model === "isolated-model", "existing isolated model preserved (no overwrite)");
  assert(isolated.agents?.engineer?.model === "iso-eng", "existing engineer model preserved");
  
  // opencode.json에서 model 값 다시 설정 후 --overwrite로 실행
  await fs.writeFile(path.join(projectDir, "opencode.json"), JSON.stringify({
    agent: { architect: { model: "new-opencode-model" }, engineer: { model: "new-opencode-eng" } }
  }));
  
  const { code: code2 } = await runCli(["migrate", "--scope", "project", "--directory", projectDir, "--overwrite"]);
  assert(code2 === 0, "overwrite migrate exit 0");
  isolated = JSON.parse(await fs.readFile(path.join(projectDir, ".opencode/opencode-nexus.jsonc"), "utf8"));
  assert(isolated.agents?.architect?.model === "new-opencode-model", "overwrite: opencode.model wins");
  assert(isolated.agents?.engineer?.model === "new-opencode-eng", "overwrite: engineer updated");
}

// === 시나리오 5: v1 외 필드 (description/prompt) 유지 ===
console.log("[5] migrate: non-model fields preserved in opencode.json");
{
  const projectDir = path.join(TMP, "s5");
  await fs.mkdir(path.join(projectDir, ".opencode"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "opencode.json"), JSON.stringify({
    agent: {
      architect: { model: "m-a", description: "custom desc", prompt: "custom prompt" },
      engineer: { description: "only desc" },
    }
  }));
  const { code } = await runCli(["migrate", "--scope", "project", "--directory", projectDir]);
  assert(code === 0, "exit 0");
  
  const opencodeAfter = JSON.parse(await fs.readFile(path.join(projectDir, "opencode.json"), "utf8"));
  assert(opencodeAfter.agent.architect?.description === "custom desc", "architect.description preserved");
  assert(opencodeAfter.agent.architect?.prompt === "custom prompt", "architect.prompt preserved");
  assert(opencodeAfter.agent.engineer?.description === "only desc", "engineer.description preserved");
}

// === 시나리오 6: backup 파일 생성 ===
console.log("[6] migrate: backup file created");
{
  const projectDir = path.join(TMP, "s6");
  await fs.mkdir(path.join(projectDir, ".opencode"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "opencode.json"), JSON.stringify({
    agent: { architect: { model: "m-a" } }
  }));
  
  const { code } = await runCli(["migrate", "--scope", "project", "--directory", projectDir]);
  assert(code === 0, "exit 0");
  
  // backup 파일이 생성되어야 함
  const files = await fs.readdir(projectDir);
  const backupFiles = files.filter(f => f.startsWith("opencode.json.pre-migrate"));
  assert(backupFiles.length === 1, `backup file created (found: ${backupFiles.join(", ")})`);
  
  // backup 내용 검증
  const backupContent = JSON.parse(await fs.readFile(path.join(projectDir, backupFiles[0]), "utf8"));
  assert(backupContent.agent?.architect?.model === "m-a", "backup has original content");
}

await fs.rm(TMP, { recursive: true, force: true });
console.log(`\n=== migrate e2e: ${failed === 0 ? "PASS" : "FAIL"} (${failed} failures) ===`);
process.exit(failed === 0 ? 0 : 1);
