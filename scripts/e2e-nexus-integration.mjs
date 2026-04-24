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

function countOccurrences(content, pattern) {
  return [...content.matchAll(pattern)].length;
}

function parseJsonToolOutput(output) {
  return typeof output === "string" ? JSON.parse(output) : output;
}

function installFakeTimers() {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const timers = [];
  let nextID = 1;
  globalThis.setTimeout = (callback, delay = 0, ...args) => {
    const id = nextID++;
    timers.push({ id, callback, delay, args, cleared: false });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    const timer = timers.find((entry) => entry.id === id);
    if (timer) timer.cleared = true;
  };

  return {
    async runTimersByTime(ms) {
      const due = timers.filter((timer) => !timer.cleared && timer.delay <= ms);
      for (const timer of due) {
        timer.cleared = true;
        timer.callback(...timer.args);
        await Promise.resolve();
      }
    },
    restore() {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
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

  const asyncCalls = { create: [], promptAsync: [], messages: [] };
  const asyncClient = {
    session: {
      create: async (request) => {
        asyncCalls.create.push(request);
        return { data: { id: `child-${asyncCalls.create.length}` } };
      },
      promptAsync: (request) => {
        asyncCalls.promptAsync.push(request);
        return new Promise(() => {});
      },
      messages: async (request) => {
        asyncCalls.messages.push(request);
        return {
          data: [
            { info: { role: "user" }, parts: [{ type: "text", text: "original prompt" }] },
            { info: { role: "assistant" }, parts: [{ type: "text", text: "child result text" }] },
          ],
        };
      },
    },
  };
  const asyncHooks = await pluginModule.default({ directory: process.cwd(), client: asyncClient });
  const fakeTimers = installFakeTimers();
  try {
    const spawnStartedAt = Date.now();
    const spawnOutput = parseJsonToolOutput(await asyncHooks.tool.nexus_spawn.execute(
      { agent_id: "tester", prompt: "verify async retry", description: "Async retry e2e" },
      { sessionID: "root-async-retry", metadata: () => {} },
    ));
    assert(Date.now() - spawnStartedAt < 100, "async-a: nexus_spawn must return { task_id } within 100ms while promptAsync is pending");
    assert(spawnOutput.task_id === "child-1", `async-a: nexus_spawn must return child task_id, got ${JSON.stringify(spawnOutput)}`);
    assert(asyncCalls.create[0]?.body?.parentID === "root-async-retry", `async-a: session.create body must include parentID, got ${JSON.stringify(asyncCalls.create[0])}`);
    assert(asyncCalls.promptAsync.length === 1, `async-a: initial promptAsync must be called once, got ${asyncCalls.promptAsync.length}`);
    await fakeTimers.runTimersByTime(3000);
    assert(asyncCalls.promptAsync.length === 2, `async-a: watchdog must retry promptAsync once after 3s without busy, got ${asyncCalls.promptAsync.length}`);
    await fakeTimers.runTimersByTime(3000);
    const retryResult = parseJsonToolOutput(await asyncHooks.tool.nexus_result.execute({ task_id: "child-1" }));
    assert(retryResult.status === "error" && retryResult.error === "idle session wake failed", `async-a: second watchdog timeout must set error status, got ${JSON.stringify(retryResult)}`);

    const resultOutput = parseJsonToolOutput(await asyncHooks.tool.nexus_spawn.execute(
      { agent_id: "tester", prompt: "produce result", description: "Async result e2e" },
      { sessionID: "root-async-result", metadata: () => {} },
    ));
    await asyncHooks.event({ event: { type: "session.status", properties: { sessionID: resultOutput.task_id, status: { type: "busy" } } } });
    await asyncHooks.event({ event: { type: "session.idle", properties: { sessionID: resultOutput.task_id } } });
    const messagesBeforeResult = asyncCalls.messages.length;
    const completedResult = parseJsonToolOutput(await asyncHooks.tool.nexus_result.execute({ task_id: resultOutput.task_id }));
    assert(asyncCalls.messages.length === messagesBeforeResult + 1, "async-b: nexus_result for a completed child must explicitly call client.session.messages");
    assert(completedResult.status === "completed" && completedResult.result === "child result text", `async-b: nexus_result must return latest assistant result, got ${JSON.stringify(completedResult)}`);
    await asyncHooks.event({ event: { type: "session.deleted", properties: { info: { id: resultOutput.task_id } } } });
    const deletedResult = parseJsonToolOutput(await asyncHooks.tool.nexus_result.execute({ task_id: resultOutput.task_id }));
    assert(deletedResult.status === "error" && deletedResult.error?.includes("unknown task_id"), `async-b: deleted child task must return unknown/cleaned response, got ${JSON.stringify(deletedResult)}`);

    const rootCleanupOutput = parseJsonToolOutput(await asyncHooks.tool.nexus_spawn.execute(
      { agent_id: "tester", prompt: "root cleanup", description: "Root cleanup e2e" },
      { sessionID: "root-async-cleanup", metadata: () => {} },
    ));
    await asyncHooks.event({ event: { type: "session.deleted", properties: { info: { id: "root-async-cleanup" } } } });
    const rootDeletedResult = parseJsonToolOutput(await asyncHooks.tool.nexus_result.execute({ task_id: rootCleanupOutput.task_id }));
    assert(rootDeletedResult.status === "error" && rootDeletedResult.error?.includes("unknown task_id"), `async-b: root session deletion must clean child tasks, got ${JSON.stringify(rootDeletedResult)}`);
  } finally {
    fakeTimers.restore();
  }

  const dryRun = await run("./node_modules/.bin/nexus-sync", ["--harness=opencode", "--target=./", "--dry-run"]);
  assert(!dryRun.timedOut, "sync --dry-run timed out");
  assert(dryRun.code === 0, `sync --dry-run failed: ${dryRun.stderr || dryRun.stdout}`);

  const syncResult = await run("bun", ["run", "sync"], { timeoutMs: 20000 });
  assert(!syncResult.timedOut, "post-sync-a: bun run sync timed out");
  assert(syncResult.code === 0, `post-sync-a: bun run sync failed: ${syncResult.stderr || syncResult.stdout}`);

  const requiredPaths = [
    "skills/nx-auto-plan/SKILL.md",
    "skills/nx-plan/SKILL.md",
    "skills/nx-run/SKILL.md",
  ];

  for (const relativePath of requiredPaths) {
    assert(existsSync(resolve(relativePath)), `missing synced file: ${relativePath}`);
  }

  // Verify the bundled skill bodies at `skills/*` (root) — these are the
  // files shipped via `package.json` `files: ["skills", ...]`, so users
  // only receive async-enabled skills if the rewrite lands here.
  for (const relativePath of ["skills/nx-plan/SKILL.md", "skills/nx-auto-plan/SKILL.md"]) {
    const content = readFileSync(resolve(relativePath), "utf8");
    assert(countOccurrences(content, /nexus_spawn\(/g) >= 1, `post-sync-a: ${relativePath} must contain nexus_spawn(`);
    assert(countOccurrences(content, /task\(\{\s*subagent_type:/g) === 0, `post-sync-a: ${relativePath} must not retain task({ subagent_type: patterns`);
    assert(countOccurrences(content, /task\(\{\s*task_id:/g) >= 1, `post-sync-a: ${relativePath} must preserve task({ task_id: resume patterns`);
  }

  const asyncifyNegativeDir = mkdtempSync(join(tmpdir(), "opencode-nexus-asyncify-negative-"));
  try {
    const negativeScript = join(asyncifyNegativeDir, "post-sync-asyncify-wrong-count.mjs");
    const originalScript = readFileSync(resolve("scripts/post-sync-asyncify.mjs"), "utf8");
    writeFileSync(negativeScript, originalScript.replace("const expectedReplacementCount = 8;", "const expectedReplacementCount = 999;"), "utf8");
    const negativeResult = await run("node", [negativeScript, "--dry-run"], { timeoutMs: 10000 });
    assert(!negativeResult.timedOut, "post-sync-a: wrong expected count negative test timed out");
    assert(negativeResult.code !== 0, "post-sync-a: wrong expected count negative test must fail non-zero");
    assert(negativeResult.stderr.includes("Likely causes:"), "post-sync-a: wrong expected count negative test must print diagnostic hints");
  } finally {
    rmSync(asyncifyNegativeDir, { recursive: true, force: true });
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
  const originalCmuxPreview = process.env.OPENCODE_NEXUS_NOTIFY_PREVIEW;

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
      callsA.some((call) => call[0] === "set-status" && call[1] === "nexus-state" && call[2] === "Needs Input" && call[3] === "--icon" && call[4] === "bell.fill" && call[5] === "--color" && call[6] === "#007AFF"),
      `cmux-a: permission.ask must set Needs Input pill (bell.fill icon), got ${JSON.stringify(callsA)}`,
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
    // On the first idle→running transition we now clear cmux sidebar logs
    // before setting Running (plan issue 1 source-of-truth).
    const callsB = await waitForCmuxCalls(logFile, 2);
    assert(
      callsB.filter((call) => call[0] === "clear-log").length === 1,
      `cmux-b: first root busy must clear cmux log exactly once, got ${JSON.stringify(callsB)}`,
    );
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
    // session.error now spawns 3 cmux commands (log + notify + clear-status).
    // We wait for all 3 to drain so a late-arriving clear-status does not
    // bleed into cmux-f's reset log. cmux-e keeps its original assertions
    // (log + notify); the clear-status semantic is covered by cmux-h below.
    const callsE = await waitForCmuxCalls(logFile, 3);
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
      callsG.some(
        (call) =>
          call[0] === "set-status" &&
          call[1] === "nexus-state" &&
          call[2] === "Needs Input" &&
          call[3] === "--icon" &&
          call[4] === "bell.fill" &&
          call[5] === "--color" &&
          call[6] === "#007AFF",
      ),
      `cmux-g: session.idle must set Needs Input pill with bell.fill icon (so sidebar reflects the user's turn), got ${JSON.stringify(callsG)}`,
    );

    // cmux-h removed in v0.16.3 — see cmux-r below for the new MessageAbortedError UX.

    // cmux-i: session.status with status.type === "idle" on a root session must
    // clear the status pill. This backs up session.idle and covers paths where
    // the session emits a status=idle transition without an accompanying
    // session.idle event (observed on abort / error in cmux workspace logs).
    resetCmuxLog(logFile);
    await cmuxHooks.event({
      event: {
        type: "session.status",
        properties: {
          sessionID: rootSessionID,
          status: { type: "idle" },
        },
      },
    });
    const callsI = await waitForCmuxCalls(logFile, 1);
    assert(
      callsI.some(
        (call) =>
          call[0] === "set-status" &&
          call[1] === "nexus-state" &&
          call[2] === "Needs Input" &&
          call[3] === "--icon" &&
          call[4] === "bell.fill" &&
          call[5] === "--color" &&
          call[6] === "#007AFF",
      ),
      `cmux-i: session.status idle must set Needs Input pill with bell.fill icon (backup path when session.idle does not fire), got ${JSON.stringify(callsI)}`,
    );

    // cmux-j: session.error on a non-root session must not spawn any cmux
    // command. Regression guard so future edits to session.error do not leak
    // clears through the non-root branch. Note: otherSessionID was not added
    // to rootSessions via session.created, so the plugin's guard
    // (sessionID && !rootSessions.has(sessionID)) must early-return.
    resetCmuxLog(logFile);
    await cmuxHooks.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: otherSessionID,
          error: { message: "non-root boom" },
        },
      },
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    const callsJ = readCmuxCalls(logFile);
    assert(callsJ.length === 0, `cmux-j: non-root session.error must not spawn cmux, got ${JSON.stringify(callsJ)}`);

    // cmux-k: cmuxSpawn must serialize cmux CLI invocations so that when set
    // and clear commands are issued rapidly, the final cmux server state
    // matches the last command the plugin emitted. Previously fire-and-forget
    // detached spawns could let `set-status` land after `clear-status` due to
    // OS fork scheduling, leaving the pill stuck. We emit busy/idle pairs 10
    // times and assert the last logged cmux call is clear-status.
    resetCmuxLog(logFile);
    for (let i = 0; i < 10; i++) {
      await cmuxHooks.event({
        event: {
          type: "session.status",
          properties: { sessionID: rootSessionID, status: { type: "busy" } },
        },
      });
      await cmuxHooks.event({
        event: {
          type: "session.status",
          properties: { sessionID: rootSessionID, status: { type: "idle" } },
        },
      });
    }
    const callsK = await waitForCmuxCalls(logFile, 30, 3000);
    assert(callsK.length >= 30, `cmux-k: expected >= 30 serialized cmux calls, got ${callsK.length}`);
    const lastK = callsK[callsK.length - 1];
    // With session.status idle now transitioning the pill to Needs Input
    // (not clear), the last cmux call in a busy→idle ping-pong must be
    // set-status Needs Input. A race would have left the final Running set
    // after the last clear/idle-set, so checking Needs Input as the last
    // entry continues to prove serialize ordering.
    assert(
      lastK[0] === "set-status" &&
        lastK[1] === "nexus-state" &&
        lastK[2] === "Needs Input",
      `cmux-k: last serialized call must be set-status Needs Input (race would put Running last), got ${JSON.stringify(lastK)}`,
    );

    // cmux-l: session.idle notify body must preview the last assistant text
    // part when OPENCODE_NEXUS_NOTIFY_PREVIEW is not opt-out. In v0.16.2 the
    // preview cache only accepts text parts that arrive *after* a
    // `step-start` marker, so the scenario now emits step-start first.
    resetCmuxLog(logFile);
    await cmuxHooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-l-step",
            sessionID: rootSessionID,
            messageID: "msg-l",
            type: "step-start",
          },
        },
      },
    });
    await cmuxHooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-l",
            sessionID: rootSessionID,
            messageID: "msg-l",
            type: "text",
            text: "Hello, this is the assistant response body.",
          },
        },
      },
    });
    await cmuxHooks.event({
      event: {
        type: "session.idle",
        properties: { sessionID: rootSessionID },
      },
    });
    const callsL = await waitForCmuxCalls(logFile, 2);
    const notifyL = callsL.find((call) => call[0] === "notify");
    assert(notifyL, `cmux-l: session.idle must fire notify, got ${JSON.stringify(callsL)}`);
    const bodyL = notifyL[notifyL.indexOf("--body") + 1];
    assert(
      bodyL.includes("Hello, this is the assistant response"),
      `cmux-l: notify body must preview assistant text, got "${bodyL}"`,
    );
    assert(
      bodyL !== "Response ready",
      `cmux-l: body must not be fallback when preview text is available, got "${bodyL}"`,
    );

    // cmux-m: When the assistant response opens with a [Pre-check] scaffold
    // block, the preview must skip the block and show the body that follows.
    // step-start precedes the text part as v0.16.2 requires.
    resetCmuxLog(logFile);
    await cmuxHooks.event({
      event: {
        type: "session.status",
        properties: { sessionID: rootSessionID, status: { type: "busy" } },
      },
    });
    await cmuxHooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-m-step",
            sessionID: rootSessionID,
            messageID: "msg-m",
            type: "step-start",
          },
        },
      },
    });
    await cmuxHooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-m",
            sessionID: rootSessionID,
            messageID: "msg-m",
            type: "text",
            text: "[Pre-check]\n- goal: test preview\n- approach: verify\n\n실제 본문은 여기서 시작합니다.",
          },
        },
      },
    });
    await cmuxHooks.event({
      event: {
        type: "session.idle",
        properties: { sessionID: rootSessionID },
      },
    });
    const callsM = await waitForCmuxCalls(logFile, 4);
    const notifyM = callsM.find((call) => call[0] === "notify");
    assert(notifyM, `cmux-m: session.idle must fire notify, got ${JSON.stringify(callsM)}`);
    const bodyM = notifyM[notifyM.indexOf("--body") + 1];
    assert(
      !bodyM.includes("[Pre-check]"),
      `cmux-m: Pre-check marker must be stripped from preview, got "${bodyM}"`,
    );
    assert(
      bodyM.includes("실제 본문"),
      `cmux-m: body after Pre-check block must be previewed, got "${bodyM}"`,
    );

    // cmux-n: OPENCODE_NEXUS_NOTIFY_PREVIEW=0 must force the fallback body
    // even when preview text is cached. User-visible opt-out semantics.
    resetCmuxLog(logFile);
    process.env.OPENCODE_NEXUS_NOTIFY_PREVIEW = "0";
    await cmuxHooks.event({
      event: {
        type: "session.status",
        properties: { sessionID: rootSessionID, status: { type: "busy" } },
      },
    });
    await cmuxHooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-n-step",
            sessionID: rootSessionID,
            messageID: "msg-n",
            type: "step-start",
          },
        },
      },
    });
    await cmuxHooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-n",
            sessionID: rootSessionID,
            messageID: "msg-n",
            type: "text",
            text: "This sensitive response must NOT leak into the notification.",
          },
        },
      },
    });
    await cmuxHooks.event({
      event: {
        type: "session.idle",
        properties: { sessionID: rootSessionID },
      },
    });
    const callsN = await waitForCmuxCalls(logFile, 4);
    delete process.env.OPENCODE_NEXUS_NOTIFY_PREVIEW;
    const notifyN = callsN.find((call) => call[0] === "notify");
    assert(notifyN, `cmux-n: session.idle must fire notify, got ${JSON.stringify(callsN)}`);
    const bodyN = notifyN[notifyN.indexOf("--body") + 1];
    assert(
      bodyN === "Response ready",
      `cmux-n: opt-out flag must force fallback body, got "${bodyN}"`,
    );

    // cmux-o: Without any message.part.updated text, session.idle must still
    // emit a notify with the fallback body so the user is not left silent.
    resetCmuxLog(logFile);
    await cmuxHooks.event({
      event: {
        type: "session.status",
        properties: { sessionID: rootSessionID, status: { type: "busy" } },
      },
    });
    await cmuxHooks.event({
      event: {
        type: "session.idle",
        properties: { sessionID: rootSessionID },
      },
    });
    const callsO = await waitForCmuxCalls(logFile, 4);
    const notifyO = callsO.find((call) => call[0] === "notify");
    assert(notifyO, `cmux-o: session.idle must fire notify even without prior text, got ${JSON.stringify(callsO)}`);
    const bodyO = notifyO[notifyO.indexOf("--body") + 1];
    assert(
      bodyO === "Response ready",
      `cmux-o: empty-cache fallback must be "Response ready", got "${bodyO}"`,
    );

    // cmux-p: When a new assistant step-start arrives, the per-session text
    // cache must be cleared, so a stale text part (e.g. the user input text
    // or an aborted prior turn) cannot leak into the next turn's preview.
    // This replaces the v0.16.0/0.16.1 busy-based reset which v0.16.2 removed
    // after empirical evidence that OpenCode fires busy mid-turn.
    resetCmuxLog(logFile);
    await cmuxHooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-p-prior-step",
            sessionID: rootSessionID,
            messageID: "msg-p-prior",
            type: "step-start",
          },
        },
      },
    });
    await cmuxHooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-p-prior",
            sessionID: rootSessionID,
            messageID: "msg-p-prior",
            type: "text",
            text: "Previous turn response that must not leak.",
          },
        },
      },
    });
    await cmuxHooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-p-new-step",
            sessionID: rootSessionID,
            messageID: "msg-p-new",
            type: "step-start",
          },
        },
      },
    });
    await cmuxHooks.event({
      event: {
        type: "session.idle",
        properties: { sessionID: rootSessionID },
      },
    });
    const callsP = await waitForCmuxCalls(logFile, 2);
    const notifyP = callsP.find((call) => call[0] === "notify");
    assert(notifyP, `cmux-p: session.idle must fire notify, got ${JSON.stringify(callsP)}`);
    const bodyP = notifyP[notifyP.indexOf("--body") + 1];
    assert(
      !bodyP.includes("Previous turn"),
      `cmux-p: prior turn text must be cleared by the new step-start, got "${bodyP}"`,
    );
    assert(
      bodyP === "Response ready",
      `cmux-p: after step-start reset with no new text, body must fall back to "Response ready", got "${bodyP}"`,
    );

    // cmux-q: Text parts that arrive *without* a preceding step-start marker
    // (e.g. the user's input text) must NOT enter the preview cache. This
    // guards against user input leaking into the "Response ready" preview
    // when the assistant returns a tool-only or empty-text turn.
    resetCmuxLog(logFile);
    await cmuxHooks.event({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-q-user",
            sessionID: rootSessionID,
            messageID: "msg-q-user",
            type: "text",
            text: "This is a user input text that must not be cached as preview.",
          },
        },
      },
    });
    await cmuxHooks.event({
      event: {
        type: "session.idle",
        properties: { sessionID: rootSessionID },
      },
    });
    const callsQ = await waitForCmuxCalls(logFile, 2);
    const notifyQ = callsQ.find((call) => call[0] === "notify");
    assert(notifyQ, `cmux-q: session.idle must fire notify, got ${JSON.stringify(callsQ)}`);
    const bodyQ = notifyQ[notifyQ.indexOf("--body") + 1];
    assert(
      bodyQ === "Response ready",
      `cmux-q: text without preceding step-start must not be cached (fallback expected), got "${bodyQ}"`,
    );
    assert(
      !bodyQ.includes("user input"),
      `cmux-q: user input text must not leak into preview, got "${bodyQ}"`,
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
    if (originalCmuxPreview === undefined) delete process.env.OPENCODE_NEXUS_NOTIFY_PREVIEW;
    else process.env.OPENCODE_NEXUS_NOTIFY_PREVIEW = originalCmuxPreview;
    rmSync(cmuxTempDir, { recursive: true, force: true });
  }

  const cmuxScenarioRDir = mkdtempSync(join(tmpdir(), "opencode-nexus-cmux-r-"));
  const originalPathR = process.env.PATH;
  const originalWorkspaceIDR = process.env.CMUX_WORKSPACE_ID;
  const originalCmuxTestLogR = process.env.CMUX_TEST_LOG;
  const originalCmuxDisableR = process.env.OPENCODE_NEXUS_CMUX;
  try {
    const { binDir, logFile } = installCmuxShim(cmuxScenarioRDir);
    process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
    process.env.CMUX_WORKSPACE_ID = "test-workspace-r";
    process.env.CMUX_TEST_LOG = logFile;
    delete process.env.OPENCODE_NEXUS_CMUX;

    const cmuxHooksR = await pluginModule.default({ directory: process.cwd() });
    const rootSessionIDR = "root-session-r";
    await cmuxHooksR.event({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: rootSessionIDR,
            parentID: undefined,
          },
        },
      },
    });

    resetCmuxLog(logFile);
    await cmuxHooksR.event({
      event: {
        type: "session.status",
        properties: {
          sessionID: rootSessionIDR,
          status: { type: "busy" },
        },
      },
    });
    await cmuxHooksR.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: rootSessionIDR,
          error: { name: "MessageAbortedError", message: "Request aborted" },
        },
      },
    });
    const callsR = await waitForCmuxCalls(logFile, 3);
    assert(
      callsR.some((call) => call[0] === "set-status" && call[1] === "nexus-state" && call[2] === "Running" && call[3] === "--icon" && call[4] === "bolt" && call[5] === "--color" && call[6] === "#007AFF"),
      `cmux-r: pre-abort busy must set Running pill, got ${JSON.stringify(callsR)}`,
    );
    assert(
      callsR.some((call) => call[0] === "set-status" && call[1] === "nexus-state" && call[2] === "Needs Input" && call[3] === "--icon" && call[4] === "bell.fill" && call[5] === "--color" && call[6] === "#007AFF"),
      `cmux-r: MessageAbortedError must switch pill to Needs Input, got ${JSON.stringify(callsR)}`,
    );
    assert(
      !callsR.some((call) => call[0] === "notify" && call[1] === "--title" && call[2] === "opencode-nexus" && call[3] === "--body" && call[4] === "Session error"),
      `cmux-r: MessageAbortedError must not notify Session error, got ${JSON.stringify(callsR)}`,
    );
    assert(
      !callsR.some((call) => call[0] === "log" && call[1] === "--level" && call[2] === "error" && call[3] === "--source" && call[4] === "nexus"),
      `cmux-r: MessageAbortedError must not write error log, got ${JSON.stringify(callsR)}`,
    );
  } finally {
    if (originalPathR === undefined) delete process.env.PATH;
    else process.env.PATH = originalPathR;
    if (originalWorkspaceIDR === undefined) delete process.env.CMUX_WORKSPACE_ID;
    else process.env.CMUX_WORKSPACE_ID = originalWorkspaceIDR;
    if (originalCmuxTestLogR === undefined) delete process.env.CMUX_TEST_LOG;
    else process.env.CMUX_TEST_LOG = originalCmuxTestLogR;
    if (originalCmuxDisableR === undefined) delete process.env.OPENCODE_NEXUS_CMUX;
    else process.env.OPENCODE_NEXUS_CMUX = originalCmuxDisableR;
    rmSync(cmuxScenarioRDir, { recursive: true, force: true });
  }

  const cmuxScenarioSDir = mkdtempSync(join(tmpdir(), "opencode-nexus-cmux-s-"));
  const originalPathS = process.env.PATH;
  const originalWorkspaceIDS = process.env.CMUX_WORKSPACE_ID;
  const originalCmuxTestLogS = process.env.CMUX_TEST_LOG;
  const originalCmuxDisableS = process.env.OPENCODE_NEXUS_CMUX;
  try {
    const { binDir, logFile } = installCmuxShim(cmuxScenarioSDir);
    process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
    process.env.CMUX_WORKSPACE_ID = "test-workspace-s";
    process.env.CMUX_TEST_LOG = logFile;
    delete process.env.OPENCODE_NEXUS_CMUX;

    const cmuxHooksS = await pluginModule.default({ directory: process.cwd() });
    const rootSessionIDS = "root-session-s";
    await cmuxHooksS.event({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: rootSessionIDS,
            parentID: undefined,
          },
        },
      },
    });

    resetCmuxLog(logFile);
    await cmuxHooksS.event({
      event: {
        type: "session.status",
        properties: {
          sessionID: rootSessionIDS,
          status: { type: "busy" },
        },
      },
    });
    await cmuxHooksS.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: rootSessionIDS,
          error: { name: "DatabaseError", message: "connection refused" },
        },
      },
    });
    const callsS = await waitForCmuxCalls(logFile, 5);
    assert(
      callsS.some((call) => call[0] === "log" && call[1] === "--level" && call[2] === "error" && call[3] === "--source" && call[4] === "nexus"),
      `cmux-s: non-abort session.error must write error log, got ${JSON.stringify(callsS)}`,
    );
    assert(
      callsS.some((call) => call[0] === "notify" && call[1] === "--title" && call[2] === "opencode-nexus" && call[3] === "--body" && call[4] === "Session error"),
      `cmux-s: non-abort session.error must notify Session error, got ${JSON.stringify(callsS)}`,
    );
    assert(
      callsS.some((call) => call[0] === "clear-status" && call[1] === "nexus-state"),
      `cmux-s: non-abort session.error must clear status pill, got ${JSON.stringify(callsS)}`,
    );
  } finally {
    if (originalPathS === undefined) delete process.env.PATH;
    else process.env.PATH = originalPathS;
    if (originalWorkspaceIDS === undefined) delete process.env.CMUX_WORKSPACE_ID;
    else process.env.CMUX_WORKSPACE_ID = originalWorkspaceIDS;
    if (originalCmuxTestLogS === undefined) delete process.env.CMUX_TEST_LOG;
    else process.env.CMUX_TEST_LOG = originalCmuxTestLogS;
    if (originalCmuxDisableS === undefined) delete process.env.OPENCODE_NEXUS_CMUX;
    else process.env.OPENCODE_NEXUS_CMUX = originalCmuxDisableS;
    rmSync(cmuxScenarioSDir, { recursive: true, force: true });
  }

  const cmuxScenarioTDir = mkdtempSync(join(tmpdir(), "opencode-nexus-cmux-tuvw-"));
  const originalPathT = process.env.PATH;
  const originalWorkspaceIDT = process.env.CMUX_WORKSPACE_ID;
  const originalCmuxTestLogT = process.env.CMUX_TEST_LOG;
  const originalCmuxDisableT = process.env.OPENCODE_NEXUS_CMUX;
  try {
    const { binDir, logFile } = installCmuxShim(cmuxScenarioTDir);
    process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
    process.env.CMUX_WORKSPACE_ID = "test-workspace-t";
    process.env.CMUX_TEST_LOG = logFile;
    delete process.env.OPENCODE_NEXUS_CMUX;

    const cmuxHooksT = await pluginModule.default({ directory: process.cwd() });
    const rootSessionIDT = "root-session-t";
    const otherSessionIDT = "other-session-t";
    await cmuxHooksT.event({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: rootSessionIDT,
            parentID: undefined,
          },
        },
      },
    });

    // cmux-t: Primary user path — after an error, the next user input starts
    // a new busy turn and stale error log entries should be auto-cleared
    // ("에러 후 새 입력이 오면 에러 로그 자동 제거").
    resetCmuxLog(logFile);
    await cmuxHooksT.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: rootSessionIDT,
          error: { message: "boom" },
        },
      },
    });
    await waitForCmuxCalls(logFile, 3);
    resetCmuxLog(logFile);
    await cmuxHooksT.event({
      event: {
        type: "session.status",
        properties: {
          sessionID: rootSessionIDT,
          status: { type: "busy" },
        },
      },
    });
    const callsT = await waitForCmuxCalls(logFile, 2);
    assert(
      callsT.filter((call) => call[0] === "clear-log").length === 1,
      `cmux-t: post-error busy must emit clear-log exactly once, got ${JSON.stringify(callsT)}`,
    );
    assert(
      callsT.some((call) => call[0] === "set-status" && call[1] === "nexus-state" && call[2] === "Running" && call[3] === "--icon" && call[4] === "bolt" && call[5] === "--color" && call[6] === "#007AFF"),
      `cmux-t: post-error busy must set Running pill, got ${JSON.stringify(callsT)}`,
    );

    // cmux-u: Dedup guard — repeated busy events in one turn clear only once.
    resetCmuxLog(logFile);
    await cmuxHooksT.event({
      event: {
        type: "session.idle",
        properties: {
          sessionID: rootSessionIDT,
        },
      },
    });
    await waitForCmuxCalls(logFile, 2);
    resetCmuxLog(logFile);
    for (let i = 0; i < 5; i++) {
      await cmuxHooksT.event({
        event: {
          type: "session.status",
          properties: {
            sessionID: rootSessionIDT,
            status: { type: "busy" },
          },
        },
      });
    }
    const callsU = await waitForCmuxCalls(logFile, 6);
    assert(
      callsU.filter((call) => call[0] === "clear-log").length === 1,
      `cmux-u: repeated busy in one turn must clear-log exactly once, got ${JSON.stringify(callsU)}`,
    );
    assert(
      callsU.filter((call) => call[0] === "set-status" && call[1] === "nexus-state" && call[2] === "Running").length === 5,
      `cmux-u: repeated busy in one turn must set Running 5 times, got ${JSON.stringify(callsU)}`,
    );

    // cmux-v: MessageAbortedError should still reset running-state tracking so
    // the next busy transition re-triggers clear-log.
    resetCmuxLog(logFile);
    await cmuxHooksT.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: rootSessionIDT,
          error: { name: "MessageAbortedError", message: "aborted" },
        },
      },
    });
    const callsVAbort = await waitForCmuxCalls(logFile, 1);
    assert(
      callsVAbort.some((call) => call[0] === "set-status" && call[1] === "nexus-state" && call[2] === "Needs Input"),
      `cmux-v: MessageAbortedError must set Needs Input before next busy, got ${JSON.stringify(callsVAbort)}`,
    );
    resetCmuxLog(logFile);
    await cmuxHooksT.event({
      event: {
        type: "session.status",
        properties: {
          sessionID: rootSessionIDT,
          status: { type: "busy" },
        },
      },
    });
    const callsV = await waitForCmuxCalls(logFile, 2);
    assert(
      callsV.some((call) => call[0] === "clear-log"),
      `cmux-v: post-abort busy must emit clear-log, got ${JSON.stringify(callsV)}`,
    );
    assert(
      callsV.some((call) => call[0] === "set-status" && call[1] === "nexus-state" && call[2] === "Running" && call[3] === "--icon" && call[4] === "bolt" && call[5] === "--color" && call[6] === "#007AFF"),
      `cmux-v: post-abort busy must set Running pill, got ${JSON.stringify(callsV)}`,
    );

    // cmux-w: Negative guard 1 — disabled mode must suppress cmux writes.
    resetCmuxLog(logFile);
    process.env.OPENCODE_NEXUS_CMUX = "0";
    await cmuxHooksT.event({
      event: {
        type: "session.status",
        properties: {
          sessionID: rootSessionIDT,
          status: { type: "busy" },
        },
      },
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    const callsWDisabled = readCmuxCalls(logFile);
    assert(callsWDisabled.length === 0, `cmux-w: disabled mode busy must not spawn cmux, got ${JSON.stringify(callsWDisabled)}`);
    delete process.env.OPENCODE_NEXUS_CMUX;
    await cmuxHooksT.event({
      event: {
        type: "session.idle",
        properties: {
          sessionID: rootSessionIDT,
        },
      },
    });
    await waitForCmuxCalls(logFile, 2);

    // cmux-w: Negative guard 2 — non-root busy must not spawn cmux writes.
    resetCmuxLog(logFile);
    await cmuxHooksT.event({
      event: {
        type: "session.status",
        properties: {
          sessionID: otherSessionIDT,
          status: { type: "busy" },
        },
      },
    });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    const callsWNonRoot = readCmuxCalls(logFile);
    assert(callsWNonRoot.length === 0, `cmux-w: non-root busy must not spawn cmux, got ${JSON.stringify(callsWNonRoot)}`);
  } finally {
    if (originalPathT === undefined) delete process.env.PATH;
    else process.env.PATH = originalPathT;
    if (originalWorkspaceIDT === undefined) delete process.env.CMUX_WORKSPACE_ID;
    else process.env.CMUX_WORKSPACE_ID = originalWorkspaceIDT;
    if (originalCmuxTestLogT === undefined) delete process.env.CMUX_TEST_LOG;
    else process.env.CMUX_TEST_LOG = originalCmuxTestLogT;
    if (originalCmuxDisableT === undefined) delete process.env.OPENCODE_NEXUS_CMUX;
    else process.env.OPENCODE_NEXUS_CMUX = originalCmuxDisableT;
    rmSync(cmuxScenarioTDir, { recursive: true, force: true });
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
