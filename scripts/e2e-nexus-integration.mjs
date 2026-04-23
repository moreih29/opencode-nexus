#!/usr/bin/env bun

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PACKAGE_NAME, PACKAGE_SPEC, PACKAGE_VERSION } from "../lib/install-spec.mjs";

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function run(command, args, { cwd = process.cwd(), timeoutMs = 10000, env = process.env } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
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

function installMockOpencode(tempDir) {
  const binDir = join(tempDir, ".bin");
  const scriptPath = join(binDir, "opencode");
  mkdirSync(binDir, { recursive: true });
  Bun.write(scriptPath, "#!/usr/bin/env node\nif (process.argv[2] === 'models' && process.argv[3] === '--pure') {\n  process.stdout.write('openai/gpt-5.4\\nopenai/gpt-5.3\\n');\n  process.exit(0);\n}\nprocess.stderr.write('unsupported mock command\\n');\nprocess.exit(1);\n");
  chmodSync(scriptPath, 0o755);
  return {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
  };
}

function installCmuxShim(tempDir) {
  const binDir = join(tempDir, "cmux-bin");
  const logFile = join(tempDir, "cmux-calls.log");
  const scriptPath = join(binDir, "cmux");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    scriptPath,
    "#!/usr/bin/env node\nconst { appendFileSync } = require('node:fs');\nconst log = process.env.CMUX_TEST_LOG;\nif (log) {\n  try {\n    appendFileSync(log, JSON.stringify(process.argv.slice(2)) + '\\n');\n  } catch {}\n}\nprocess.exit(0);\n",
    "utf8",
  );
  chmodSync(scriptPath, 0o755);
  return { binDir, logFile };
}

