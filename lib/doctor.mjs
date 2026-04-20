// Install state diagnostics engine.
// Design: Issue #1 + #3 (plan #58) — orphan/partial-state detection, release prerequisite.

import { existsSync, readdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { applyPatch, readConfig, inspectConfig } from "./config-merge.mjs";
import { listInstalledSkills } from "./skills-copy.mjs";
import {
  userConfigPath,
  projectConfigPath,
  userSkillsDir,
  projectSkillsDir,
  DEFAULT_AGENT,
  MCP_SERVER_NAME,
  PACKAGE_NAME,
  isNexusPluginEntry,
} from "./install-spec.mjs";

const EXPECTED_SKILL_COUNT = 4;

function scopeConfigPath(scope, cwd) {
  return scope === "user" ? userConfigPath() : projectConfigPath(cwd);
}

function scopeSkillsPath(scope, cwd) {
  return scope === "user" ? userSkillsDir() : projectSkillsDir(cwd);
}

function withScopeId(scope, id) {
  return `${scope}.${id}`;
}

function addCheck(checks, scope, id, severity, name, message, suggestion) {
  checks.push({ id: withScopeId(scope, id), severity, name, message, suggestion, scope });
}

function countBackups(configPath) {
  const dir = dirname(configPath);
  const base = basename(configPath);
  const prefix = `${base}.backup-`;
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => name.startsWith(prefix)).length;
}

function findNexusPluginEntries(config) {
  const plugin = Array.isArray(config?.plugin) ? config.plugin : [];
  return plugin.filter((entry) => isNexusPluginEntry(entry));
}

function buildFixPatch(config, scope) {
  const changes = [];
  const plugin = Array.isArray(config?.plugin) ? config.plugin : undefined;
  if (plugin) {
    const nexusEntries = plugin.filter((entry) => isNexusPluginEntry(entry));
    if (nexusEntries.length > 1) {
      const normalized = [];
      let inserted = false;
      for (const entry of plugin) {
        if (isNexusPluginEntry(entry)) {
          if (!inserted) {
            normalized.push(PACKAGE_NAME);
            inserted = true;
          }
          continue;
        }
        normalized.push(entry);
      }
      changes.push({ op: "set", path: "plugin", before: plugin, after: normalized, note: "normalize Nexus plugin duplicates" });
    }
    if (plugin.length === 0) {
      changes.push({ op: "delete", path: "plugin", before: plugin, after: undefined, note: "cleanup empty plugin container" });
    }
  }

  const mcp = typeof config?.mcp === "object" && config.mcp !== null && !Array.isArray(config.mcp) ? config.mcp : undefined;
  if (mcp && Object.keys(mcp).length === 0) {
    changes.push({ op: "delete", path: "mcp", before: mcp, after: undefined, note: "cleanup empty mcp container" });
  }

  return {
    scope,
    changes,
    hasChanges: changes.length > 0,
  };
}

