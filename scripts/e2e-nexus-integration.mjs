#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const failures = [];
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function runCommand(command, args, { timeoutMs = 5000, cwd = process.cwd() } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

async function runMcpHandshake() {
  const mcpPath = join(process.cwd(), "node_modules", "@moreih29", "nexus-core", "dist", "src", "mcp", "server.js");

  return new Promise((resolve) => {
    const proc = spawn("node", [mcpPath], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "inherit"],
      env: process.env,
    });

    let stdoutBuffer = "";
    const responses = new Map();
    let timedOut = false;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, 5000);

    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const tryComplete = () => {
      if (responses.has(1) && responses.has(2)) {
        proc.stdin.end();
      }
    };

    proc.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const message = JSON.parse(trimmed);
          if (Object.prototype.hasOwnProperty.call(message, "id")) {
            responses.set(message.id, message);
          }
          tryComplete();
        } catch {
          failures.push(`A: failed to parse MCP stdout line as JSON: ${trimmed}`);
        }
      }
    });

    proc.on("error", (error) => {
      settle({ timedOut, responses, spawnError: error });
    });

    proc.on("close", () => {
      settle({ timedOut, responses, spawnError: null });
    });

    const initializeRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "opencode-nexus-e2e",
          version: "0.0.0",
        },
      },
    };

    const initializedNotification = {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    };

    const toolsListRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    };

    proc.stdin.write(`${JSON.stringify(initializeRequest)}\n`);
    proc.stdin.write(`${JSON.stringify(initializedNotification)}\n`);
    proc.stdin.write(`${JSON.stringify(toolsListRequest)}\n`);
  });
}