function readCmuxCalls(logFile) {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function resetCmuxLog(logFile) {
  writeFileSync(logFile, "", "utf8");
}

async function waitForCmuxCalls(logFile, expectedCount, timeoutMs = 600) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const calls = readCmuxCalls(logFile);
    if (calls.length >= expectedCount) return calls;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  return readCmuxCalls(logFile);
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
    const cliEnv = installMockOpencode(tempDir);
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

    const installResult = await run("node", [resolve("bin/opencode-nexus.mjs"), "install", "--scope=project", "--skip-models"], {
      cwd: tempDir,
      env: cliEnv,
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
      env: cliEnv,
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

  const scenarioA = mkdtempSync(join(tmpdir(), "opencode-nexus-uninstall-a-"));
  try {
    const cliEnv = installMockOpencode(scenarioA);
    Bun.write(join(scenarioA, "opencode.json"), `${JSON.stringify({
      plugin: ["custom-plugin"],
      mcp: { other: { type: "local", command: ["other-mcp"] } },
    }, null, 2)}\n`);

    const installA = await run("node", [resolve("bin/opencode-nexus.mjs"), "install", "--scope=project", "--skip-models"], {
      cwd: scenarioA,
      env: cliEnv,
    });
    assert(installA.code === 0, `A: install failed: ${installA.stderr || installA.stdout}`);

    const uninstallA = await run("node", [resolve("bin/opencode-nexus.mjs"), "uninstall", "--scope=project", "--force"], {
      cwd: scenarioA,
      env: cliEnv,
    });
    assert(!uninstallA.timedOut, "A: uninstall timed out");
    assert(uninstallA.code === 0, `A: uninstall failed: ${uninstallA.stderr || uninstallA.stdout}`);

    const configPathA = join(scenarioA, "opencode.json");
    assert(existsSync(configPathA), "A: opencode.json must remain because custom-plugin/mcp.other survive");
    const cfgA = JSON.parse(readFileSync(configPathA, "utf8"));
    assert(Array.isArray(cfgA.plugin) && cfgA.plugin.length === 1 && cfgA.plugin[0] === "custom-plugin", "A: non-Nexus plugin entries must be preserved as sole entry");
    assert(cfgA.mcp?.nx === undefined, "A: mcp.nx must be removed");
    assert(cfgA.mcp?.other?.command?.[0] === "other-mcp", "A: unrelated mcp entries preserved");
    assert(cfgA.default_agent === undefined, "A: default_agent must be removed");
    assert(cfgA.agent?.build?.disable === undefined, "A: agent.build.disable must be removed");
    assert(cfgA.agent?.plan?.disable === undefined, "A: agent.plan.disable must be removed");
    assert(!existsSync(join(scenarioA, ".opencode", "skills", "nx-auto-plan")), "A: nx-auto-plan must be removed");
    assert(!existsSync(join(scenarioA, ".opencode", "skills", "nx-plan")), "A: nx-plan must be removed");
    assert(!existsSync(join(scenarioA, ".opencode", "skills", "nx-run")), "A: nx-run must be removed");
  } finally {
    rmSync(scenarioA, { recursive: true, force: true });
  }

  const scenarioB = mkdtempSync(join(tmpdir(), "opencode-nexus-uninstall-b-"));
  try {
    const cliEnv = installMockOpencode(scenarioB);
    const installB = await run("node", [resolve("bin/opencode-nexus.mjs"), "install", "--scope=project", "--skip-models"], {
      cwd: scenarioB,
      env: cliEnv,
    });
    assert(!installB.timedOut, "B: install timed out");
    assert(installB.code === 0, `B: install failed: ${installB.stderr || installB.stdout}`);

    const uninstallB = await run("node", [resolve("bin/opencode-nexus.mjs"), "uninstall", "--scope=project", "--force"], {
      cwd: scenarioB,
      env: cliEnv,
    });
    assert(!uninstallB.timedOut, "B: uninstall timed out");
    assert(uninstallB.code === 0, `B: uninstall failed: ${uninstallB.stderr || uninstallB.stdout}`);

    assert(!existsSync(join(scenarioB, "opencode.json")), "B: opencode.json must be deleted after full cleanup");
    assert(!existsSync(join(scenarioB, ".opencode", "skills")), "B: .opencode/skills must be deleted after full cleanup");
    assert(!existsSync(join(scenarioB, ".opencode")), "B: .opencode must be deleted when empty");
  } finally {
    rmSync(scenarioB, { recursive: true, force: true });
  }

  const scenarioC = mkdtempSync(join(tmpdir(), "opencode-nexus-uninstall-c-"));
  try {
    const cliEnv = installMockOpencode(scenarioC);
    const installC = await run("node", [resolve("bin/opencode-nexus.mjs"), "install", "--scope=project", "--skip-models"], {
      cwd: scenarioC,
      env: cliEnv,
    });
    assert(!installC.timedOut, "C: install timed out");
    assert(installC.code === 0, `C: install failed: ${installC.stderr || installC.stdout}`);

    const configPathC = join(scenarioC, "opencode.json");
    const driftedC = JSON.parse(readFileSync(configPathC, "utf8"));
    driftedC.default_agent = "my-custom-agent";
    driftedC.mcp = typeof driftedC.mcp === "object" && driftedC.mcp !== null ? { ...driftedC.mcp } : {};
    driftedC.mcp.nx = { type: "local", command: ["other-nexus-mcp"] };
    driftedC.agent = typeof driftedC.agent === "object" && driftedC.agent !== null ? { ...driftedC.agent } : {};
    driftedC.agent.build = typeof driftedC.agent.build === "object" && driftedC.agent.build !== null ? { ...driftedC.agent.build } : {};
    driftedC.agent.plan = typeof driftedC.agent.plan === "object" && driftedC.agent.plan !== null ? { ...driftedC.agent.plan } : {};
    driftedC.agent.build.disable = false;
    driftedC.agent.plan.model = "openai/gpt-5.4";
    Bun.write(configPathC, `${JSON.stringify(driftedC, null, 2)}\n`);

    const uninstallC = await run("node", [resolve("bin/opencode-nexus.mjs"), "uninstall", "--scope=project", "--force"], {
      cwd: scenarioC,
      env: cliEnv,
    });
    assert(!uninstallC.timedOut, "C: uninstall timed out");
    assert(uninstallC.code === 0, `C: uninstall failed: ${uninstallC.stderr || uninstallC.stdout}`);

    assert(existsSync(configPathC), "C: opencode.json must remain because agent.plan.model survives");
    const cfgC = JSON.parse(readFileSync(configPathC, "utf8"));
    const pluginListC = Array.isArray(cfgC.plugin) ? cfgC.plugin : [];
    assert(!pluginListC.some((entry) => typeof entry === "string" && entry.startsWith("opencode-nexus")), "C: Nexus plugin entries must be removed under --force");
    assert(cfgC.mcp?.nx === undefined, "C: mcp.nx must be removed under --force");
    assert(cfgC.default_agent === undefined, "C: default_agent must be removed under --force");
    assert(cfgC.agent?.build === undefined, "C: agent.build must be removed after deleting disable-only leaf");
    assert(cfgC.agent?.plan?.model === "openai/gpt-5.4", "C: agent.plan.model must be preserved");
    assert(cfgC.agent?.plan?.disable === undefined, "C: agent.plan.disable must be removed");
    assert(!existsSync(join(scenarioC, ".opencode", "skills", "nx-auto-plan")), "C: nx-auto-plan must be removed");
    assert(!existsSync(join(scenarioC, ".opencode", "skills", "nx-plan")), "C: nx-plan must be removed");
    assert(!existsSync(join(scenarioC, ".opencode", "skills", "nx-run")), "C: nx-run must be removed");
  } finally {
    rmSync(scenarioC, { recursive: true, force: true });
  }

  const scenarioD = mkdtempSync(join(tmpdir(), "opencode-nexus-uninstall-d-"));
  try {
    const cliEnv = installMockOpencode(scenarioD);
    const installD = await run("node", [resolve("bin/opencode-nexus.mjs"), "install", "--scope=project", "--skip-models"], {
      cwd: scenarioD,
      env: cliEnv,
    });
    assert(!installD.timedOut, "D: install timed out");
    assert(installD.code === 0, `D: install failed: ${installD.stderr || installD.stdout}`);

    const configPathD = join(scenarioD, "opencode.json");
    const beforeD = readFileSync(configPathD, "utf8");

    const uninstallD = await run("node", [resolve("bin/opencode-nexus.mjs"), "uninstall", "--scope=project"], {
      cwd: scenarioD,
      env: cliEnv,
    });
    assert(!uninstallD.timedOut, "D: uninstall timed out");
    assert(uninstallD.code !== 0, "D: uninstall without --force must fail in non-interactive mode");
    assert((uninstallD.stderr || uninstallD.stdout).includes("Use --force for non-interactive removal"), "D: expected non-interactive force guidance message");

    const afterD = readFileSync(configPathD, "utf8");
    assert(afterD === beforeD, "D: opencode.json must remain unchanged on failed uninstall");
    assert(existsSync(join(scenarioD, ".opencode", "skills", "nx-plan", "SKILL.md")), "D: skills must remain unchanged on failed uninstall");
  } finally {
    rmSync(scenarioD, { recursive: true, force: true });
  }

  const versionFlag = await run("node", [resolve("bin/opencode-nexus.mjs"), "--version"]);
  assert(!versionFlag.timedOut, "E: --version timed out");
  assert(versionFlag.code === 0, `E: --version failed: ${versionFlag.stderr || versionFlag.stdout}`);
  assert(versionFlag.stdout.trim() === `${PACKAGE_NAME} ${PACKAGE_VERSION}`, "E: --version output must match package name/version");

  const versionCommand = await run("node", [resolve("bin/opencode-nexus.mjs"), "version"]);
  assert(!versionCommand.timedOut, "E: version command timed out");
  assert(versionCommand.code === 0, `E: version command failed: ${versionCommand.stderr || versionCommand.stdout}`);
  assert(versionCommand.stdout.trim() === `${PACKAGE_NAME} ${PACKAGE_VERSION}`, "E: version command output must match package name/version");

  const cmuxTempDir = mkdtempSync(join(tmpdir(), "opencode-nexus-cmux-"));
  const originalPath = process.env.PATH;
  const originalWorkspaceID = process.env.CMUX_WORKSPACE_ID;
  const originalCmuxTestLog = process.env.CMUX_TEST_LOG;
  const originalCmuxDisable = process.env.OPENCODE_NEXUS_CMUX;

  try {
    const { binDir, logFile } = installCmuxShim(cmuxTempDir);
    process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
    process.env.CMUX_WORKSPACE_ID = "test-workspace";
    process.env.CMUX_TEST_LOG = logFile;
    delete process.env.OPENCODE_NEXUS_CMUX;

    const cmuxHooks = await pluginModule.default({ directory: process.cwd() });
    assert(typeof cmuxHooks.event === "function", "cmux-a: event hook must exist");
    assert(typeof cmuxHooks["permission.ask"] === "function", "cmux-a: permission.ask hook must exist");

    const rootSessionID = "root-session-1";
    const otherSessionID = "other-session-1";
    await cmuxHooks.event({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: rootSessionID,
            parentID: undefined,
          },
        },
      },
    });

    resetCmuxLog(logFile);
    await cmuxHooks["permission.ask"]({ sessionID: rootSessionID }, { status: "ask" });
    const callsA = await waitForCmuxCalls(logFile, 2);
    assert(
      callsA.some((call) => call[0] === "notify" && call[1] === "--title" && call[2] === "opencode-nexus" && call[3] === "--body" && call[4] === "Permission requested"),
      `cmux-a: permission.ask must notify expected args, got ${JSON.stringify(callsA)}`,
    );
    assert(
      callsA.some((call) => call[0] === "set-status" && call[1] === "nexus-state" && call[2] === "Needs Input" && call[3] === "--icon" && call[4] === "bell" && call[5] === "--color" && call[6] === "#007AFF"),
      `cmux-a: permission.ask must set Needs Input pill, got ${JSON.stringify(callsA)}`,
    );

    resetCmuxLog(logFile);
    await cmuxHooks.event({
      event: {
        type: "session.status",
        properties: {
          sessionID: rootSessionID,
          status: { type: "busy" },
        },
      },
    });
    const callsB = await waitForCmuxCalls(logFile, 1);
    assert(
      callsB.some((call) => call[0] === "set-status" && call[1] === "nexus-state" && call[2] === "Running" && call[3] === "--icon" && call[4] === "bolt" && call[5] === "--color" && call[6] === "#007AFF"),
      `cmux-b: root busy must set Running pill, got ${JSON.stringify(callsB)}`,
    );

    resetCmuxLog(logFile);
    await cmuxHooks.event({
      event: {
        type: "session.status",
        properties: {
          sessionID: otherSessionID,
          status: { type: "busy" },
        },
      },
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    const callsC = readCmuxCalls(logFile);
    assert(callsC.length === 0, `cmux-c: non-root busy must not spawn cmux, got ${JSON.stringify(callsC)}`);

    resetCmuxLog(logFile);
    await cmuxHooks.event({
      event: {
        type: "permission.replied",
        properties: {
          sessionID: rootSessionID,
          permissionID: "perm-1",
          response: "allow",
        },
      },
    });
    const callsD = await waitForCmuxCalls(logFile, 1);
    assert(
      callsD.some((call) => call[0] === "clear-status" && call[1] === "nexus-state"),
      `cmux-d: permission.replied must clear status pill, got ${JSON.stringify(callsD)}`,
    );

    resetCmuxLog(logFile);
    await cmuxHooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: rootSessionID,
          error: { message: "boom" },
        },
      },
    });
    const callsE = await waitForCmuxCalls(logFile, 2);
    assert(
      callsE.some((call) => call[0] === "log" && call[1] === "--level" && call[2] === "error" && call[3] === "--source" && call[4] === "nexus" && call[5] === "--" && call[6] === "boom"),
      `cmux-e: session.error must write error log, got ${JSON.stringify(callsE)}`,
    );
    assert(
      callsE.some((call) => call[0] === "notify" && call[1] === "--title" && call[2] === "opencode-nexus" && call[3] === "--body" && call[4] === "Session error"),
      `cmux-e: session.error must notify Session error, got ${JSON.stringify(callsE)}`,
    );

    resetCmuxLog(logFile);
    process.env.OPENCODE_NEXUS_CMUX = "0";
    await cmuxHooks["permission.ask"]({ sessionID: rootSessionID }, { status: "ask" });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    const callsF = readCmuxCalls(logFile);
    assert(callsF.length === 0, `cmux-f: disabled mode must not spawn cmux, got ${JSON.stringify(callsF)}`);

    delete process.env.OPENCODE_NEXUS_CMUX;
    resetCmuxLog(logFile);
    await cmuxHooks.event({
      event: {
        type: "session.idle",
        properties: {
          sessionID: rootSessionID,
        },
      },
    });
    const callsG = await waitForCmuxCalls(logFile, 2);
    assert(
      callsG.some((call) => call[0] === "notify" && call[1] === "--title" && call[2] === "opencode-nexus" && call[3] === "--body" && call[4] === "Response ready"),
      `cmux-g: session.idle must keep Response ready notify, got ${JSON.stringify(callsG)}`,
    );
    assert(
      callsG.some((call) => call[0] === "clear-status" && call[1] === "nexus-state"),
      `cmux-g: session.idle must clear status pill, got ${JSON.stringify(callsG)}`,
    );
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalWorkspaceID === undefined) delete process.env.CMUX_WORKSPACE_ID;
    else process.env.CMUX_WORKSPACE_ID = originalWorkspaceID;
    if (originalCmuxTestLog === undefined) delete process.env.CMUX_TEST_LOG;
    else process.env.CMUX_TEST_LOG = originalCmuxTestLog;
    if (originalCmuxDisable === undefined) delete process.env.OPENCODE_NEXUS_CMUX;
    else process.env.OPENCODE_NEXUS_CMUX = originalCmuxDisable;
    rmSync(cmuxTempDir, { recursive: true, force: true });
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