function assessSingleScope(scope, opts = {}) {
  const cwd = opts.cwd;
  const checks = [];
  const configPath = scopeConfigPath(scope, cwd);
  const skillsPath = scopeSkillsPath(scope, cwd);
  const configExists = existsSync(configPath);

  addCheck(checks, scope, "config_exists", configExists ? "ok" : "warning", "opencode.json exists", configExists ? `${configPath} exists` : `${configPath} does not exist`);

  let config = {};
  let jsoncError = false;
  let readError = null;
  try {
    const parsed = readConfig(configPath);
    config = parsed.config;
    addCheck(checks, scope, "config_readable", "ok", "opencode.json parses as strict JSON", "Configuration is strict JSON");
  } catch (error) {
    readError = error;
    jsoncError = error instanceof Error && error.message.includes("JSONC syntax");
    addCheck(
      checks,
      scope,
      "config_readable",
      "error",
      "opencode.json parses as strict JSON",
      error instanceof Error ? error.message : String(error),
      "Convert opencode.json to strict JSON (remove comments and trailing commas)",
    );
  }

  const ownsDefaultAgent = scope === "project";
  let inspect = {
    plugin_present: false,
    mcp_nx_correct: false,
    default_agent_is_lead: ownsDefaultAgent ? false : null,
  };
  let pluginEntries = [];
  if (!readError) {
    inspect = inspectConfig(config, scope, { ownsPlugin: true, ownsDefaultAgent });
    pluginEntries = findNexusPluginEntries(config);

    addCheck(
      checks,
      scope,
      "plugin_entry",
      inspect.plugin_present ? "ok" : "warning",
      "plugin entry",
      inspect.plugin_present ? `Found Nexus plugin entry in ${configPath}` : `No ${PACKAGE_NAME} plugin entry in ${configPath}`,
      inspect.plugin_present ? undefined : `Run \`opencode-nexus install --scope=${scope}\` to add plugin entry`,
    );

    addCheck(
      checks,
      scope,
      "plugin_duplicate",
      pluginEntries.length > 1 ? "warning" : "ok",
      "plugin duplicate",
      pluginEntries.length > 1
        ? `Plugin has ${pluginEntries.length} Nexus entries: ${JSON.stringify(pluginEntries)}`
        : "No duplicate Nexus plugin entries",
      pluginEntries.length > 1 ? "Run `opencode-nexus install --normalize` to consolidate duplicates" : undefined,
    );

    addCheck(
      checks,
      scope,
      "mcp_nx",
      inspect.mcp_nx_correct ? "ok" : "warning",
      `mcp.${MCP_SERVER_NAME} canonical` ,
      inspect.mcp_nx_correct ? `mcp.${MCP_SERVER_NAME} matches canonical config` : `mcp.${MCP_SERVER_NAME} is missing or non-canonical`,
      inspect.mcp_nx_correct ? undefined : `Run \`opencode-nexus install --scope=${scope}\` to set mcp.${MCP_SERVER_NAME}`,
    );

    if (scope === "project") {
      const hasDefaultLead = inspect.default_agent_is_lead === true;
      addCheck(
        checks,
        scope,
        "default_agent_set",
        hasDefaultLead ? "ok" : "warning",
        "default_agent",
        hasDefaultLead ? `default_agent = ${JSON.stringify(DEFAULT_AGENT)}` : "default_agent is not set to \"lead\"",
        hasDefaultLead ? undefined : "Run `opencode-nexus install --scope=project --force` to set default_agent=lead",
      );

      const leadDeclared = typeof config?.agent === "object" && config.agent !== null && !Array.isArray(config.agent)
        ? Object.prototype.hasOwnProperty.call(config.agent, DEFAULT_AGENT)
        : false;
      const warn = hasDefaultLead && !leadDeclared;
      addCheck(
        checks,
        scope,
        "agent_lead_declared_or_default",
        warn ? "warning" : "ok",
        "agent.lead declaration",
        warn
          ? "agent.lead is not explicitly declared (plugin auto-registers this agent, so runtime is still valid)"
          : "agent.lead declaration/default relationship is valid",
        warn ? "Optional: declare agent.lead explicitly if your team wants config-local documentation" : undefined,
      );
    }
  } else {
    addCheck(checks, scope, "plugin_entry", "error", "plugin entry", "Skipped because config is unreadable");
    addCheck(checks, scope, "plugin_duplicate", "error", "plugin duplicate", "Skipped because config is unreadable");
    addCheck(checks, scope, "mcp_nx", "error", `mcp.${MCP_SERVER_NAME} canonical`, "Skipped because config is unreadable");
    if (scope === "project") {
      addCheck(checks, scope, "default_agent_set", "error", "default_agent", "Skipped because config is unreadable");
      addCheck(checks, scope, "agent_lead_declared_or_default", "error", "agent.lead declaration", "Skipped because config is unreadable");
    }
  }

  const skills = listInstalledSkills(scope, { cwd });
  const installedCount = skills.installed.length;

  addCheck(
    checks,
    scope,
    "skills_installed",
    installedCount === EXPECTED_SKILL_COUNT ? "ok" : installedCount === 0 ? "warning" : "warning",
    "skills installed",
    `${installedCount}/${EXPECTED_SKILL_COUNT} skills installed at ${skillsPath}`,
    installedCount === EXPECTED_SKILL_COUNT ? undefined : `Run \`opencode-nexus install --scope=${scope}\` to install missing skills`,
  );

  addCheck(
    checks,
    scope,
    "skills_modified",
    skills.modified.length > 0 ? "warning" : "ok",
    "skills modified",
    `${skills.modified.length} skill files modified`,
    skills.modified.length > 0 ? "Re-run install with --skills to restore package skill files, or keep local edits intentionally" : undefined,
  );

  const backupCount = countBackups(configPath);
  addCheck(
    checks,
    scope,
    "backup_accumulated",
    backupCount > 5 ? "warning" : "ok",
    "backup accumulation",
    `${backupCount} backup files near opencode.json`,
    backupCount > 5 ? "Review and remove old backups if they are no longer needed" : undefined,
  );

  return {
    scope,
    checks,
    configPath,
    configExists,
    config,
    jsoncError,
    readError,
    inspect,
    pluginEntries,
    skills,
    fixPatch: readError ? { scope, hasChanges: false, changes: [] } : buildFixPatch(config, scope),
  };
}

