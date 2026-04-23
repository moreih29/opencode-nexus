#!/usr/bin/env node

import { parseArgs } from "node:util";
import {
  canUseInteractiveTerminal,
  configureAgentModelsDirect,
  configureAgentModelsInteractive,
} from "../lib/agent-models.mjs";
import {
  selectConfigureModelsNowInteractive,
  selectInstallScopeInteractive,
} from "../lib/install-ui.mjs";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../lib/install-spec.mjs";
import { install } from "../lib/install.mjs";
import { uninstall } from "../lib/uninstall.mjs";
import {
  confirmUninstallInteractive,
  selectUninstallScopeInteractive,
} from "../lib/uninstall-ui.mjs";

const HELP = `opencode-nexus

Usage:
  opencode-nexus install [--scope=project|user|both] [--dry-run] [--force] [--skip-models]
  opencode-nexus uninstall [--scope=project|user|both] [--dry-run] [--force]
  opencode-nexus models [--scope=project|user|both]
  opencode-nexus models [--scope=project|user|both] --agents=lead,architect --model=openai/gpt-5.4
  opencode-nexus version

Commands:
  install     Merge the pinned Nexus plugin config and copy core skills
  uninstall   Revert the Nexus config keys and skills we installed (non-Nexus entries are preserved)
  models      Configure per-agent model overrides
  version     Print the CLI version

Options:
  -h, --help     Show this help
      --version  Show CLI version
`;

function printInstallResult(result, dryRun) {
  if (typeof result.packageSpec === "string") {
    console.log(`${dryRun ? "would pin" : "pinned"}: ${result.packageSpec}`);
  }

  const verb = dryRun ? "would write" : "wrote";
  for (const entry of result.writes) {
    console.log(`${verb}: ${entry.path}`);
  }

  const skillVerb = dryRun ? "would copy" : "copied";
  for (const entry of result.copiedSkills) {
    console.log(`${skillVerb}: ${entry.skills.join(", ")} -> ${entry.targetDir}`);
  }

  for (const warning of result.warnings) {
    console.warn(`warning: ${warning}`);
  }
}

function printModelResult(result) {
  if (Array.isArray(result.agentIds)) {
    console.log(`updated: ${result.agentIds.join(", ")} -> ${result.model}`);
    console.log(`wrote: ${result.configPath}`);
  }
}

function printUninstallResult(result, dryRun) {
  if (result.noOp) {
    console.log(`nothing to remove for scope: ${result.scope} (no opencode-nexus markers found)`);
    return;
  }

  for (const entry of result.writes) {
    if (entry.json === null) {
      console.log(`${dryRun ? "would remove" : "removed"}: ${entry.path}`);
      continue;
    }

    console.log(`${dryRun ? "would write" : "wrote"}: ${entry.path}`);
  }

  for (const entry of result.removedSkills) {
    console.log(`${dryRun ? "would remove" : "removed"}: ${entry.skills.join(", ")} <- ${entry.targetDir}`);
  }

  const removedViaWrites = new Set(result.writes.filter((entry) => entry.json === null).map((entry) => entry.path));
  for (const path of result.deletedFiles) {
    if (!removedViaWrites.has(path)) {
      console.log(`${dryRun ? "would remove" : "removed"}: ${path}`);
    }
  }

  for (const path of result.deletedDirs) {
    console.log(`${dryRun ? "would remove empty dir" : "removed empty dir"}: ${path}`);
  }

  for (const warning of result.warnings) {
    console.warn(`warning: ${warning}`);
  }
}

async function main() {
  const args = parseArgs({
    allowPositionals: true,
    options: {
      scope: { type: "string" },
      "dry-run": { type: "boolean" },
      force: { type: "boolean" },
      "skip-models": { type: "boolean" },
      agents: { type: "string" },
      model: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
  });

  const [command = "install"] = args.positionals;
  if (args.values.help || command === "help") {
    console.log(HELP);
    return;
  }

  if (args.values.version === true || command === "version") {
    console.log(`${PACKAGE_NAME} ${PACKAGE_VERSION}`);
    return;
  }

  if (command !== "install") {
    if (command === "uninstall") {
      const dryRun = args.values["dry-run"] === true;
      const force = args.values.force === true;
      const interactive = canUseInteractiveTerminal();

      let selectedScope = typeof args.values.scope === "string" ? args.values.scope : undefined;
      if (selectedScope !== "project" && selectedScope !== "user" && selectedScope !== "both") {
        selectedScope = undefined;
      }

      if (selectedScope === undefined && !dryRun && interactive) {
        selectedScope = await selectUninstallScopeInteractive();
        if (selectedScope === null) {
          return;
        }
      }

      if (selectedScope === undefined) {
        throw new Error("uninstall requires --scope=project|user|both in non-interactive environments.");
      }

      if (!interactive && !force && !dryRun) {
        throw new Error("Use --force for non-interactive removal");
      }

      if (interactive && !force && !dryRun) {
        const answer = await confirmUninstallInteractive({ scope: selectedScope });
        if (answer !== "yes") {
          return;
        }
      }

      const result = uninstall({
        scope: selectedScope,
        cwd: process.cwd(),
        dryRun,
        force,
      });
      printUninstallResult(result, dryRun);
      return;
    }

    if (command !== "models") {
      throw new Error(`Unknown command: ${command}`);
    }

    const hasDirectArgs = typeof args.values.agents === "string" || typeof args.values.model === "string";
    if (hasDirectArgs) {
      if (typeof args.values.agents !== "string" || typeof args.values.model !== "string") {
        throw new Error("The models command requires both --agents and --model when using direct mode.");
      }

      const result = await configureAgentModelsDirect({
        scope: args.values.scope ?? "project",
        agents: args.values.agents,
        model: args.values.model,
      });
      printModelResult(result);
      return;
    }

    const result = await configureAgentModelsInteractive({
      scope: args.values.scope,
    });

    if (result.saved) {
      console.log(`wrote: ${result.configPath}`);
    }
    return;
  }

  let selectedScope = typeof args.values.scope === "string" ? args.values.scope : undefined;

  if (args.values["dry-run"] !== true && canUseInteractiveTerminal()) {
    if (selectedScope !== "project" && selectedScope !== "user" && selectedScope !== "both") {
      selectedScope = await selectInstallScopeInteractive();
      if (selectedScope === null) {
        return;
      }
    }
  }

  const result = install({
    scope: selectedScope ?? "project",
    dryRun: args.values["dry-run"] === true,
    force: args.values.force === true,
  });

  printInstallResult(result, args.values["dry-run"] === true);

  if (args.values["dry-run"] === true || args.values["skip-models"] === true) {
    return;
  }

  if (typeof args.values.agents === "string" || typeof args.values.model === "string") {
    if (typeof args.values.agents !== "string" || typeof args.values.model !== "string") {
      throw new Error("Install direct model mode requires both --agents and --model.");
    }

    const modelResult = await configureAgentModelsDirect({
      scope: selectedScope === "project" || selectedScope === "user" ? selectedScope : "project",
      agents: args.values.agents,
      model: args.values.model,
    });
    printModelResult(modelResult);
    return;
  }

  if (!canUseInteractiveTerminal()) {
    return;
  }

  const configureNow = await selectConfigureModelsNowInteractive();
  if (configureNow !== "yes") {
    return;
  }

  const interactiveResult = await configureAgentModelsInteractive({
    scope: selectedScope === "project" || selectedScope === "user" ? selectedScope : undefined,
  });
  if (interactiveResult.saved) {
    console.log(`wrote: ${interactiveResult.configPath}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
