#!/usr/bin/env node
// opencode-nexus CLI — install/uninstall/doctor canonical mutator.
// Design: plan #58 decisions (Issue #1/#2/#3/#5).

import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, exit } from "node:process";
import { resolve as pathResolve } from "node:path";
import { readConfig, computePatch, applyPatch, renderPatch } from "../lib/config-merge.mjs";
import { installSkills, uninstallSkills } from "../lib/skills-copy.mjs";
import { diagnose, formatDiagnostics, formatDiagnosticsJson } from "../lib/doctor.mjs";
import { userConfigPath, projectConfigPath, PACKAGE_NAME, DEFAULT_AGENT } from "../lib/install-spec.mjs";

const HELP = `opencode-nexus CLI

Usage:
  opencode-nexus <command> [options]

Commands:
  install     Install config patch + skills
  uninstall   Remove managed config and optionally purge skills
  doctor      Diagnose install state

Global Options:
  -h, --help      Show help
  -v, --version   Show package version

Examples:
  opencode-nexus install --scope=project --yes
  opencode-nexus uninstall --scope=both --purge --yes
  opencode-nexus doctor --scope=both --json
`;

const INSTALL_HELP = `Usage:
  opencode-nexus install [--scope=user|project|both] [--yes] [--dry-run] [--force] [--skills=user|project|both] [--normalize]

Options:
  --scope         Install target scope
  --yes           Skip confirmation prompts
  --dry-run       Print planned config changes and exit
  --force         Overwrite conflicting default_agent in project scope
  --skills        Skills install target (default: project)
  --normalize     Collapse duplicate Nexus plugin entries

Examples:
  opencode-nexus install --scope=project --yes
  opencode-nexus install --scope=both --skills=both
  opencode-nexus install --scope=user --dry-run
`;

const UNINSTALL_HELP = `Usage:
  opencode-nexus uninstall [--scope=user|project|both] [--yes] [--purge]

Options:
  --scope         Uninstall target scope
  --yes           Skip confirmation prompts
  --purge         Remove installed skills files (default: preserve)

Examples:
  opencode-nexus uninstall --scope=project --yes
  opencode-nexus uninstall --scope=both --purge --yes
`;

const DOCTOR_HELP = `Usage:
  opencode-nexus doctor [--scope=user|project|both] [--json] [--fix]

Options:
  --scope         Diagnostic target scope
  --json          Print machine-readable diagnostics
  --fix           Auto-fix non-destructive normalization issues

Examples:
  opencode-nexus doctor --scope=project
  opencode-nexus doctor --scope=both --json
  opencode-nexus doctor --scope=user --fix
`;

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function getVersion() {
  const pkgPath = new URL("../package.json", import.meta.url);
  const raw = readFileSync(pkgPath, "utf8");
  const parsed = JSON.parse(raw);
  return parsed.version;
}

function isInteractive() {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

function normalizeScope(value, fallback) {
  const scope = value ?? fallback;
  if (!["user", "project", "both"].includes(scope)) {
    throw new CliError(`Invalid scope: ${scope}. Expected one of: user, project, both.`, 1);
  }
  return scope;
}

function normalizeSkillsScope(value, fallback = "project") {
  const scope = value ?? fallback;
  if (!["user", "project", "both"].includes(scope)) {
    throw new CliError(`Invalid skills scope: ${scope}. Expected one of: user, project, both.`, 1);
  }
  return scope;
}

function scopesFromValue(scope) {
  return scope === "both" ? ["user", "project"] : [scope];
}

function resolveConfigPath(scope, cwd) {
  return scope === "user" ? userConfigPath() : projectConfigPath(cwd);
}

function ownershipFor(scope, commandScope) {
  if (commandScope === "both") {
    if (scope === "user") {
      return { ownsPlugin: true, ownsDefaultAgent: false, ownsMcp: true };
    }
    return { ownsPlugin: false, ownsDefaultAgent: true, ownsMcp: false };
  }

  if (scope === "user") return { ownsPlugin: true, ownsDefaultAgent: false, ownsMcp: true };
  return { ownsPlugin: true, ownsDefaultAgent: true, ownsMcp: true };
}

function countWritableChanges(patch) {
  return patch.changes.filter((change) => change.op !== "warn").length;
}

async function withReadline(fn) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await fn(rl);
  } finally {
    rl.close();
  }
}

async function promptScope(command) {
  return withReadline(async (rl) => {
    const answer = (await rl.question(`Select ${command} scope [user/project/both] (project): `)).trim();
    return normalizeScope(answer || "project", "project");
  });
}

async function promptYesNo(question) {
  return withReadline(async (rl) => {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  });
}

function renderAndPrintDryRun(scopePatches) {
  for (const item of scopePatches) {
    const rendered = renderPatch(item.patch, item.path, item.scope);
    console.log(rendered.summary);
  }
}

function isJsoncError(error) {
  return error instanceof Error && /JSONC syntax|strict JSON/i.test(error.message);
}

