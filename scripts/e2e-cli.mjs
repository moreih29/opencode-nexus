#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = ["nx-init", "nx-plan", "nx-run", "nx-sync"];

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const CLI_BIN = join(REPO_ROOT, "bin", "opencode-nexus.mjs");
const POSTINSTALL = join(REPO_ROOT, "scripts", "postinstall.mjs");

const ROOT = mkdtempSync(join(tmpdir(), "nexus-e2e-"));
const FAKE_HOME = join(ROOT, "home");
const PROJECT = join(ROOT, "project");

const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

function assertMatch(value, pattern, message) {
  if (!pattern.test(value)) {
    throw new Error(`${message}\n  pattern: ${pattern}\n  value: ${JSON.stringify(value)}`);
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function freshBlock() {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(FAKE_HOME, { recursive: true });
  mkdirSync(PROJECT, { recursive: true });
}

function configEnv(extraEnv = {}) {
  return {
    ...process.env,
    HOME: FAKE_HOME,
    XDG_CONFIG_HOME: join(FAKE_HOME, ".config"),
    ...extraEnv,
  };
}

function runCli(args, opts = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: opts.cwd ?? PROJECT,
    env: configEnv(opts.env ?? {}),
    encoding: "utf8",
  });

  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    signal: result.signal,
  };
}

function runNodeScript(scriptPath, args = [], opts = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: opts.cwd ?? PROJECT,
    env: configEnv(opts.env ?? {}),
    encoding: "utf8",
  });

  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    signal: result.signal,
  };
}

function projectConfigPath() {
  return join(PROJECT, "opencode.json");
}

function userConfigPath() {
  return join(FAKE_HOME, ".config", "opencode", "opencode.json");
}

function projectSkillsDir() {
  return join(PROJECT, ".opencode", "skills");
}

function userSkillsDir() {
  return join(FAKE_HOME, ".config", "opencode", "skills");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeRaw(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}

function fileExists(path) {
  return existsSync(path);
}

function backupFiles(configPath) {
  const dir = dirname(configPath);
  if (!existsSync(dir)) return [];
  const prefix = `${basename(configPath)}.backup-`;
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .sort();
}

function tmpFiles(configPath) {
  const dir = dirname(configPath);
  if (!existsSync(dir)) return [];
  const prefix = `${basename(configPath)}.tmp-`;
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .sort();
}

function assertSkillFiles(baseDir) {
  for (const skill of SKILLS) {
    const skillPath = join(baseDir, skill, "SKILL.md");
    assert(fileExists(skillPath), `missing skill file: ${skillPath}`);
  }
}

function walkTree(rootDir) {
  const out = [];
  function walk(current, rel = "") {
    if (!existsSync(current)) return;
    const entries = readdirSync(current).sort();
    for (const entry of entries) {
      const abs = join(current, entry);
      const nextRel = rel ? join(rel, entry) : entry;
      const st = statSync(abs);
      if (st.isDirectory()) {
        out.push(`${nextRel}/`);
        walk(abs, nextRel);
      } else {
        out.push(`${nextRel}:${st.size}`);
      }
    }
  }
  walk(rootDir);
  return out;
}

async function block(id, name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ id, name, status: "PASS", duration: Date.now() - t0 });
    console.log(`✓ ${id}: ${name}`);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    results.push({
      id,
      name,
      status: "FAIL",
      err: err.message,
      stack: err.stack,
      duration: Date.now() - t0,
    });
    console.error(`✗ ${id}: ${name} — ${err.message}`);
  }
}

function expectedCanonicalMcp() {
  return { nx: { type: "local", command: ["nexus-mcp"] } };
}

