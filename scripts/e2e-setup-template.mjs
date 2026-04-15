import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { createConfigHook } from "../dist/create-config.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

async function runCliTty(args, answers) {
  await new Promise((resolve, reject) => {
    const child = spawn("node", ["dist/cli.js", ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        OPENCODE_NEXUS_FORCE_TTY: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let answerIndex = 0;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`interactive cli timed out after waiting for prompt ${answerIndex + 1}`));
    }, 10000);

    const maybeAnswerPrompt = () => {
      const waitingForPrompt = /(Select an option \[[0-9]+\]: |Project directory \[[^\]]+\]: |Plugin version(?: \[[^\]]+\])?: |Updated plugin version(?: \[[^\]]+\])?: )$/.test(stdout);
      if (!waitingForPrompt || answerIndex >= answers.length) {
        return;
      }

      child.stdin.write(`${answers[answerIndex]}\n`);
      answerIndex += 1;
      if (answerIndex === answers.length) {
        child.stdin.end();
      }
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      maybeAnswerPrompt();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`interactive cli failed (${code}): ${(stderr || stdout).trim()}`));
    });
  });
}

await execFileAsync("bun", ["scripts/generate-template.mjs"], { cwd: repoRoot });
const template = await fs.readFile(path.join(repoRoot, "templates", "nexus-section.md"), "utf8");
assert.match(template, /## Nexus Agent Orchestration/);
assert.match(template, /### Skills/);
assert.match(template, /### Tags/);
assert.ok(!template.includes("nx-setup"), "template should not expose nx-setup");

const configHook = createConfigHook();
const runtimeConfig = {};
await configHook(runtimeConfig);
assert.equal(runtimeConfig.default_agent, "nexus");
assert.equal(runtimeConfig.agent.nexus.mode, "primary");
assert.match(runtimeConfig.agent.nexus.prompt, /coordinator-first primary agent/i);

const preservedRuntimeConfig = { default_agent: "build" };
await configHook(preservedRuntimeConfig);
assert.equal(preservedRuntimeConfig.default_agent, "build");

const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
const packageVersion = pkg.version;

const versionResult = await execFileAsync("node", ["dist/cli.js", "--version"], { cwd: repoRoot });
assert.equal(versionResult.stdout.trim(), packageVersion);

const shortVersionResult = await execFileAsync("node", ["dist/cli.js", "-v"], { cwd: repoRoot });
assert.equal(shortVersionResult.stdout.trim(), packageVersion);

const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-cli-project-"));
await execFileAsync("node", ["dist/cli.js", "install", "--scope", "project", "--directory", projectRoot], {
  cwd: repoRoot
});

const installedProjectConfig = JSON.parse(await fs.readFile(path.join(projectRoot, "opencode.json"), "utf8"));
assert.equal(installedProjectConfig.plugin.includes(`opencode-nexus@${packageVersion}`), true);

await execFileAsync(
  "node",
  ["dist/cli.js", "update", "--scope", "project", "--directory", projectRoot, "--version", "9.9.9"],
  { cwd: repoRoot }
);

const updatedProjectConfig = JSON.parse(await fs.readFile(path.join(projectRoot, "opencode.json"), "utf8"));
assert.equal(updatedProjectConfig.plugin.includes("opencode-nexus@9.9.9"), true);
assert.equal(updatedProjectConfig.plugin.includes(`opencode-nexus@${packageVersion}`), false);

const userConfigPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-cli-user-")), "opencode.json");
await execFileAsync(
  "node",
  ["dist/cli.js", "install", "--scope", "user", "--config", userConfigPath, "--no-pin"],
  { cwd: repoRoot }
);
const userConfig = JSON.parse(await fs.readFile(userConfigPath, "utf8"));
assert.equal(userConfig.plugin.includes("opencode-nexus"), true);

const interactiveProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-cli-interactive-project-"));
await runCliTty(["install"], ["2", interactiveProjectRoot, "1", "7.7.7"]);

const interactiveInstallConfig = JSON.parse(await fs.readFile(path.join(interactiveProjectRoot, "opencode.json"), "utf8"));
assert.equal(interactiveInstallConfig.plugin.includes("opencode-nexus@7.7.7"), true);

await runCliTty(["update", "--scope", "project", "--directory", interactiveProjectRoot], ["1", "8.8.8"]);
const interactiveUpdateConfig = JSON.parse(await fs.readFile(path.join(interactiveProjectRoot, "opencode.json"), "utf8"));
assert.equal(interactiveUpdateConfig.plugin.includes("opencode-nexus@8.8.8"), true);
assert.equal(interactiveUpdateConfig.plugin.includes("opencode-nexus@7.7.7"), false);

const nonInteractiveConfigPath = path.join(
  await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-cli-noninteractive-")),
  "opencode.json"
);
await execFileAsync("node", ["dist/cli.js", "install", "--config", nonInteractiveConfigPath], { cwd: repoRoot });
const nonInteractiveConfig = JSON.parse(await fs.readFile(nonInteractiveConfigPath, "utf8"));
assert.equal(nonInteractiveConfig.plugin.includes(`opencode-nexus@${packageVersion}`), true);

console.log("e2e setup template + cli passed");