function formatWriteError(path, error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EACCES") {
    return new CliError(`Cannot write to ${path}: EACCES. Check file permissions.`, 2);
  }
  if (error instanceof Error) return new CliError(error.message, 2);
  return new CliError(String(error), 2);
}

async function runInstall(values) {
  const cwd = pathResolve(process.cwd());
  const interactive = isInteractive();
  const scope = values.scope ? normalizeScope(values.scope, "project") : interactive ? await promptScope("install") : "project";
  const yes = values.yes === true;
  const dryRun = values["dry-run"] === true;
  const force = values.force === true;
  const normalize = values.normalize === true;
  const defaultSkillsScope = scope === "user" ? "user" : "project";
  const skillsScope = normalizeSkillsScope(values.skills, defaultSkillsScope);

  const configScopes = scopesFromValue(scope);
  const scopePatches = [];

  for (const singleScope of configScopes) {
    const path = resolveConfigPath(singleScope, cwd);
    let parsed;
    try {
      parsed = readConfig(path);
    } catch (error) {
      if (isJsoncError(error)) throw new CliError(error.message, 1);
      throw new CliError(error instanceof Error ? error.message : String(error), 2);
    }

    const patch = computePatch(parsed.config, singleScope, "install", {
      force,
      normalize,
      ...ownershipFor(singleScope, scope),
    });

    scopePatches.push({ scope: singleScope, path, patch });
  }

  if (dryRun) {
    renderAndPrintDryRun(scopePatches);
    console.log(`(dry-run) skills target scope: ${skillsScope}`);
    return 0;
  }

  const writeResults = [];
  const failures = [];
  for (const item of scopePatches) {
    const writableChanges = countWritableChanges(item.patch);
    if (interactive && writableChanges > 0 && !yes) {
      const ok = await promptYesNo(`Apply ${writableChanges} changes to ${item.path}? [y/N] `);
      if (!ok) {
        console.log(`Skipped ${item.scope} changes.`);
        continue;
      }
    }

    try {
      const applied = applyPatch(item.path, item.patch);
      writeResults.push({ ...item, applied });
    } catch (error) {
      failures.push({ scope: item.scope, error: formatWriteError(item.path, error) });
    }
  }

  const skillScopes = scopesFromValue(skillsScope);
  const skillResults = [];
  for (const singleScope of skillScopes) {
    try {
      const installed = installSkills(singleScope, { cwd, force });
      skillResults.push({ scope: singleScope, ...installed });
    } catch (error) {
      failures.push({
        scope: singleScope,
        error: new CliError(error instanceof Error ? error.message : String(error), 2),
      });
    }
  }

  if (failures.length > 0) {
    if (scope === "both" && (writeResults.length > 0 || skillResults.length > 0)) {
      throw new CliError(
        `Partial failure in both-mode: ${failures.map((item) => `${item.scope}: ${item.error.message}`).join("; ")}`,
        3,
      );
    }
    throw failures[0].error;
  }

  for (const item of writeResults) {
    for (const change of item.patch.changes) {
      if (change.op !== "warn") continue;
      console.warn(`[${item.scope}] warning: ${change.note}`);
    }

    const writableChanges = countWritableChanges(item.patch);
    if (!item.patch.hasChanges) {
      console.log(`[${item.scope}] no config changes (${item.path})`);
      continue;
    }
    const backupText = item.applied.backupPath ? `, backup: ${item.applied.backupPath}` : "";
    console.log(`[${item.scope}] applied ${writableChanges} config changes to ${item.path}${backupText}`);
  }

  for (const item of skillResults) {
    if (item.missingSource.length > 0) {
      console.warn(`[${item.scope}] warning: missing bundled skill sources: ${item.missingSource.join(", ")}`);
    }
    console.log(
      `[${item.scope}] skills copied=${item.copied.length}, skipped=${item.skipped.length}`,
    );
  }

  return 0;
}

