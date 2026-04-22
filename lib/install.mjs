import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  bundledSkillsDir,
  CORE_SKILLS,
  DEFAULT_AGENT,
  isPluginEntry,
  MCP_SERVER_CONFIG,
  MCP_SERVER_NAME,
  PACKAGE_SPEC,
  projectConfigPath,
  projectSkillsDir,
  SCHEMA_URL,
  userConfigPath,
  userSkillsDir,
} from "./install-spec.mjs";

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readJson(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizePluginEntries(entries, packageSpec) {
  const normalized = [];
  let found = false;

  for (const entry of entries) {
    if (!isPluginEntry(entry)) {
      normalized.push(entry);
      continue;
    }

    if (!found) {
      normalized.push(packageSpec);
      found = true;
    }
  }

  if (!found) {
    normalized.push(packageSpec);
  }

  return normalized;
}

function setHiddenPrimaryDefaults(next, force, warnings) {
  next.agent = typeof next.agent === "object" && next.agent !== null ? { ...next.agent } : {};

  for (const agentId of ["build", "plan"]) {
    const existing = typeof next.agent[agentId] === "object" && next.agent[agentId] !== null ? { ...next.agent[agentId] } : {};
    if (existing.disable === undefined || existing.disable === true || force) {
      existing.disable = true;
    } else {
      warnings.push(`left agent.${agentId}.disable unchanged`);
    }
    next.agent[agentId] = existing;
  }
}

function installIntoConfig(path, { includeDefaultAgent, force, packageSpec }) {
  const next = readJson(path);
  const warnings = [];

  if (typeof next.$schema !== "string" || next.$schema.length === 0) {
    next.$schema = SCHEMA_URL;
  }

  const plugins = Array.isArray(next.plugin) ? [...next.plugin] : [];
  next.plugin = normalizePluginEntries(plugins, packageSpec);

  const mcp = typeof next.mcp === "object" && next.mcp !== null ? { ...next.mcp } : {};
  const existingNx = mcp[MCP_SERVER_NAME];
  if (existingNx === undefined || sameJson(existingNx, MCP_SERVER_CONFIG)) {
    mcp[MCP_SERVER_NAME] = MCP_SERVER_CONFIG;
  } else if (force) {
    mcp[MCP_SERVER_NAME] = MCP_SERVER_CONFIG;
  } else {
    warnings.push(`left existing mcp.${MCP_SERVER_NAME} unchanged`);
  }
  next.mcp = mcp;

  if (includeDefaultAgent) {
    if (next.default_agent === undefined || next.default_agent === DEFAULT_AGENT) {
      next.default_agent = DEFAULT_AGENT;
    } else if (force) {
      next.default_agent = DEFAULT_AGENT;
    } else {
      warnings.push("left existing default_agent unchanged");
    }
  }

  setHiddenPrimaryDefaults(next, force, warnings);

  return { next, warnings };
}

function copySkills(targetDir, sourceRoot) {
  const copied = [];

  ensureDir(targetDir);
  for (const skill of CORE_SKILLS) {
    const source = join(sourceRoot, skill);
    const target = join(targetDir, skill);
    if (!existsSync(source)) {
      throw new Error(`Missing bundled skill: ${skill}`);
    }
    cpSync(source, target, { recursive: true, force: true });
    copied.push(skill);
  }

  return copied;
}

export function install({ scope = "project", cwd = process.cwd(), dryRun = false, force = false } = {}) {
  if (!["user", "project", "both"].includes(scope)) {
    throw new Error(`Invalid scope: ${scope}`);
  }

  const packageSpec = PACKAGE_SPEC;

  const writes = [];
  const skillCopies = [];
  const warnings = [];

  if (scope === "project") {
    const path = projectConfigPath(cwd);
    const { next, warnings: configWarnings } = installIntoConfig(path, { includeDefaultAgent: true, force, packageSpec });
    writes.push({ path, json: next });
    warnings.push(...configWarnings.map((warning) => `project: ${warning}`));
    skillCopies.push({ targetDir: projectSkillsDir(cwd) });
  }

  if (scope === "user") {
    const path = userConfigPath();
    const { next, warnings: configWarnings } = installIntoConfig(path, { includeDefaultAgent: true, force, packageSpec });
    writes.push({ path, json: next });
    warnings.push(...configWarnings.map((warning) => `user: ${warning}`));
    skillCopies.push({ targetDir: userSkillsDir() });
  }

  if (scope === "both") {
    const userPath = userConfigPath();
    const projectPath = projectConfigPath(cwd);
    const userResult = installIntoConfig(userPath, { includeDefaultAgent: false, force, packageSpec });
    const projectResult = installIntoConfig(projectPath, { includeDefaultAgent: true, force, packageSpec });

    writes.push({ path: userPath, json: userResult.next });
    writes.push({ path: projectPath, json: projectResult.next });
    warnings.push(...userResult.warnings.map((warning) => `user: ${warning}`));
    warnings.push(...projectResult.warnings.map((warning) => `project: ${warning}`));
    skillCopies.push({ targetDir: projectSkillsDir(cwd) });
  }

  if (dryRun) {
    return {
      writes,
      copiedSkills: skillCopies.map((item) => ({ targetDir: item.targetDir, skills: [...CORE_SKILLS] })),
      warnings,
      packageSpec,
    };
  }

  for (const entry of writes) {
    writeJson(entry.path, entry.json);
  }

  const copiedSkills = skillCopies.map(({ targetDir }) => ({ targetDir, skills: copySkills(targetDir, bundledSkillsDir()) }));

  return { writes, copiedSkills, warnings, packageSpec };
}
