import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "@opencode-ai/plugin";
import { createNexusPaths } from "../shared/paths";
import { readJsonFile, writeJsonFile } from "../shared/json-store";
import { ensureNexusStructure, fileExists } from "../shared/state";
import { nxInit } from "./workflow";

const z = tool.schema;
const MARKER_START = "<!-- NEXUS:START -->";
const MARKER_END = "<!-- NEXUS:END -->";

export const nxSetup = tool({
  description: "Configure OpenCode Nexus files and inject the orchestration template",
  args: {
    scope: z.enum(["project", "user"]).default("project"),
    statusline_preset: z.enum(["full", "minimal", "skip"]).default("minimal"),
    install_plugin: z.boolean().default(true),
    init_after_setup: z.boolean().default(false),
    instructions_file: z.string().optional()
  },
  async execute(args, context) {
    const root = context.worktree ?? context.directory;
    const projectPaths = createNexusPaths(root);
    await ensureNexusStructure(projectPaths);

    const template = await readTemplate();
    const targets = resolveTargets(args.scope, root, args.instructions_file);
    await fs.mkdir(path.dirname(targets.instructionsFile), { recursive: true });
    await fs.mkdir(path.dirname(targets.configFile), { recursive: true });

    const instructionsContent = await buildInstructionsFile(targets.instructionsFile, template);
    await fs.writeFile(targets.instructionsFile, instructionsContent, "utf8");

    const config = await readJsonFile<Record<string, unknown>>(targets.configFile, { $schema: "https://opencode.ai/config.json" });
    const nextConfig = mergeSetupConfig(config, args.install_plugin, path.relative(path.dirname(targets.configFile), targets.instructionsFile) || path.basename(targets.instructionsFile));
    await writeJsonFile(targets.configFile, nextConfig);

    const nexusConfig = await readJsonFile<Record<string, unknown>>(projectPaths.CONFIG_FILE, {});
    nexusConfig.statuslinePreset = args.statusline_preset;
    nexusConfig.setupScope = args.scope;
    nexusConfig.instructionsFile = targets.instructionsFile;
    nexusConfig.updated_at = new Date().toISOString();
    await writeJsonFile(projectPaths.CONFIG_FILE, nexusConfig);

    const generatedFiles = [targets.instructionsFile, targets.configFile, projectPaths.CONFIG_FILE];
    let initResult: string | null = null;
    if (args.init_after_setup && args.scope === "project") {
      initResult = await nxInit.execute({ reset: false, setup_rules: false }, context);
    }

    return JSON.stringify(
      {
        configured: true,
        scope: args.scope,
        targetPaths: {
          instructionsFile: targets.instructionsFile,
          configFile: targets.configFile,
          nexusConfigFile: projectPaths.CONFIG_FILE
        },
        generatedFiles,
        mergePolicy: {
          preserveMarkerOutsideText: true,
          mergePluginArray: true,
          mergeInstructionsArray: true
        },
        initTriggered: args.init_after_setup && args.scope === "project",
        initResult
      },
      null,
      2
    );
  }
});

async function readTemplate(): Promise<string> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(currentDir, "../../templates/nexus-section.md");
  return fs.readFile(templatePath, "utf8");
}

function resolveTargets(scope: "project" | "user", projectRoot: string, instructionsFile?: string) {
  if (scope === "user") {
    const configRoot = path.join(os.homedir(), ".config", "opencode");
    return {
      configFile: path.join(configRoot, "opencode.json"),
      instructionsFile: instructionsFile ? expandHome(instructionsFile) : path.join(configRoot, "AGENTS.md")
    };
  }

  return {
    configFile: path.join(projectRoot, "opencode.json"),
    instructionsFile: instructionsFile ? path.resolve(projectRoot, instructionsFile) : path.join(projectRoot, "AGENTS.md")
  };
}

async function buildInstructionsFile(filePath: string, template: string): Promise<string> {
  const existing = (await fileExists(filePath)) ? await fs.readFile(filePath, "utf8") : "";
  const block = `${MARKER_START}\n${template.trim()}\n${MARKER_END}`;

  if (existing.includes(MARKER_START) && existing.includes(MARKER_END)) {
    const start = existing.indexOf(MARKER_START);
    const end = existing.indexOf(MARKER_END) + MARKER_END.length;
    return `${existing.slice(0, start)}${block}${existing.slice(end)}`;
  }

  const prefix = existing.trim().length > 0 ? `${existing.trim()}\n\n` : "";
  return `${prefix}${block}\n`;
}

function mergeSetupConfig(config: Record<string, unknown>, installPlugin: boolean, instructionsPath: string) {
  const next = { ...config };
  const plugin = Array.isArray(next.plugin) ? [...next.plugin] : [];
  if (installPlugin && !plugin.includes("opencode-nexus")) {
    plugin.push("opencode-nexus");
  }
  next.plugin = plugin;

  const instructions = Array.isArray(next.instructions) ? [...next.instructions] : [];
  if (!instructions.includes(instructionsPath)) {
    instructions.push(instructionsPath);
  }
  next.instructions = instructions;
  return next;
}

function expandHome(filePath: string): string {
  return filePath.startsWith("~/") ? path.join(os.homedir(), filePath.slice(2)) : filePath;
}