async function main() {
  section("A. MCP handshake");

  const handshake = await runMcpHandshake();
  assert(!handshake.spawnError, `A: failed to spawn nexus-mcp: ${handshake.spawnError?.message ?? "unknown"}`);
  assert(!handshake.timedOut, "A: nexus-mcp handshake timed out (5s)");

  const init = handshake.responses.get(1);
  assert(!!init, "A: missing initialize response (id=1)");
  if (isRecord(init)) {
    assert(init?.result?.serverInfo?.name === "nexus-core", `A: unexpected serverInfo.name: ${String(init?.result?.serverInfo?.name)}`);
  }

  const toolsList = handshake.responses.get(2);
  assert(!!toolsList, "A: missing tools/list response (id=2)");

  const tools = toolsList?.result?.tools;
  assert(Array.isArray(tools), "A: tools/list result.tools is not an array");
  if (Array.isArray(tools)) {
    assert(tools.length >= 14, `A: expected >=14 tools, got ${tools.length}`);
    const toolNames = new Set(tools.map((tool) => tool?.name).filter((name) => typeof name === "string"));
    assert(toolNames.has("nx_plan_start"), "A: missing tool nx_plan_start");
    assert(toolNames.has("nx_task_add"), "A: missing tool nx_task_add");
    assert(toolNames.has("nx_artifact_write"), "A: missing tool nx_artifact_write");
    assert(toolNames.has("nx_history_search"), "A: missing tool nx_history_search");
  }

  section("B. mountHooks contract");

  let pluginModule;
  try {
    pluginModule = await import("../src/plugin.ts");
  } catch (error) {
    failures.push(`B: failed to import src/plugin.ts: ${error instanceof Error ? error.message : String(error)}`);
  }

  const plugin = pluginModule?.default;
  assert(typeof plugin === "function", "B: default export is not a function");

  let hooks;
  if (typeof plugin === "function") {
    try {
      hooks = await plugin({ directory: process.cwd() });
    } catch (error) {
      failures.push(`B: plugin invocation threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  assert(isRecord(hooks), "B: plugin return is not an object");
  const expectedHookKeys = [
    "event",
    "chat.message",
    "tool.execute.before",
    "tool.execute.after",
    "experimental.chat.system.transform",
  ];

  if (isRecord(hooks)) {
    for (const key of expectedHookKeys) {
      const hook = hooks[key];
      assert(typeof hook === "function", `B: hook ${key} is missing or not a function`);
    }
  }

  section("C. sync idempotent");

  const syncArgs = ["@moreih29/nexus-core", "sync", "--harness=opencode", "--target=./", "--dry-run"];
  const firstSync = await runCommand("bunx", syncArgs, { timeoutMs: 10000 });
  const secondSync = await runCommand("bunx", syncArgs, { timeoutMs: 10000 });

  assert(!firstSync.timedOut, "C: first sync --dry-run timed out (10s)");
  assert(!secondSync.timedOut, "C: second sync --dry-run timed out (10s)");
  assert(firstSync.code === 0, `C: first sync --dry-run exited with code ${String(firstSync.code)}`);
  assert(secondSync.code === 0, `C: second sync --dry-run exited with code ${String(secondSync.code)}`);
  assert(firstSync.stdout === secondSync.stdout, "C: sync --dry-run outputs differ between consecutive runs");
  assert(firstSync.stdout.includes("template-skipped"), "C: first sync summary missing 'template-skipped'");
  assert(!firstSync.stdout.includes("opencode.json.fragment"), "C: sync dry-run stdout must not mention opencode.json.fragment (fragment removed in v0.16.0)");

  section("D. plugin module load");

  let moduleLoaded = false;
  let pluginDefault;
  try {
    const module = await import("../src/plugin.ts");
    moduleLoaded = true;
    pluginDefault = module.default;
  } catch (error) {
    failures.push(`D: importing src/plugin.ts threw: ${error instanceof Error ? error.message : String(error)}`);
  }

  assert(moduleLoaded, "D: plugin module did not load");
  assert(typeof pluginDefault === "function", "D: plugin default export is not a function");

  section("E. hook manifest resolves");

  const packageRoot = dirname(require.resolve("@moreih29/nexus-core/package.json"));
  const manifestPath = resolve(packageRoot, "dist", "manifests", "opencode-manifest.json");

  let manifest;
  try {
    const imported = await import("@moreih29/nexus-core/hooks/opencode-manifest", { with: { type: "json" } });
    manifest = imported.default;
  } catch {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      failures.push(`E: failed to load manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const manifestHooks = manifest?.hooks;
  assert(Array.isArray(manifestHooks), "E: manifest.hooks is not an array");

  let promptRouterHandlerPath;
  if (Array.isArray(manifestHooks)) {
    assert(manifestHooks.length > 0, "E: manifest.hooks is empty");

    for (const [index, hook] of manifestHooks.entries()) {
      assert(isRecord(hook), `E: hook entry at index ${index} is not an object`);
      if (!isRecord(hook)) continue;

      const handlerPath = hook.handlerPath;
      assert(typeof handlerPath === "string" && handlerPath.length > 0, `E: hook ${hook.name ?? `#${index}`} missing handlerPath`);
      if (typeof handlerPath !== "string" || handlerPath.length === 0) continue;

      const handlerAbsolutePath = resolve(packageRoot, "dist", "manifests", handlerPath);
      assert(existsSync(handlerAbsolutePath), `E: handlerPath missing on disk for ${hook.name ?? `#${index}`}: ${handlerPath}`);

      if (hook.name === "prompt-router") {
        promptRouterHandlerPath = handlerAbsolutePath;
      }
    }
  }

  assert(!!promptRouterHandlerPath, "E: prompt-router entry missing from manifest.hooks");

  section("F. prompt-router self-contained load");

  if (!promptRouterHandlerPath) {
    failures.push("F: prompt-router handler path unavailable from manifest");
  } else {
    try {
      const promptRouterModule = await import(pathToFileURL(promptRouterHandlerPath).href);
      const hasDefaultFunction = typeof promptRouterModule.default === "function";
      const hasAnyFunctionExport = Object.values(promptRouterModule).some((value) => typeof value === "function");
      assert(hasDefaultFunction || hasAnyFunctionExport, "F: prompt-router module has no function export");
    } catch (error) {
      failures.push(`F: failed to import prompt-router handler: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length === 0) {
    console.log("\n✅ All blocks PASS");
    process.exit(0);
  }

  console.log(`\n❌ ${failures.length} failure(s):`);
  for (const failure of failures) {
    console.log(`  - ${failure}`);
  }
  process.exit(1);
}

await main();