function classifyScopeState(assessment) {
  if (assessment.jsoncError) return "jsonc_error";

  const pluginPresent = assessment.inspect.plugin_present;
  const mcpCorrect = assessment.inspect.mcp_nx_correct;
  const defaultLead = assessment.scope === "project" ? assessment.inspect.default_agent_is_lead === true : true;

  const configSignals = Number(pluginPresent) + Number(mcpCorrect) + Number(defaultLead && assessment.scope === "project");
  const ownsConfigAll = pluginPresent && mcpCorrect && defaultLead;

  const installedCount = assessment.skills.installed.length;
  const hasAnySkills = installedCount > 0;
  const allSkills = installedCount === EXPECTED_SKILL_COUNT;

  if (!pluginPresent && !mcpCorrect && (assessment.scope !== "project" || !assessment.inspect.default_agent_is_lead) && !hasAnySkills) {
    return "fresh";
  }
  if (hasAnySkills && !pluginPresent) return "orphan_skills";
  if (configSignals > 0 && !hasAnySkills) return "orphan_config";
  if (ownsConfigAll && allSkills) return "complete";
  if (ownsConfigAll && hasAnySkills && !allSkills) return "partial_skills";
  if (configSignals > 0 && !ownsConfigAll) return "partial_config";
  if (hasAnySkills && !allSkills) return "partial_skills";
  return "partial_config";
}

function mergeStates(states) {
  if (states.includes("jsonc_error")) return "jsonc_error";
  if (states.every((state) => state === "complete")) return "complete";
  if (states.every((state) => state === "fresh")) return "fresh";

  const precedence = ["orphan_skills", "orphan_config", "partial_config", "partial_skills"];
  for (const state of precedence) {
    if (states.includes(state)) return state;
  }
  return "partial_config";
}

function summarizeChecks(checks) {
  const summary = { ok: 0, warning: 0, error: 0 };
  for (const check of checks) {
    summary[check.severity] += 1;
  }
  return summary;
}

function markFixed(previousChecks, nextChecks) {
  const prevMap = new Map(previousChecks.map((check) => [check.id, check]));
  return nextChecks.map((check) => {
    const prev = prevMap.get(check.id);
    if (!prev) return check;
    if ((prev.severity === "warning" || prev.severity === "error") && check.severity === "ok") {
      return { ...check, fixed: true };
    }
    return check;
  });
}

