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
import { install } from "../lib/install.mjs";

const HELP = `opencode-nexus

Usage:
  opencode-nexus install [--scope=project|user|both] [--dry-run] [--force] [--skip-models]
  opencode-nexus models [--scope=project|user|both]
  opencode-nexus models [--scope=project|user|both] --agents=lead,architect --model=openai/gpt-5.4

Commands:
  install   Merge the pinned Nexus plugin config and copy core skills
  models    Configure per-agent model overrides
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
    },
  });

  const [command = "install"] = args.positionals;
  if (args.values.help || command === "help") {
    console.log(HELP);
    return;
  }

  if (command !== "install") {
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
