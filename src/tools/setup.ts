import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "@opencode-ai/plugin";
import { createNexusPaths } from "../shared/paths.js";
import { readJsonFile, writeJsonFile } from "../shared/json-store.js";
import { ensureNexusStructure, fileExists } from "../shared/state.js";
import { nxInit } from "./workflow.js";

const z = tool.schema;
const MARKER_START = "<!-- NEXUS:START -->";
const MARKER_END = "<!-- NEXUS:END -->";

export const nxSetup = tool({
  description: "Configure OpenCode Nexus files and inject the orchestration template",
  args: {
    scope: z.enum(["project", "user"]).default("project"),
    profile: z.enum(["auto", "full", "minimal", "legacy-compat"]).default("auto"),
    statusline_preset: z.enum(["full", "minimal", "skip"]).default("minimal"),
    install_plugin: z.boolean().default(true),
    init_after_setup: z.boolean().default(false),
    instructions_file: z.string().optional()
  },
  async execute(args, context) {
    const root = context.worktree ?? context.directory;
    const scope = args.scope ?? "project";
    const profile = args.profile ?? "auto";
    const statuslinePreset = args.statusline_preset ?? "minimal";
    const installPlugin = args.install_plugin ?? true;
    const initAfterSetup = args.init_after_setup ?? false;
    const projectPaths = createNexusPaths(root);
    await ensureNexusStructure(projectPaths);

    const template = await readTemplate();
    const targets = resolveTargets(scope, root, args.instructions_file);
    const capabilities = await detectSetupCapabilities(root, scope);
    const resolvedProfile = resolveSetupProfile(profile, capabilities);
    await fs.mkdir(path.dirname(targets.instructionsFile), { recursive: true });
    await fs.mkdir(path.dirname(targets.configFile), { recursive: true });

    const instructionsContent = await buildInstructionsFile(targets.instructionsFile, template);
    await fs.writeFile(targets.instructionsFile, instructionsContent, "utf8");

    const config = await readJsonFile<Record<string, unknown>>(targets.configFile, { $schema: "https://opencode.ai/config.json" });
    const nextConfig = mergeSetupConfig({
      config,
      installPlugin,
      instructionsPath:
        path.relative(path.dirname(targets.configFile), targets.instructionsFile) || path.basename(targets.instructionsFile),
      profile: resolvedProfile,
      selfHostedLocalPlugin: capabilities.localPluginShim
    });
    await writeJsonFile(targets.configFile, nextConfig);

    const nexusConfig = await readJsonFile<Record<string, unknown>>(projectPaths.CONFIG_FILE, {});
    nexusConfig.statuslinePreset = statuslinePreset;
    nexusConfig.setupScope = scope;
    nexusConfig.setupProfile = resolvedProfile;
    nexusConfig.instructionsFile = targets.instructionsFile;
    nexusConfig.setupCapabilities = capabilities;
    nexusConfig.updated_at = new Date().toISOString();
    await writeJsonFile(projectPaths.CONFIG_FILE, nexusConfig);

    const generatedFiles = [targets.instructionsFile, targets.configFile, projectPaths.CONFIG_FILE];
    let initResult: string | null = null;
    if (initAfterSetup && scope === "project") {
      initResult = await nxInit.execute({ reset: false, setup_rules: false }, context);
    }

    return JSON.stringify(
      {
        configured: true,
        scope,
        targetPaths: {
          instructionsFile: targets.instructionsFile,
          configFile: targets.configFile,
          nexusConfigFile: projectPaths.CONFIG_FILE
        },
        generatedFiles,
        profile: resolvedProfile,
        capabilityReport: capabilities,
        pluginStrategy: capabilities.localPluginShim && resolvedProfile !== "legacy-compat" ? "local-shim" : installPlugin ? "package" : "skip",
        defaultAgent: "nexus",
        mergePolicy: {
          preserveMarkerOutsideText: true,
          mergePluginArray: resolvedProfile !== "minimal",
          mergeInstructionsArray: true
        },
        warnings: buildSetupWarnings(capabilities, resolvedProfile),
        initTriggered: initAfterSetup && scope === "project",
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

function mergeSetupConfig(input: {
  config: Record<string, unknown>;
  installPlugin: boolean;
  instructionsPath: string;
  profile: "full" | "minimal" | "legacy-compat";
  selfHostedLocalPlugin: boolean;
}) {
  const { config, installPlugin, instructionsPath, profile, selfHostedLocalPlugin } = input;
  const next = { ...config };
  const plugin = Array.isArray(next.plugin) ? [...next.plugin] : [];
  const filteredPlugin = selfHostedLocalPlugin && profile !== "legacy-compat"
    ? plugin.filter((entry) => entry !== "opencode-nexus")
    : plugin;

  if (installPlugin && profile !== "minimal" && !selfHostedLocalPlugin && !filteredPlugin.includes("opencode-nexus")) {
    filteredPlugin.push("opencode-nexus");
  }
  if (installPlugin && profile === "legacy-compat" && !filteredPlugin.includes("opencode-nexus")) {
    filteredPlugin.push("opencode-nexus");
  }
  next.plugin = filteredPlugin;

  const instructions = Array.isArray(next.instructions) ? [...next.instructions] : [];
  if (!instructions.includes(instructionsPath)) {
    instructions.push(instructionsPath);
  }
  next.instructions = instructions;

  const agent = toRecord(next.agent);
  if (!agent.nexus) {
    agent.nexus = {
      description: "Nexus-aware orchestration lead for meet, run, delegation, and verification workflows",
      mode: "primary",
      color: "accent"
    };
  }
  next.agent = agent;

  if (typeof next.default_agent !== "string" || next.default_agent.trim().length === 0) {
    next.default_agent = "nexus";
  }

  return next;
}

async function detectSetupCapabilities(projectRoot: string, scope: "project" | "user") {
  const localPluginShim = await fileExists(path.join(projectRoot, ".opencode", "plugins", "opencode-nexus.js"));
  const localPluginBuild = await fileExists(path.join(projectRoot, "dist", "index.js"));
  return {
    scope,
    localPluginShim,
    localPluginBuild,
    selfHostedProject: scope === "project" && localPluginShim
  };
}

function resolveSetupProfile(
  profile: "auto" | "full" | "minimal" | "legacy-compat",
  capabilities: { selfHostedProject: boolean }
): "full" | "minimal" | "legacy-compat" {
  if (profile !== "auto") {
    return profile;
  }

  return capabilities.selfHostedProject ? "minimal" : "full";
}

function buildSetupWarnings(
  capabilities: { selfHostedProject: boolean; localPluginBuild: boolean },
  profile: "full" | "minimal" | "legacy-compat"
): string[] {
  const warnings: string[] = [];
  if (capabilities.selfHostedProject && profile !== "legacy-compat") {
    warnings.push("Self-hosting project detected; package plugin registration was not added to avoid dual-loading with the local plugin shim.");
  }
  if (capabilities.selfHostedProject && !capabilities.localPluginBuild) {
    warnings.push("Local plugin shim exists but dist/index.js is missing. Run bun run build before validating the plugin in OpenCode.");
  }
  return warnings;
}

function expandHome(filePath: string): string {
  return filePath.startsWith("~/") ? path.join(os.homedir(), filePath.slice(2)) : filePath;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