/**
 * Run diagnostics for given scope.
 * scope: "user" | "project" | "both"
 * opts: { cwd?, fix?: boolean }
 * Returns { scope, checks: Check[], summary: { ok, warning, error } }
 * Check: { id, severity: "ok"|"warning"|"error", name, message, suggestion?, fixed? }
 */
export function diagnose(scope, opts = {}) {
  if (!["user", "project", "both"].includes(scope)) {
    throw new Error(`Unsupported scope: ${scope}`);
  }

  const scopes = scope === "both" ? ["user", "project"] : [scope];
  const firstPass = scopes.map((singleScope) => assessSingleScope(singleScope, opts));
  let secondPass = firstPass;

  if (opts.fix === true) {
    for (const assessment of firstPass) {
      if (!assessment.fixPatch.hasChanges) continue;
      applyPatch(assessment.configPath, assessment.fixPatch);
    }
    secondPass = scopes.map((singleScope) => assessSingleScope(singleScope, opts));
  }

  const checks = markFixed(
    firstPass.flatMap((item) => item.checks),
    secondPass.flatMap((item) => item.checks),
  );

  if (scope === "both") {
    const userFinal = secondPass.find((item) => item.scope === "user");
    const projectFinal = secondPass.find((item) => item.scope === "project");

    if (userFinal && projectFinal) {
      if (userFinal.inspect.plugin_present && projectFinal.inspect.plugin_present) {
        checks.push({
          id: "both.plugin_ownership_split",
          severity: "warning",
          name: "plugin ownership split",
          message: "Nexus plugin entry exists in both user and project config (ownership split violation)",
          suggestion: "Keep plugin ownership in user scope only when using --scope=both",
          scope: "both",
        });
      } else {
        checks.push({
          id: "both.plugin_ownership_split",
          severity: "ok",
          name: "plugin ownership split",
          message: "Plugin ownership split is valid for both-mode",
          scope: "both",
        });
      }

      const userDefaultLead = userFinal.config?.default_agent === DEFAULT_AGENT;
      checks.push({
        id: "both.user_default_agent_ownership",
        severity: userDefaultLead ? "warning" : "ok",
        name: "default_agent ownership",
        message: userDefaultLead
          ? "default_agent=lead is set in user config (both-mode ownership expects this in project config)"
          : "default_agent ownership is valid for both-mode",
        suggestion: userDefaultLead
          ? "Move default_agent ownership to project scope for --scope=both installations"
          : undefined,
        scope: "both",
      });
    }
  }

  const state = mergeStates(secondPass.map((assessment) => classifyScopeState(assessment)));
  const summary = summarizeChecks(checks);
  return {
    scope,
    state,
    checks,
    summary,
  };
}

function checkSymbol(severity) {
  if (severity === "ok") return "✓";
  if (severity === "warning") return "!";
  return "✗";
}

/**
 * Format diagnostics as human-readable text.
 */
export function formatDiagnostics(result) {
  const lines = [`opencode-nexus doctor (scope: ${result.scope})`, ""];
  for (const check of result.checks) {
    const scopePrefix = result.scope === "both" && check.scope && check.scope !== "both" ? `${check.scope}: ` : "";
    lines.push(`${checkSymbol(check.severity)} ${scopePrefix}${check.name}: ${check.message}`);
    if (check.suggestion) {
      lines.push(`  → suggestion: ${check.suggestion}`);
    }
    if (check.fixed) {
      lines.push("  → fixed automatically");
    }
  }

  lines.push("");
  lines.push(`Summary: ${result.summary.warning} warning, ${result.summary.error} error  (state: ${result.state})`);
  return lines.join("\n");
}

/**
 * Format diagnostics as JSON (machine-readable).
 */
export function formatDiagnosticsJson(result) {
  return JSON.stringify(
    {
      scope: result.scope,
      state: result.state,
      checks: result.checks.map((check) => ({
        id: check.id,
        severity: check.severity,
        name: check.name,
        message: check.message,
        suggestion: check.suggestion,
        fixed: check.fixed,
      })),
      summary: result.summary,
    },
    null,
    2,
  );
}
