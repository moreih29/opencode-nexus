#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_TO_COPY = ["nx-init", "nx-plan", "nx-run", "nx-sync"];

function log(level, message) {
  console.log(`[opencode-nexus postinstall] ${level}: ${message}`);
}

const consumerCwd = process.env.INIT_CWD;

if (!consumerCwd) {
  log("skip", "INIT_CWD not set (direct invocation), skipping");
  process.exit(0);
}

try {
  const consumerPkgPath = join(consumerCwd, "package.json");
  if (existsSync(consumerPkgPath)) {
    const consumerPkg = JSON.parse(readFileSync(consumerPkgPath, "utf-8"));
    if (consumerPkg.name === "opencode-nexus") {
      log("skip", "self-install detected (consumer package name is opencode-nexus), skipping");
      process.exit(0);
    }
  }
} catch (error) {
  log("warn", `failed to evaluate self-install guard: ${error instanceof Error ? error.message : String(error)}`);
}

const opencodeDir = join(consumerCwd, ".opencode");
if (!existsSync(opencodeDir)) {
  log("warn", `consumer is missing .opencode directory (${consumerCwd}); skipping skill copy`);
  process.exit(0);
}

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillSrcBase = join(pluginRoot, ".opencode", "skills");
const skillDstBase = join(opencodeDir, "skills");

let copied = 0;
let skippedExisting = 0;
let skippedMissingSource = 0;

for (const skillName of SKILLS_TO_COPY) {
  const srcFile = join(skillSrcBase, skillName, "SKILL.md");
  const dstDir = join(skillDstBase, skillName);
  const dstFile = join(dstDir, "SKILL.md");

  if (!existsSync(srcFile)) {
    skippedMissingSource += 1;
    log("warn", `source missing for ${skillName}: ${srcFile}`);
    continue;
  }

  if (existsSync(dstFile)) {
    skippedExisting += 1;
    log("skip", `destination exists for ${skillName}, preserving user file`);
    continue;
  }

  mkdirSync(dstDir, { recursive: true });
  copyFileSync(srcFile, dstFile);
  copied += 1;
  log("copy", `${skillName} -> ${dstFile}`);
}

log(
  "done",
  `copied=${copied}, skipped_existing=${skippedExisting}, skipped_missing_source=${skippedMissingSource}, target=${skillDstBase}`,
);