async function run() {
  await block("B1", "install --scope=project fresh", async () => {
    freshBlock();
    const result = runCli(["install", "--scope=project", "--yes"]);
    assertEqual(result.code, 0, "install must succeed");

    const cfgPath = projectConfigPath();
    assert(fileExists(cfgPath), "project opencode.json must exist");

    const config = readJson(cfgPath);
    assertEqual(config.plugin, ["opencode-nexus"], "project plugin must be canonical singleton");
    assertEqual(config.mcp, expectedCanonicalMcp(), "project mcp.nx must be canonical");
    assertEqual(config.default_agent, "lead", "project default_agent must be lead");

    assertSkillFiles(projectSkillsDir());
  });

  await block("B2", "install --scope=project idempotent", async () => {
    freshBlock();
    const first = runCli(["install", "--scope=project", "--yes"]);
    assertEqual(first.code, 0, "first install must succeed");

    const before = readJson(projectConfigPath());
    const second = runCli(["install", "--scope=project", "--yes"]);
    assertEqual(second.code, 0, "second install must succeed");

    const after = readJson(projectConfigPath());
    assertEqual(after, before, "idempotent second install must not mutate config");
    assertEqual(backupFiles(projectConfigPath()).length, 0, "idempotent install must not create backups");
    assertMatch(second.stdout, /no config changes|no changes/i, "stdout must include no-op message");
  });

  await block("B3", "install --scope=user fresh + idempotent", async () => {
    freshBlock();
    const first = runCli(["install", "--scope=user", "--yes"]);
    assertEqual(first.code, 0, "user install must succeed");

    const userCfgPath = userConfigPath();
    assert(fileExists(userCfgPath), "user opencode.json must exist");

    const userConfig = readJson(userCfgPath);
    assertEqual(userConfig.plugin, ["opencode-nexus"], "user plugin must be canonical singleton");
    assertEqual(userConfig.mcp, expectedCanonicalMcp(), "user mcp.nx must be canonical");
    assert(userConfig.default_agent === undefined, "user config must not set default_agent by default");
    assertSkillFiles(userSkillsDir());

    const before = readJson(userCfgPath);
    const second = runCli(["install", "--scope=user", "--yes"]);
    assertEqual(second.code, 0, "second user install must succeed");
    const after = readJson(userCfgPath);

    assertEqual(after, before, "second user install must be idempotent");
    assertEqual(backupFiles(userCfgPath).length, 0, "idempotent user install must not create backups");
    assertMatch(second.stdout, /no config changes|no changes/i, "stdout must include no-op message");
  });

  await block("B4", "install --scope=both ownership split", async () => {
    freshBlock();
    const result = runCli(["install", "--scope=both", "--yes"]);
    assertEqual(result.code, 0, "both-scope install must succeed");

    const userConfig = readJson(userConfigPath());
    const projectConfig = readJson(projectConfigPath());

    assertEqual(userConfig.plugin, ["opencode-nexus"], "user scope must own plugin");
    assertEqual(userConfig.mcp, expectedCanonicalMcp(), "user scope must own mcp.nx");
    assert(userConfig.default_agent === undefined, "user scope must not own default_agent in both-mode");

    assertEqual(projectConfig.default_agent, "lead", "project scope must own default_agent in both-mode");
    assert(projectConfig.plugin === undefined, "project scope must not own plugin in both-mode");
    assert(projectConfig.mcp?.nx === undefined, "project scope must not own mcp.nx in both-mode");

    assertSkillFiles(projectSkillsDir());
    assert(!existsSync(userSkillsDir()), "user skills directory must stay empty in default both-mode");
  });

  await block("B5", "preserve-first existing config fields", async () => {
    freshBlock();
    writeJson(projectConfigPath(), {
      mcp: {
        context7: { type: "remote", url: "https://mcp.context7.com/mcp" },
      },
      agent: {
        "custom-x": { mode: "primary", model: "foo/bar" },
      },
      plugin: ["some-other-plugin"],
      permission: { "*": "ask" },
    });

    const result = runCli(["install", "--scope=project", "--yes"]);
    assertEqual(result.code, 0, "project install must succeed with existing config");

    const config = readJson(projectConfigPath());
    assertEqual(config.mcp.context7, { type: "remote", url: "https://mcp.context7.com/mcp" }, "mcp.context7 must be preserved");
    assertEqual(config.mcp.nx, { type: "local", command: ["nexus-mcp"] }, "mcp.nx must be appended");
    assertEqual(config.agent["custom-x"], { mode: "primary", model: "foo/bar" }, "custom agent must be preserved");
    assertEqual(config.plugin, ["some-other-plugin", "opencode-nexus"], "plugin array must preserve-first append Nexus entry");
    assertEqual(config.permission, { "*": "ask" }, "permission must be preserved");
    assertEqual(config.default_agent, "lead", "default_agent must be added");
  });

  await block("B6", "plugin duplicate detect warn-only", async () => {
    freshBlock();
    writeJson(projectConfigPath(), {
      plugin: ["opencode-nexus", "opencode-nexus@0.8.0"],
      mcp: expectedCanonicalMcp(),
      default_agent: "lead",
    });

    const before = readJson(projectConfigPath());
    const result = runCli(["install", "--scope=project", "--yes"]);
    assertEqual(result.code, 0, "install with duplicate plugins must succeed");

    const log = `${result.stdout}\n${result.stderr}`;
    assertMatch(log, /duplicate|multiple .*entries|normalize/i, "output must include duplicate warning hint");

    const after = readJson(projectConfigPath());
    assertEqual(after.plugin, before.plugin, "duplicate plugin entries must be preserved without auto-collapse");
  });

  await block("B7", "dry-run no mutation + diff output", async () => {
    freshBlock();
    const result = runCli(["install", "--scope=project", "--dry-run", "--yes"]);
    assertEqual(result.code, 0, "dry-run must succeed");

    assert(!fileExists(projectConfigPath()), "dry-run must not create opencode.json");
    assert(!existsSync(projectSkillsDir()), "dry-run must not copy skills");

    assertMatch(result.stdout, /plugin/i, "dry-run output must mention plugin changes");
    assertMatch(result.stdout, /mcp\.nx|mcp/i, "dry-run output must mention mcp.nx changes");
    assertMatch(result.stdout, /default_agent/i, "dry-run output must mention default_agent changes");
  });

  await block("B8", "uninstall symmetry", async () => {
    freshBlock();
    const install = runCli(["install", "--scope=project", "--yes"]);
    assertEqual(install.code, 0, "install fixture must succeed");

    const cfgPath = projectConfigPath();
    const installed = readJson(cfgPath);
    installed.agent = { custom: { mode: "primary", model: "x/y" } };
    installed.instructions = "keep me";
    writeJson(cfgPath, installed);

    const result = runCli(["uninstall", "--scope=project", "--yes"]);
    assertEqual(result.code, 0, "uninstall must succeed");

    const config = readJson(cfgPath);
    assert(config.plugin === undefined, "plugin must be removed or cleaned up");
    assert(config.mcp === undefined, "mcp container must be cleaned up when empty");
    assert(config.default_agent === undefined, "default_agent=lead must be removed");
    assertEqual(config.$schema, "https://opencode.ai/config.json", "$schema must be preserved");
    assertEqual(config.agent, { custom: { mode: "primary", model: "x/y" } }, "consumer-owned agent must be preserved");
    assertEqual(config.instructions, "keep me", "consumer-owned instructions must be preserved");

    assertSkillFiles(projectSkillsDir());
  });

  await block("B9", "uninstall preserves consumer-owned fields", async () => {
    freshBlock();
    writeJson(projectConfigPath(), {
      mcp: {
        context7: { type: "remote", url: "https://mcp.context7.com/mcp" },
      },
      agent: {
        "custom-x": { mode: "primary", model: "foo/bar" },
      },
      plugin: ["some-other-plugin"],
      permission: { "*": "ask" },
    });

    const install = runCli(["install", "--scope=project", "--yes"]);
    assertEqual(install.code, 0, "install fixture must succeed");

    const uninstall = runCli(["uninstall", "--scope=project", "--yes"]);
    assertEqual(uninstall.code, 0, "uninstall must succeed");

    const config = readJson(projectConfigPath());
    assertEqual(config.mcp.context7, { type: "remote", url: "https://mcp.context7.com/mcp" }, "mcp.context7 must be preserved");
    assert(config.mcp.nx === undefined, "mcp.nx must be removed on uninstall");
    assertEqual(config.agent["custom-x"], { mode: "primary", model: "foo/bar" }, "custom agent must be preserved");
    assertEqual(config.plugin, ["some-other-plugin"], "only Nexus plugin entry must be removed");
    assertEqual(config.permission, { "*": "ask" }, "permission must be preserved");
  });

  await block("B10", "backup rotation keeps max 5", async () => {
    freshBlock();
    const cfgPath = projectConfigPath();
    const initial = runCli(["install", "--scope=project", "--yes"]);
    assertEqual(initial.code, 0, "initial install must succeed");

    const observedByStep = [];
    for (let i = 0; i < 6; i += 1) {
      const config = readJson(cfgPath);
      config.default_agent = `someone-${i}`;
      writeJson(cfgPath, config);

      const result = runCli(["install", "--scope=project", "--yes", "--force"]);
      assertEqual(result.code, 0, `forced install ${i + 1} must succeed`);

      observedByStep.push([...backupFiles(cfgPath)]);
      await sleep(1100);
    }

    const finalBackups = backupFiles(cfgPath);
    assert(finalBackups.length <= 5, `backup count must be <= 5, got ${finalBackups.length}`);
    assertEqual(finalBackups.length, 5, "after 6 writes, exactly 5 backups must remain");

    const firstStepBackups = observedByStep[0] ?? [];
    if (firstStepBackups.length > 0) {
      const oldest = firstStepBackups[0];
      assert(!finalBackups.includes(oldest), "oldest backup should be rotated out by step 6");
    }
  });

  await block("B11", "atomic write temp file cleanup", async () => {
    freshBlock();
    const cfgPath = projectConfigPath();
    const first = runCli(["install", "--scope=project", "--yes"]);
    assertEqual(first.code, 0, "install fixture must succeed");

    const config = readJson(cfgPath);
    config.default_agent = "someone";
    writeJson(cfgPath, config);

    const second = runCli(["install", "--scope=project", "--yes", "--force"]);
    assertEqual(second.code, 0, "second install must succeed");

    assertEqual(tmpFiles(cfgPath), [], "atomic write must not leave tmp files");
    const after = readJson(cfgPath);
    assertEqual(after.default_agent, "lead", "config must remain intact after atomic rewrite");
  });

  await block("B12", "doctor state classification", async () => {
    freshBlock();
    let doctor = runCli(["doctor", "--scope=project"]);
    assertEqual(doctor.code, 0, "doctor fresh should exit 0");
    assertMatch(doctor.stdout, /state:\s*fresh/i, "doctor should classify fresh state");

    freshBlock();
    const install = runCli(["install", "--scope=project", "--yes"]);
    assertEqual(install.code, 0, "install fixture must succeed");
    doctor = runCli(["doctor", "--scope=project"]);
    assertEqual(doctor.code, 0, "doctor complete should exit 0");
    assertMatch(doctor.stdout, /state:\s*complete/i, "doctor should classify complete state");

    freshBlock();
    writeJson(projectConfigPath(), { plugin: ["opencode-nexus"] });
    mkdirSync(projectSkillsDir(), { recursive: true });
    for (const skill of SKILLS) {
      writeRaw(join(projectSkillsDir(), skill, "SKILL.md"), `# ${skill}\n`);
    }
    doctor = runCli(["doctor", "--scope=project"]);
    assertEqual(doctor.code, 0, "doctor partial_config should exit 0");
    assertMatch(doctor.stdout, /state:\s*partial_config/i, "doctor should classify partial_config state");

    freshBlock();
    const installForOrphan = runCli(["install", "--scope=project", "--yes"]);
    assertEqual(installForOrphan.code, 0, "install fixture for orphan_skills must succeed");
    unlinkSync(projectConfigPath());
    doctor = runCli(["doctor", "--scope=project"]);
    assertEqual(doctor.code, 0, "doctor orphan_skills should exit 0");
    assertMatch(doctor.stdout, /state:\s*orphan_skills/i, "doctor should classify orphan_skills state");
  });

  await block("B13", "doctor --json outputs valid JSON", async () => {
    freshBlock();
    const install = runCli(["install", "--scope=project", "--yes"]);
    assertEqual(install.code, 0, "install fixture must succeed");

    const result = runCli(["doctor", "--scope=project", "--json"]);
    assertEqual(result.code, 0, "doctor --json must succeed");

    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(`doctor --json output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    assert(typeof parsed === "object" && parsed !== null, "parsed doctor output must be an object");
    assert(typeof parsed.scope === "string", "doctor --json must include scope");
    assert(typeof parsed.state === "string", "doctor --json must include state");
    assert(Array.isArray(parsed.checks), "doctor --json must include checks array");
    assert(typeof parsed.summary === "object" && parsed.summary !== null, "doctor --json must include summary object");
  });

  await block("B14", "JSONC fail-safe keeps file untouched", async () => {
    freshBlock();
    const cfgPath = projectConfigPath();
    const jsonc = `// leading comment\n{\n  "plugin": ["foo"],\n  "trailing": 1, // trailing comma issue\n}\n`;
    writeRaw(cfgPath, jsonc);

    const before = readFileSync(cfgPath, "utf8");
    const result = runCli(["install", "--scope=project", "--yes"]);

    assert(result.code !== 0, "install should fail on JSONC input");
    const logs = `${result.stdout}\n${result.stderr}`;
    assertMatch(logs, /JSONC|strict JSON/i, "error output must mention JSONC/strict JSON");

    const after = readFileSync(cfgPath, "utf8");
    assertEqual(after, before, "JSONC parse failure must not mutate file");
  });

  await block("B15", "postinstall silent mutation policy + self-install guard", async () => {
    freshBlock();

    const beforeTree = walkTree(PROJECT);
    const postinstall = runNodeScript(POSTINSTALL, [], { env: { INIT_CWD: PROJECT } });
    assertEqual(postinstall.code, 0, "postinstall should exit 0");
    assert(!fileExists(projectConfigPath()), "postinstall must not create opencode.json");
    assert(!existsSync(projectSkillsDir()), "postinstall must not create skills directory");
    assertMatch(postinstall.stdout, /bunx\s+opencode-nexus\s+install/i, "postinstall hint must mention canonical install command");

    const afterTree = walkTree(PROJECT);
    assertEqual(afterTree, beforeTree, "postinstall must not mutate consumer filesystem");

    writeJson(join(PROJECT, "package.json"), { name: "opencode-nexus" });
    const guard = runNodeScript(POSTINSTALL, [], { env: { INIT_CWD: PROJECT } });
    assertEqual(guard.code, 0, "self-install guard should exit 0");
    assert(guard.stdout.trim() === "", "self-install guard should stay silent");
  });
}

async function main() {
  const t0 = Date.now();
  try {
    await run();
  } finally {
    rmSync(ROOT, { recursive: true, force: true });
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  const failedRows = results.filter((r) => r.status === "FAIL");

  console.log(`\n=== Summary: ${passed}/${results.length} PASS ===`);
  console.log(`Total duration: ${Date.now() - t0}ms`);

  if (failedRows.length > 0) {
    console.error("Failed blocks:");
    for (const row of failedRows) {
      console.error(`  ${row.id} ${row.name}: ${row.err}`);
    }
    process.exit(1);
  }
}

await main();
