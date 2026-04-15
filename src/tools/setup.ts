import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tool } from "@opencode-ai/plugin";
import { createNexusPaths } from "../shared/paths.js";
import { readJsonFile, writeJsonFile } from "../shared/json-store.js";
import { ensureNexusStructure, fileExists } from "../shared/state.js";
import { nxInit } from "./workflow.js";
import { AGENT_META } from "../agents/generated/index.js";

const z = tool.schema;
const MARKER_START = "<!-- NEXUS:START -->";
const MARKER_END = "<!-- NEXUS:END -->";
const DEFAULT_BUILTIN_AGENT_IDS = ["general", "explore"] as const;
const DEFAULT_BUILTIN_AGENT_ID_SET = new Set<string>(DEFAULT_BUILTIN_AGENT_IDS);

export const nxSetup = tool({
  description: "Configure OpenCode Nexus files and inject the orchestration template",
  args: {
    scope: z.enum(["project", "user"]).default("user"),
    profile: z.enum(["auto", "full", "minimal", "legacy-compat"]).default("auto"),
    install_plugin: z.boolean().default(true),
    init_after_setup: z.boolean().default(false),
    instructions_file: z.string().optional(),
    permission_preset: z.enum(["permissive", "standard", "restrictive", "skip"]).default("skip"),
    model_preset: z.enum(["unified", "tiered", "custom", "skip"]).default("skip"),
    lead_model: z.string().optional(),
    agent_models: z.record(z.string(), z.string()).optional(),
    models: z.object({
      unified: z.string().optional(),
      nexus: z.string().optional(),
      how: z.string().optional(),
      do: z.string().optional(),
      check: z.string().optional(),
      agents: z.record(z.string(), z.string()).optional()
    }).optional()
  },
  async execute(args, context) {
    const root = context.worktree ?? context.directory;
    const scope = args.scope ?? "user";
    const profile = args.profile ?? "auto";
    const installPlugin = args.install_plugin ?? true;
    const initAfterSetup = args.init_after_setup ?? false;
    const modelPreset = args.model_preset ?? "skip";
    const permissionPreset = args.permission_preset ?? "skip";
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
    const skillFiles = await installEntrypointSkills(targets.skillsRoot);

    const config = await readJsonFile<Record<string, unknown>>(targets.configFile, { $schema: "https://opencode.ai/config.json" });
    const next = mergeSetupConfig({
      config,
      installPlugin,
      instructionsPath:
        path.relative(path.dirname(targets.configFile), targets.instructionsFile) || path.basename(targets.instructionsFile),
      profile: resolvedProfile,
      selfHostedLocalPlugin: capabilities.localPluginShim
    });
    const modelDiscovery = await detectModelDiscovery(next, targets.configFile);

    const resolvedAgentModels = mergeAgentModels(
      next,
      args.agent_models as Record<string, string> | undefined,
      modelPreset,
      args.lead_model,
      args.models,
      Object.values(AGENT_META)
    );
    mergePermissionPreset(next, permissionPreset);

    await writeJsonFile(targets.configFile, next);

    const generatedFiles = [targets.instructionsFile, targets.configFile, ...skillFiles];
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
          skillsRoot: targets.skillsRoot
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
        initResult,
        modelConfiguration: {
          preset: modelPreset,
          leadModel: args.lead_model ?? null,
          agentModels: resolvedAgentModels,
          additiveModels: args.models ?? null,
          discovery: modelDiscovery
        },
        permissionPreset
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

async function detectModelDiscovery(config: Record<string, unknown>, configFile: string) {
  const configuredProviders = readConfiguredProviders(config);
  const authProviders = await readAuthenticatedProviders();
  const availableProviders = uniqueStrings([...authProviders, ...configuredProviders]);
  const configuredModels = readConfiguredModels(config);

  return {
    recommendedScope: "user",
    configFile,
    availableProviders,
    authenticatedProviders: authProviders,
    configuredProviders,
    configuredModels,
    recommendation:
      availableProviders.length > 0
        ? `Recommend models from connected providers first: ${availableProviders.join(", ")}. Use \`opencode models <provider>\` to inspect concrete options.`
        : "No connected providers detected from config/auth state. Ask the user which provider they use or point them to `/connect` before recommending models."
  };
}

function readConfiguredProviders(config: Record<string, unknown>): string[] {
  const provider = toRecord(config.provider);
  const enabledProviders = toStringArray(config.enabled_providers);
  const disabledProviders = new Set(toStringArray(config.disabled_providers));
  const fromProviderConfig = Object.keys(provider).filter((id) => !disabledProviders.has(id));
  return uniqueStrings([...enabledProviders.filter((id) => !disabledProviders.has(id)), ...fromProviderConfig]);
}

async function readAuthenticatedProviders(): Promise<string[]> {
  const authPath = path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
  if (!(await fileExists(authPath))) {
    return [];
  }

  try {
    const auth = await readJsonFile<unknown>(authPath, {});
    return extractProviderIds(auth);
  } catch {
    return [];
  }
}

function extractProviderIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((entry) => extractProviderIds(entry)));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const discovered = new Set<string>();
  const directProvider = firstNonEmptyString(record.provider, record.providerID, record.id);
  if (directProvider && isProviderIdCandidate(directProvider)) {
    discovered.add(directProvider);
  }

  for (const [key, nested] of Object.entries(record)) {
    if (isProviderIdCandidate(key) && nested && typeof nested === "object") {
      discovered.add(key);
    }
    for (const nestedId of extractProviderIds(nested)) {
      discovered.add(nestedId);
    }
  }

  return [...discovered];
}

function readConfiguredModels(config: Record<string, unknown>): string[] {
  const agent = toRecord(config.agent);
  const models = new Set<string>();

  const rootModel = asString(config.model);
  const smallModel = asString(config.small_model);
  if (rootModel) {
    models.add(rootModel);
  }
  if (smallModel) {
    models.add(smallModel);
  }

  for (const entry of Object.values(agent)) {
    const model = asString(toRecord(entry).model);
    if (model) {
      models.add(model);
    }
  }

  return [...models];
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asString(value);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function isProviderIdCandidate(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(value) && !value.includes("/") && !value.startsWith("http");
}

async function readEntrypointSkillTemplate(name: "nx-init" | "nx-sync" | "nx-setup" | "nx-plan" | "nx-run"): Promise<string> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.resolve(currentDir, `../../templates/skills/${name}/SKILL.md`);
  return fs.readFile(templatePath, "utf8");
}

function resolveTargets(scope: "project" | "user", projectRoot: string, instructionsFile?: string) {
  if (scope === "user") {
    const configRoot = path.join(os.homedir(), ".config", "opencode");
    return {
      configFile: path.join(configRoot, "opencode.json"),
      instructionsFile: instructionsFile ? expandHome(instructionsFile) : path.join(configRoot, "AGENTS.md"),
      skillsRoot: path.join(configRoot, "skills")
    };
  }

  return {
    configFile: path.join(projectRoot, "opencode.json"),
    instructionsFile: instructionsFile ? path.resolve(projectRoot, instructionsFile) : path.join(projectRoot, "AGENTS.md"),
    skillsRoot: path.join(projectRoot, ".opencode", "skills")
  };
}

async function installEntrypointSkills(skillsRoot: string): Promise<string[]> {
  const skillNames = ["nx-init", "nx-sync", "nx-setup", "nx-plan", "nx-run"] as const;
  const generatedFiles: string[] = [];
  await fs.mkdir(skillsRoot, { recursive: true });

  for (const name of skillNames) {
    const skillDir = path.join(skillsRoot, name);
    const skillFile = path.join(skillDir, "SKILL.md");
    const skillTemplate = await readEntrypointSkillTemplate(name);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(skillFile, skillTemplate, "utf8");
    generatedFiles.push(skillFile);
  }

  return generatedFiles;
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
      description: "Nexus-aware orchestration lead for plan, run, delegation, and verification workflows",
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

function mergeAgentModels(
  config: Record<string, unknown>,
  explicitModels: Record<string, string> | undefined,
  preset: "unified" | "tiered" | "custom" | "skip",
  leadModel: string | undefined,
  additiveModels: { unified?: string; nexus?: string; how?: string; do?: string; check?: string; agents?: Record<string, string> } | undefined,
  catalog: { id: string; category: string; model: string }[]
): Record<string, string> {
  const agent = toRecord(config.agent);
  const resolved: Record<string, string> = {};

  const groupModels = resolveGroupModels(preset, leadModel, additiveModels);
  const hasGroupModels = groupModels.unified || groupModels.nexus || groupModels.how || groupModels.do || groupModels.check;
  const standardTierModel = resolveStandardTierModel(groupModels);

  if (hasGroupModels) {
    for (const profile of catalog) {
      const model = resolveModelForAgent(profile, groupModels);
      if (model) {
        resolved[profile.id] = model;
      }
    }

    if (standardTierModel) {
      for (const id of DEFAULT_BUILTIN_AGENT_IDS) {
        resolved[id] = standardTierModel;
      }
    }

    if (groupModels.nexus) {
      const nexusEntry = toRecord(agent.nexus);
      agent.nexus = { ...nexusEntry, model: groupModels.nexus };
    }
  }

  if (explicitModels) {
    for (const [id, model] of Object.entries(explicitModels)) {
      resolved[id] = model;
    }
  }

  if (additiveModels?.agents) {
    for (const [id, model] of Object.entries(additiveModels.agents)) {
      resolved[id] = model;
    }
  }

  for (const [id, model] of Object.entries(resolved)) {
    const catalogEntry = catalog.find((p) => p.id === id);
    if (catalogEntry) {
      const existing = toRecord(agent[id]);
      agent[id] = { ...existing, mode: "subagent", model };
      continue;
    }

    if (DEFAULT_BUILTIN_AGENT_ID_SET.has(id)) {
      const existing = toRecord(agent[id]);
      agent[id] = { ...existing, model };
    }
  }

  config.agent = agent;
  return resolved;
}

function resolveStandardTierModel(groupModels: GroupModels): string | undefined {
  return groupModels.do ?? groupModels.check ?? groupModels.unified;
}

type GroupModels = {
  unified: string | undefined;
  nexus: string | undefined;
  how: string | undefined;
  do: string | undefined;
  check: string | undefined;
};

function toStandardModel(model: string): string {
  if (model.includes("gpt-5")) {
    return model.replace(/gpt-5[^(-]*/i, "gpt-4o");
  }
  if (model.includes("claude-sonnet-4-5")) {
    return model.replace(/claude-sonnet-4-5[^(-]*/i, "claude-haiku-4-5");
  }
  if (model.includes("claude-3-5")) {
    return model.replace(/claude-3-5[^(-]*/i, "claude-haiku-4");
  }
  if (model.includes("gpt-4")) {
    return model.replace(/gpt-4[^(-]*/i, "gpt-4o-mini");
  }
  return model;
}

function resolveGroupModels(
  preset: "unified" | "tiered" | "custom" | "skip",
  leadModel: string | undefined,
  additiveModels: { unified?: string; nexus?: string; how?: string; do?: string; check?: string; agents?: Record<string, string> } | undefined
): GroupModels {
  if (additiveModels) {
    const unified = additiveModels.unified ?? leadModel;
    return {
      unified,
      nexus: additiveModels.nexus ?? unified,
      how: additiveModels.how ?? unified,
      do: additiveModels.do ?? unified,
      check: additiveModels.check ?? unified
    };
  }

  if (preset === "skip" || !leadModel) {
    return { unified: undefined, nexus: undefined, how: undefined, do: undefined, check: undefined };
  }

  if (preset === "unified") {
    return { unified: leadModel, nexus: leadModel, how: leadModel, do: leadModel, check: leadModel };
  }

  if (preset === "tiered") {
    const standardModel = toStandardModel(leadModel);
    return { unified: standardModel, nexus: leadModel, how: leadModel, do: standardModel, check: standardModel };
  }

  return { unified: undefined, nexus: undefined, how: undefined, do: undefined, check: undefined };
}

function resolveModelForAgent(
  profile: { id: string; category: string; model: string },
  groupModels: GroupModels
): string | undefined {
  if (profile.category === "how") {
    return groupModels.how;
  }
  if (profile.category === "do") {
    return groupModels.do;
  }
  if (profile.category === "check") {
    return groupModels.check;
  }
  return groupModels.unified;
}

function mergePermissionPreset(
  config: Record<string, unknown>,
  preset: "permissive" | "standard" | "restrictive" | "skip"
): void {
  if (preset === "skip") {
    return;
  }

  if (preset === "permissive") {
    config.permission = { "*": "allow" };
  } else if (preset === "standard") {
    config.permission = {
      "*": "ask",
      read: { "*": "allow" },
      bash: {
        "*": "ask",
        "git status*": "allow",
        "git diff*": "allow",
        "git log*": "allow"
      },
      task: { "*": "allow" }
    };
  } else if (preset === "restrictive") {
    config.permission = { "*": "ask" };
  }
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
