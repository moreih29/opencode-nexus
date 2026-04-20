// Preserve-first skill file manager for nx-* skills.
// Design reference: plan #58 issue #1 — scope-separated skills install; postinstall mutation moved to CLI.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILLS_TO_COPY, projectSkillsDir, userSkillsDir } from "./install-spec.mjs";

function resolveScopeDir(scope, cwd) {
  if (scope === "user") return userSkillsDir();
  if (scope === "project") return projectSkillsDir(cwd);
  throw new Error(`Unsupported scope: ${scope}`);
}

function removeDirIfEmpty(dirPath) {
  if (!existsSync(dirPath)) return;
  const entries = readdirSync(dirPath);
  if (entries.length === 0) {
    rmSync(dirPath);
  }
}

/**
 * Resolve package-internal skill source directory.
 * Returns absolute path to node_modules/opencode-nexus/.opencode/skills/ (or dev path when running in-repo).
 */
export function resolveSkillSource() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", ".opencode", "skills");
}

/**
 * Install skills to scope.
 * scope: "user" | "project"
 * opts: { force?: boolean, cwd?: string }
 * Returns { copied: string[], skipped: string[], missingSource: string[] }
 */
export function installSkills(scope, opts = {}) {
  const srcBase = resolveSkillSource();
  const dstBase = resolveScopeDir(scope, opts.cwd);
  const copied = [];
  const skipped = [];
  const missingSource = [];

  for (const skillName of SKILLS_TO_COPY) {
    const srcFile = join(srcBase, skillName, "SKILL.md");
    const dstFile = join(dstBase, skillName, "SKILL.md");

    if (!existsSync(srcFile)) {
      missingSource.push(skillName);
      continue;
    }

    if (existsSync(dstFile) && opts.force !== true) {
      skipped.push(skillName);
      continue;
    }

    mkdirSync(dirname(dstFile), { recursive: true });
    copyFileSync(srcFile, dstFile);
    copied.push(skillName);
  }

  return { copied, skipped, missingSource };
}

/**
 * Uninstall skills from scope.
 * scope: "user" | "project"
 * opts: { purge?: boolean, cwd?: string }
 * By default preserve (skipped). --purge 시만 삭제.
 * Returns { removed: string[], preserved: string[] }
 */
export function uninstallSkills(scope, opts = {}) {
  const dstBase = resolveScopeDir(scope, opts.cwd);
  const removed = [];
  const preserved = [];

  for (const skillName of SKILLS_TO_COPY) {
    const dstDir = join(dstBase, skillName);
    const dstFile = join(dstDir, "SKILL.md");

    if (!existsSync(dstFile)) continue;

    if (opts.purge === true) {
      rmSync(dstFile, { force: true });
      removeDirIfEmpty(dstDir);
      removed.push(skillName);
    } else {
      preserved.push(skillName);
    }
  }

  return { removed, preserved };
}

/**
 * Inspect installed skills for doctor.
 * scope: "user" | "project"
 * Returns { installed: string[], missing: string[], modified: string[] }
 */
export function listInstalledSkills(scope, opts = {}) {
  const srcBase = resolveSkillSource();
  const dstBase = resolveScopeDir(scope, opts.cwd);
  const installed = [];
  const missing = [];
  const modified = [];

  for (const skillName of SKILLS_TO_COPY) {
    const srcFile = join(srcBase, skillName, "SKILL.md");
    const dstFile = join(dstBase, skillName, "SKILL.md");

    if (!existsSync(dstFile)) {
      missing.push(skillName);
      continue;
    }

    installed.push(skillName);

    if (!existsSync(srcFile)) continue;
    const src = readFileSync(srcFile, "utf8");
    const dst = readFileSync(dstFile, "utf8");
    if (src !== dst) {
      modified.push(skillName);
    }
  }

  return { installed, missing, modified };
}
