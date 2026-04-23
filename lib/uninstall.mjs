import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import {
  CORE_SKILLS,
  DEFAULT_AGENT,
  isPluginEntry,
  MCP_SERVER_CONFIG,
  MCP_SERVER_NAME,
  projectConfigPath,
  projectSkillsDir,
  SCHEMA_URL,
  userConfigPath,
  userSkillsDir,
} from "./install-spec.mjs";

function readJson(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function isEmptyObject(value) {
  return isObject(value) && Object.keys(value).length === 0;
}

function planConfigRemoval(currentJson, { force }) {
  const baseline = isObject(currentJson) ? currentJson : {};
  const next = isObject(currentJson) ? { ...currentJson } : {};
  const warnings = [];

  if (Array.isArray(next.plugin)) {
    const filtered = next.plugin.filter((entry) => !isPluginEntry(entry));
    if (filtered.length === 0) {
      delete next.plugin;
    } else {
      next.plugin = filtered;
    }
  }

  if (isObject(next.mcp)) {
    const mcp = { ...next.mcp };
    if (Object.prototype.hasOwnProperty.call(mcp, MCP_SERVER_NAME)) {
      if (sameJson(mcp[MCP_SERVER_NAME], MCP_SERVER_CONFIG) || force) {
        delete mcp[MCP_SERVER_NAME];
      } else {
        warnings.push(`left mcp.${MCP_SERVER_NAME} unchanged (use --force to remove)`);
      }
    }

    if (Object.keys(mcp).length === 0) {
      delete next.mcp;
    } else {
      next.mcp = mcp;
    }
  }

  if (Object.prototype.hasOwnProperty.call(next, "default_agent")) {
    if (next.default_agent === DEFAULT_AGENT || force) {
      delete next.default_agent;
    } else {
      warnings.push("left default_agent unchanged (use --force to remove)");
    }
  }

  if (isObject(next.agent)) {
    const agent = { ...next.agent };

    for (const agentId of ["build", "plan"]) {
      if (!isObject(agent[agentId])) {
        continue;
      }

      const detail = { ...agent[agentId] };
      if (Object.prototype.hasOwnProperty.call(detail, "disable")) {
        if (detail.disable === true || force) {
          delete detail.disable;
        } else {
          warnings.push(`left agent.${agentId}.disable unchanged (use --force to remove)`);
        }
      }

      if (Object.keys(detail).length === 0) {
        delete agent[agentId];
      } else {
        agent[agentId] = detail;
      }
    }

    if (Object.keys(agent).length === 0) {
      delete next.agent;
    } else {
      next.agent = agent;
    }
  }

  if (force && next.$schema === SCHEMA_URL) {
    delete next.$schema;
  }

  return { next, warnings, changed: !sameJson(baseline, next) };
}

function planDeleteIfEmpty(path, { removeNames = [], deletedFiles = new Set(), deletedDirs = new Set() } = {}) {
  if (!existsSync(path)) {
    return false;
  }

  const removeNameSet = new Set(removeNames);
  const entries = readdirSync(path);
  for (const entry of entries) {
    const entryPath = join(path, entry);
    if (removeNameSet.has(entry) || deletedFiles.has(entryPath) || deletedDirs.has(entryPath)) {
      continue;
    }
    return false;
  }

  return true;
}

function deleteDirIfEmpty(path) {
  if (!existsSync(path)) {
    return false;
  }

  if (readdirSync(path).length !== 0) {
    return false;
  }

  rmdirSync(path);
  return true;
}

export function uninstall({ scope = "project", cwd = process.cwd(), dryRun = false, force = false } = {}) {
  if (!["user", "project", "both"].includes(scope)) {
    throw new Error(`Invalid scope: ${scope}`);
  }

  const userParentDir = join(homedir(), ".config", "opencode");
  const projectParentDir = join(cwd, ".opencode");

  const configTargets = [];
  const skillTargets = [];

  if (scope === "project") {
    configTargets.push({ label: "project", path: projectConfigPath(cwd) });
    skillTargets.push({ targetDir: projectSkillsDir(cwd), parentDir: projectParentDir });
  }

  if (scope === "user") {
    configTargets.push({ label: "user", path: userConfigPath() });
    skillTargets.push({ targetDir: userSkillsDir(), parentDir: userParentDir });
  }

  if (scope === "both") {
    configTargets.push({ label: "user", path: userConfigPath() });
    configTargets.push({ label: "project", path: projectConfigPath(cwd) });
    skillTargets.push({ targetDir: projectSkillsDir(cwd), parentDir: projectParentDir });
  }

  const writes = [];
  const removedSkills = [];
  const deletedFiles = [];
  const deletedDirs = [];
  const warnings = [];

  const plannedDeletedFiles = new Set();
  const plannedDeletedDirs = new Set();

  for (const target of configTargets) {
    if (!existsSync(target.path)) {
      continue;
    }

    const current = readJson(target.path);
    const { next, warnings: localWarnings, changed } = planConfigRemoval(current, { force });
    warnings.push(...localWarnings.map((warning) => `${target.label}: ${warning}`));

    const deleteFile = isEmptyObject(next);
    if (dryRun) {
      if (deleteFile || changed) {
        writes.push({ path: target.path, json: deleteFile ? null : next });
      }
      if (deleteFile) {
        plannedDeletedFiles.add(target.path);
        deletedFiles.push(target.path);
      }
      continue;
    }

    if (deleteFile) {
      unlinkSync(target.path);
      deletedFiles.push(target.path);
      continue;
    }

    if (changed) {
      writeJson(target.path, next);
      writes.push({ path: target.path, json: next });
    }
  }

  for (const target of skillTargets) {
    const skills = [];
    for (const skill of CORE_SKILLS) {
      if (existsSync(join(target.targetDir, skill))) {
        skills.push(skill);
      }
    }

    if (dryRun) {
      if (skills.length > 0) {
        removedSkills.push({ targetDir: target.targetDir, skills });
      }

      const shouldDeleteSkillsDir = planDeleteIfEmpty(target.targetDir, {
        removeNames: skills,
        deletedFiles: plannedDeletedFiles,
        deletedDirs: plannedDeletedDirs,
      });
      if (shouldDeleteSkillsDir) {
        plannedDeletedDirs.add(target.targetDir);
        deletedDirs.push(target.targetDir);
      }

      const shouldDeleteParentDir = planDeleteIfEmpty(target.parentDir, {
        removeNames: shouldDeleteSkillsDir ? [basename(target.targetDir)] : [],
        deletedFiles: plannedDeletedFiles,
        deletedDirs: plannedDeletedDirs,
      });
      if (shouldDeleteParentDir) {
        plannedDeletedDirs.add(target.parentDir);
        deletedDirs.push(target.parentDir);
      }

      continue;
    }

    if (skills.length > 0) {
      for (const skill of skills) {
        rmSync(join(target.targetDir, skill), { recursive: true, force: true });
      }
      removedSkills.push({ targetDir: target.targetDir, skills });
    }

    if (deleteDirIfEmpty(target.targetDir)) {
      deletedDirs.push(target.targetDir);
    }
    if (deleteDirIfEmpty(target.parentDir)) {
      deletedDirs.push(target.parentDir);
    }
  }

  const noOp =
    writes.length === 0 &&
    removedSkills.length === 0 &&
    deletedFiles.length === 0 &&
    deletedDirs.length === 0 &&
    warnings.length === 0;

  return {
    scope,
    writes,
    removedSkills,
    deletedFiles,
    deletedDirs,
    warnings,
    noOp,
  };
}
