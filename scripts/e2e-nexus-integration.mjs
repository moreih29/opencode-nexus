#!/usr/bin/env bun

import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PACKAGE_SPEC } from "../lib/install-spec.mjs";

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function run(command, args, { cwd = process.cwd(), timeoutMs = 10000 } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, timedOut });
    });
  });
}

async function main() {
  const pluginModule = await import("../src/plugin.ts");
  assert(typeof pluginModule.default === "function", "plugin default export must be a function");

  const hooks = await pluginModule.default({ directory: process.cwd() });
  assert(typeof hooks.config === "function", "plugin must expose config hook");
  assert(typeof hooks.event === "function", "plugin must expose event hook");
  assert(typeof hooks["chat.message"] === "function", "plugin must expose chat.message hook");

  const config = {};
  await hooks.config(config);
  assert(config.default_agent === "lead", "config hook must set default_agent to lead when absent");
  assert(typeof config.agent?.lead?.prompt === "string", "config hook must inject lead agent prompt");
  assert(typeof config.agent?.engineer?.prompt === "string", "config hook must inject engineer agent prompt");

  const dryRun = await run("./node_modules/.bin/nexus-sync", ["--harness=opencode", "--target=./", "--dry-run"]);
  assert(!dryRun.timedOut, "sync --dry-run timed out");
  assert(dryRun.code === 0, `sync --dry-run failed: ${dryRun.stderr || dryRun.stdout}`);

  const requiredPaths = [
    "skills/nx-auto-plan/SKILL.md",
    "skills/nx-plan/SKILL.md",
    "skills/nx-run/SKILL.md",
  ];

  for (const relativePath of requiredPaths) {
    assert(existsSync(resolve(relativePath)), `missing synced file: ${relativePath}`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), "opencode-nexus-"));
  try {
    const existingConfigPath = join(tempDir, "opencode.json");
    Bun.write(existingConfigPath, `${JSON.stringify({
      plugin: ["custom-plugin", "opencode-nexus@0.1.0", "opencode-nexus"],
      mcp: {
        other: {
          type: "local",
          command: ["other-mcp"],
        },
      },
    }, null, 2)}\n`);

    const installResult = await run("node", [resolve("bin/opencode-nexus.mjs"), "install", "--scope=project"], {
      cwd: tempDir,
    });
    assert(!installResult.timedOut, "install CLI timed out");
    assert(installResult.code === 0, `install CLI failed: ${installResult.stderr || installResult.stdout}`);

    const configPath = join(tempDir, "opencode.json");
    assert(existsSync(configPath), "install did not create opencode.json");

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    assert(Array.isArray(config.plugin), "config.plugin must be an array");
    assert(config.plugin?.includes("custom-plugin"), "config.plugin must preserve existing plugins");
    assert(config.plugin?.includes(PACKAGE_SPEC), `config.plugin is missing pinned package spec ${PACKAGE_SPEC}`);
    assert(config.plugin?.filter((entry) => typeof entry === "string" && entry.startsWith("opencode-nexus")).length === 1, "config.plugin must normalize opencode-nexus entries to a single pinned spec");
    assert(config.mcp?.nx?.type === "local", "config.mcp.nx.type must be local");
    assert(Array.isArray(config.mcp?.nx?.command) && config.mcp.nx.command[0] === "nexus-mcp", "config.mcp.nx.command must start nexus-mcp");
    assert(config.mcp?.other?.command?.[0] === "other-mcp", "config.mcp must preserve unrelated entries");
    assert(config.default_agent === "lead", "config.default_agent must be lead");
    assert(config.agent?.build?.disable === true, "agent.build.disable must default to true");
    assert(config.agent?.plan?.disable === true, "agent.plan.disable must default to true");
    assert(existsSync(join(tempDir, ".opencode", "skills", "nx-auto-plan", "SKILL.md")), "install did not copy nx-auto-plan skill");
    assert(existsSync(join(tempDir, ".opencode", "skills", "nx-plan", "SKILL.md")), "install did not copy nx-plan skill");
    assert(existsSync(join(tempDir, ".opencode", "skills", "nx-run", "SKILL.md")), "install did not copy nx-run skill");

    const modelsResult = await run("node", [
      resolve("bin/opencode-nexus.mjs"),
      "models",
      "--scope=project",
      "--agents=lead,architect,general,explore",
      "--model=openai/gpt-5.4",
    ], {
      cwd: tempDir,
    });
    assert(!modelsResult.timedOut, "models CLI timed out");
    assert(modelsResult.code === 0, `models CLI failed: ${modelsResult.stderr || modelsResult.stdout}`);

    const updatedConfig = JSON.parse(readFileSync(configPath, "utf8"));
    assert(updatedConfig.agent?.lead?.model === "openai/gpt-5.4", "lead model override was not written");
    assert(updatedConfig.agent?.architect?.model === "openai/gpt-5.4", "architect model override was not written");
    assert(updatedConfig.agent?.general?.model === "openai/gpt-5.4", "general model override was not written");
    assert(updatedConfig.agent?.explore?.model === "openai/gpt-5.4", "explore model override was not written");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`FAIL: ${failure}`);
    }
    process.exit(1);
  }

  console.log("All integration checks passed.");
}

await main();