async function runUninstall(values) {
  const cwd = pathResolve(process.cwd());
  const interactive = isInteractive();
  const scope = values.scope ? normalizeScope(values.scope, "project") : interactive ? await promptScope("uninstall") : "project";
  const yes = values.yes === true;
  const purge = values.purge === true;
  const configScopes = scopesFromValue(scope);

  const scopePatches = [];
  for (const singleScope of configScopes) {
    const path = resolveConfigPath(singleScope, cwd);
    let parsed;
    try {
      parsed = readConfig(path);
    } catch (error) {
      if (isJsoncError(error)) throw new CliError(error.message, 1);
      throw new CliError(error instanceof Error ? error.message : String(error), 2);
    }

    const patch = computePatch(parsed.config, singleScope, "uninstall", {
      ...ownershipFor(singleScope, scope),
    });

    scopePatches.push({ scope: singleScope, path, patch, config: parsed.config });
  }

  const writeResults = [];
  const failures = [];
  for (const item of scopePatches) {
    if (interactive && !yes) {
      const ok = await promptYesNo(`Remove ${PACKAGE_NAME} from ${item.scope}? [y/N] `);
      if (!ok) {
        console.log(`Skipped ${item.scope} uninstall.`);
        continue;
      }
    }

    if (item.config?.default_agent === DEFAULT_AGENT) {
      console.warn(`[${item.scope}] warning: default_agent is "${DEFAULT_AGENT}". This may be intentional outside Nexus.`);
      if (interactive && !yes) {
        const proceed = await promptYesNo(`Continue uninstall for ${item.scope} with default_agent="${DEFAULT_AGENT}"? [y/N] `);
        if (!proceed) {
          console.log(`Skipped ${item.scope} uninstall due to default_agent confirmation.`);
          continue;
        }
      }
    }

    try {
      const applied = applyPatch(item.path, item.patch);
      writeResults.push({ ...item, applied });
    } catch (error) {
      failures.push({ scope: item.scope, error: formatWriteError(item.path, error) });
    }
  }

  const skillResults = [];
  if (purge) {
    for (const singleScope of configScopes) {
      try {
        const removed = uninstallSkills(singleScope, { cwd, purge: true });
        skillResults.push({ scope: singleScope, ...removed });
      } catch (error) {
        failures.push({
          scope: singleScope,
          error: new CliError(error instanceof Error ? error.message : String(error), 2),
        });
      }
    }
  }

  if (failures.length > 0) {
    if (scope === "both" && (writeResults.length > 0 || skillResults.length > 0)) {
      throw new CliError(
        `Partial failure in both-mode: ${failures.map((item) => `${item.scope}: ${item.error.message}`).join("; ")}`,
        3,
      );
    }
    throw failures[0].error;
  }

  for (const item of writeResults) {
    const writableChanges = countWritableChanges(item.patch);
    if (!item.patch.hasChanges) {
      console.log(`[${item.scope}] no config changes (${item.path})`);
      continue;
    }
    const backupText = item.applied.backupPath ? `, backup: ${item.applied.backupPath}` : "";
    console.log(`[${item.scope}] removed ${writableChanges} managed config changes from ${item.path}${backupText}`);
  }

  if (purge) {
    for (const item of skillResults) {
      console.log(`[${item.scope}] purged skills: removed=${item.removed.length}`);
    }
  } else {
    for (const singleScope of configScopes) {
      console.log(`[${singleScope}] skills preserved (use --purge to remove skill files)`);
    }
  }

  return 0;
}

async function runDoctor(values) {
  const cwd = pathResolve(process.cwd());
  const scope = normalizeScope(values.scope, "project");
  const json = values.json === true;
  const fix = values.fix === true;

  let result;
  try {
    result = diagnose(scope, { cwd, fix });
  } catch (error) {
    if (isJsoncError(error)) {
      throw new CliError(error instanceof Error ? error.message : String(error), 1);
    }
    throw error;
  }

  if (json) {
    console.log(formatDiagnosticsJson(result));
  } else {
    console.log(formatDiagnostics(result));
  }

  return result.summary.error > 0 ? 1 : 0;
}

async function main() {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    strict: false,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      scope: { type: "string" },
      yes: { type: "boolean" },
      "dry-run": { type: "boolean" },
      force: { type: "boolean" },
      skills: { type: "string" },
      normalize: { type: "boolean" },
      purge: { type: "boolean" },
      json: { type: "boolean" },
      fix: { type: "boolean" },
    },
  });

  const [command] = parsed.positionals;

  if (!command) {
    if (parsed.values.version) {
      console.log(getVersion());
      return;
    }
    console.log(HELP);
    return;
  }

  if (parsed.values.version) {
    console.log(getVersion());
    return;
  }

  if (command === "help") {
    console.log(HELP);
    return;
  }

  if (command === "install") {
    if (parsed.values.help) {
      console.log(INSTALL_HELP);
      return;
    }
    const code = await runInstall(parsed.values);
    if (code !== 0) exit(code);
    return;
  }

  if (command === "uninstall") {
    if (parsed.values.help) {
      console.log(UNINSTALL_HELP);
      return;
    }
    const code = await runUninstall(parsed.values);
    if (code !== 0) exit(code);
    return;
  }

  if (command === "doctor") {
    if (parsed.values.help) {
      console.log(DOCTOR_HELP);
      return;
    }
    const code = await runDoctor(parsed.values);
    if (code !== 0) exit(code);
    return;
  }

  if (parsed.values.help) {
    console.log(HELP);
    return;
  }

  throw new CliError(`Unknown command: ${command}. Run --help for usage.`, 1);
}

main().catch((err) => {
  if (err instanceof CliError) {
    console.error(`opencode-nexus: ${err.message}`);
    exit(err.exitCode);
  }

  if (isJsoncError(err)) {
    console.error(`opencode-nexus: ${err instanceof Error ? err.message : String(err)}`);
    exit(1);
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error(`opencode-nexus: ${message}`);
  exit(2);
});
