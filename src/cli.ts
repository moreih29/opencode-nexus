#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { isCancel, outro, select, text, type Option } from "@clack/prompts";
import { AGENT_META } from "./agents/prompts.js";
import { NEXUS_PRIMARY_AGENT_ID } from "./agents/primary.js";
import { readJsonFile, writeJsonFile } from "./shared/json-store.js";

type Command = "install" | "update" | "setup";
type PluginCommand = "install" | "update";
type Scope = "project" | "user";
type OutputMode = "json" | "human";

interface BaseCliOptions {
  scope: Scope;
  directory: string;
  configPath?: string;
}

interface PluginCliOptions extends BaseCliOptions {
  version?: string;
  pin: boolean;
}

interface SetupCliOptions extends BaseCliOptions {
  model?: string;
  allModel?: string;
  nexusModel?: string;
  howModel?: string;
  doModel?: string;
  checkModel?: string;
  generalModel?: string;
  exploreModel?: string;
}

interface ConfigLike {
  $schema?: string;
  agent?: unknown;
  plugin?: unknown;
  [key: string]: unknown;
}

interface CommonExplicitOptions {
  scope: boolean;
  directory: boolean;
  configPath: boolean;
}

interface PluginExplicitOptions extends CommonExplicitOptions {
  version: boolean;
  pin: boolean;
}

interface SetupExplicitOptions extends CommonExplicitOptions {
  model: boolean;
  allModel: boolean;
  nexusModel: boolean;
  howModel: boolean;
  doModel: boolean;
  checkModel: boolean;
  generalModel: boolean;
  exploreModel: boolean;
}

type ParsedArgs =
  | { kind: "help"; command?: Command }
  | { kind: "version" }
  | {
      kind: "plugin-command";
      command: PluginCommand;
      options: PluginCliOptions;
      explicit: PluginExplicitOptions;
    }
  | {
      kind: "setup-command";
      command: "setup";
      options: SetupCliOptions;
      explicit: SetupExplicitOptions;
    };

const PACKAGE_NAME = "opencode-nexus";
const OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json";
const DEFAULT_SCOPE: Scope = "user";
const DEFAULT_MODEL = AGENT_META.engineer?.model ?? "openai/gpt-5.3-codex";
const COMMANDS: Command[] = ["install", "update", "setup"];
const execFileAsync = promisify(execFile);
const MANUAL_MODEL_ENTRY = "__manual_model_entry__";
const CHANGE_PROVIDER = "__change_provider__";
const BUILTIN_AGENT_IDS = {
  general: "general",
  explore: "explore",
} as const;

interface HelpSection {
  title: string;
  lines: string[];
}

function renderHelp(title: string, sections: HelpSection[]): string {
  const chunks: string[] = [title, ""];
  for (const section of sections) {
    chunks.push(`${section.title}:`);
    chunks.push(...section.lines.map((line) => `  ${line}`));
    chunks.push("");
  }
  return chunks.join("\n").trimEnd();
}

function printTopLevelHelp(): void {
  console.log(
    renderHelp("opencode-nexus CLI", [
      {
        title: "Usage",
        lines: [
          "opencode-nexus <command> [options]",
          "opencode-nexus --help",
          "opencode-nexus --version",
        ],
      },
      {
        title: "Commands",
        lines: [
          "install   Add opencode-nexus plugin entry to an OpenCode config",
          "update    Update the opencode-nexus plugin version in config",
          "setup     Configure model values under agent.*.model",
        ],
      },
      {
        title: "Global options",
        lines: [
          "-v, --version            Show CLI package version when used without a command",
          "--help                   Show this help",
        ],
      },
      {
        title: "Examples",
        lines: [
          "opencode-nexus install --help",
          "opencode-nexus setup --help",
          "opencode-nexus --version",
        ],
      },
      {
        title: "Tip",
        lines: ["Run `opencode-nexus <command> --help` for command-specific options."],
      },
    ])
  );
}

function printPluginHelp(command: PluginCommand): void {
  const title = command === "install" ? "Install" : "Update";
  console.log(
    renderHelp(`${title} command`, [
      {
        title: "Usage",
        lines: [`opencode-nexus ${command} [options]`],
      },
      {
        title: "Options",
        lines: [
          "--scope <user|project>   Target OpenCode config scope (default: user)",
          "--directory <path>       Project root for project scope (default: cwd)",
          "--config <path>          Explicit config file path override",
          "--version <value>        Plugin version/spec suffix (default: current package version)",
          "--no-pin                 Write unpinned plugin spec (opencode-nexus)",
          "--help                   Show this help",
        ],
      },
      {
        title: "Examples",
        lines: [
          `opencode-nexus ${command}`,
          `opencode-nexus ${command} --scope user`,
          `opencode-nexus ${command} --scope project --directory /path/to/repo`,
          command === "update"
            ? "opencode-nexus update --scope project --version 0.6.0"
            : "opencode-nexus install --scope user --no-pin",
        ],
      },
      {
        title: "Interactive mode",
        lines: ["Prompts for missing values when stdin/stdout are TTYs."],
      },
    ])
  );
}

function printSetupHelp(): void {
  console.log(
    renderHelp("Setup command", [
      {
        title: "Usage",
        lines: ["opencode-nexus setup [options]"],
      },
      {
        title: "Options",
        lines: [
          "--scope <user|project>   Target OpenCode config scope (default: user)",
          "--directory <path>       Project root for project scope (default: cwd)",
          "--config <path>          Explicit config file path override",
          "--all-model <value>      Baseline model for nexus/HOW/DO/CHECK/general/explore",
          "--model <value>          Backward-compatible alias for --all-model",
          "--nexus-model <value>    Override model for nexus",
          "--how-model <value>      Override model for HOW agents",
          "--do-model <value>       Override model for DO agents",
          "--check-model <value>    Override model for CHECK agents",
          "--general-model <value>  Override model for built-in general agent",
          "--explore-model <value>  Override model for built-in explore agent",
          "--help                   Show this help",
        ],
      },
      {
        title: "Examples",
        lines: [
          "opencode-nexus setup",
          "opencode-nexus setup --scope project --directory /path/to/repo --all-model openai/gpt-5.3-codex",
          "opencode-nexus setup --all-model openai/gpt-5.3-codex --do-model openai/gpt-5.4-mini",
          "opencode-nexus setup --scope user --model anthropic/claude-sonnet-4",
        ],
      },
      {
        title: "Interactive mode",
        lines: ["Defaults to grouped setup and includes an all-at-once shortcut."],
      },
    ])
  );
}

function printHelp(command?: Command): void {
  if (!command) {
    printTopLevelHelp();
    return;
  }
  if (command === "setup") {
    printSetupHelp();
    return;
  }
  printPluginHelp(command);
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    return { kind: "help" };
  }

  const [firstToken] = argv;

  if (firstToken === "--help" || firstToken === "-h") {
    return { kind: "help" };
  }

  if (firstToken === "--version" || firstToken === "-v" || firstToken === "version") {
    if (argv.length === 1) {
      return { kind: "version" };
    }
    throw new Error(`Unknown option: ${argv[1]}`);
  }

  if (firstToken === "help") {
    if (argv.length === 1) {
      return { kind: "help" };
    }
    const helpCommand = argv[1] as Command;
    if (!COMMANDS.includes(helpCommand)) {
      throw new Error(`Unknown command: ${argv[1]}`);
    }
    return { kind: "help", command: helpCommand };
  }

  const [commandRaw, ...rest] = argv;
  if (!COMMANDS.includes(commandRaw as Command)) {
    throw new Error(`Unknown command: ${commandRaw}`);
  }

  const commonOptions: BaseCliOptions = {
    scope: DEFAULT_SCOPE,
    directory: process.cwd(),
  };

  const commonExplicit: CommonExplicitOptions = {
    scope: false,
    directory: false,
    configPath: false,
  };

  if (commandRaw === "setup") {
    const options: SetupCliOptions = { ...commonOptions };
    const explicit: SetupExplicitOptions = {
      ...commonExplicit,
      model: false,
      allModel: false,
      nexusModel: false,
      howModel: false,
      doModel: false,
      checkModel: false,
      generalModel: false,
      exploreModel: false,
    };

    for (let i = 0; i < rest.length; i++) {
      const token = rest[i];
      if (token === "--help" || token === "-h") {
        return { kind: "help", command: "setup" };
      }

      const [name, inlineValue] = token.split("=", 2);
      const readValue = (): string => {
        if (inlineValue !== undefined) {
          return inlineValue;
        }
        const next = rest[i + 1];
        if (!next || next.startsWith("-")) {
          throw new Error(`Missing value for ${name}`);
        }
        i += 1;
        return next;
      };

      switch (name) {
        case "--scope": {
          const value = readValue();
          if (value !== "user" && value !== "project") {
            throw new Error(`Invalid --scope value: ${value}`);
          }
          options.scope = value;
          explicit.scope = true;
          break;
        }
        case "--directory":
          options.directory = path.resolve(readValue());
          explicit.directory = true;
          break;
        case "--config":
          options.configPath = path.resolve(readValue());
          explicit.configPath = true;
          break;
        case "--model":
          options.model = readValue().trim();
          explicit.model = true;
          options.allModel = options.model;
          explicit.allModel = true;
          break;
        case "--all-model":
          options.allModel = readValue().trim();
          explicit.allModel = true;
          break;
        case "--nexus-model":
          options.nexusModel = readValue().trim();
          explicit.nexusModel = true;
          break;
        case "--how-model":
          options.howModel = readValue().trim();
          explicit.howModel = true;
          break;
        case "--do-model":
          options.doModel = readValue().trim();
          explicit.doModel = true;
          break;
        case "--check-model":
          options.checkModel = readValue().trim();
          explicit.checkModel = true;
          break;
        case "--general-model":
          options.generalModel = readValue().trim();
          explicit.generalModel = true;
          break;
        case "--explore-model":
          options.exploreModel = readValue().trim();
          explicit.exploreModel = true;
          break;
        default:
          throw new Error(`Unknown option: ${token}`);
      }
    }

    return { kind: "setup-command", command: "setup", options, explicit };
  }

  const options: PluginCliOptions = {
    ...commonOptions,
    pin: true,
  };
  const explicit: PluginExplicitOptions = {
    ...commonExplicit,
    version: false,
    pin: false,
  };

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === "--help" || token === "-h") {
      return { kind: "help", command: commandRaw as PluginCommand };
    }

    const [name, inlineValue] = token.split("=", 2);
    const readValue = (): string => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      const next = rest[i + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`Missing value for ${name}`);
      }
      i += 1;
      return next;
    };

    switch (name) {
      case "--scope": {
        const value = readValue();
        if (value !== "user" && value !== "project") {
          throw new Error(`Invalid --scope value: ${value}`);
        }
        options.scope = value;
        explicit.scope = true;
        break;
      }
      case "--directory":
        options.directory = path.resolve(readValue());
        explicit.directory = true;
        break;
      case "--config":
        options.configPath = path.resolve(readValue());
        explicit.configPath = true;
        break;
      case "--version":
        options.version = readValue().trim();
        explicit.version = true;
        break;
      case "--no-pin":
        options.pin = false;
        explicit.pin = true;
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  if (!options.pin && explicit.version) {
    throw new Error("`--version <value>` cannot be combined with `--no-pin`.");
  }

  return { kind: "plugin-command", command: commandRaw as PluginCommand, options, explicit };
}

function normalizePluginList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function buildPluginSpec(input: { pin: boolean; version?: string; packageVersion?: string }): string {
  if (!input.pin) {
    return PACKAGE_NAME;
  }
  const version = input.version ?? input.packageVersion;
  if (!version || version.trim().length === 0) {
    return PACKAGE_NAME;
  }
  return `${PACKAGE_NAME}@${version.trim()}`;
}

async function readPackageVersion(): Promise<string | undefined> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.resolve(currentDir, "../package.json");
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function isInteractiveTerminal(): boolean {
  if (process.env.OPENCODE_NEXUS_FORCE_TTY === "1") {
    return true;
  }
  return Boolean(input.isTTY) && Boolean(output.isTTY);
}

function canUseClackPrompts(): boolean {
  return Boolean(input.isTTY) && Boolean(output.isTTY);
}

function isRawSingleSelectTerminal(): boolean {
  if (process.env.OPENCODE_NEXUS_DISABLE_RAW_SELECT === "1") {
    return false;
  }
  if (!input.isTTY || !output.isTTY) {
    return false;
  }
  return typeof (input as NodeJS.ReadStream).setRawMode === "function";
}

function getDefaultChoiceIndex<T extends string>(choices: Array<{ value: T; label: string }>, defaultValue: T): number {
  const defaultIndex = choices.findIndex((choice) => choice.value === defaultValue);
  return defaultIndex >= 0 ? defaultIndex : 0;
}

async function promptChoiceRaw<T extends string>(
  message: string,
  choices: Array<{ value: T; label: string }>,
  defaultValue: T
): Promise<T> {
  const ttyInput = input as NodeJS.ReadStream;
  const originalRawMode = ttyInput.isRaw;
  let selectedIndex = getDefaultChoiceIndex(choices, defaultValue);
  let renderedLines = 0;

  const clearRender = (): void => {
    if (renderedLines <= 0) {
      return;
    }
    readline.moveCursor(output, 0, -renderedLines);
    readline.cursorTo(output, 0);
    readline.clearScreenDown(output);
    renderedLines = 0;
  };

  const render = (): void => {
    clearRender();
    output.write(`${message}\n`);
    choices.forEach((choice, index) => {
      output.write(`${index === selectedIndex ? ">" : " "} ${choice.label}\n`);
    });
    output.write("Use up/down arrows and Enter to select.\n");
    renderedLines = choices.length + 2;
  };

  return await new Promise<T>((resolve, reject) => {
    const cleanup = (): void => {
      ttyInput.off("keypress", onKeypress);
      if (originalRawMode === false) {
        ttyInput.setRawMode(false);
      }
      clearRender();
    };

    const onKeypress = (_value: string, key: readline.Key): void => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Interrupted"));
        return;
      }

      if (key.name === "up") {
        selectedIndex = selectedIndex <= 0 ? choices.length - 1 : selectedIndex - 1;
        render();
        return;
      }

      if (key.name === "down") {
        selectedIndex = selectedIndex >= choices.length - 1 ? 0 : selectedIndex + 1;
        render();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        const selectedChoice = choices[selectedIndex];
        cleanup();
        output.write(`${message}\n  ${selectedChoice.label}\n\n`);
        resolve(selectedChoice.value);
      }
    };

    try {
      readline.emitKeypressEvents(ttyInput);
      ttyInput.setRawMode(true);
      ttyInput.resume();
      ttyInput.on("keypress", onKeypress);
      render();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function promptChoiceFallback<T extends string>(
  rl: ReturnType<typeof createInterface>,
  message: string,
  choices: Array<{ value: T; label: string }>,
  defaultValue: T
): Promise<T> {
  const defaultIndex = getDefaultChoiceIndex(choices, defaultValue) + 1;

  while (true) {
    output.write(`${message}\n`);
    choices.forEach((choice, index) => {
      output.write(`  ${index + 1}) ${choice.label}\n`);
    });

    const answer = (await rl.question(`Select an option [${defaultIndex}]: `)).trim().toLowerCase();
    if (!answer) {
      return defaultValue;
    }

    const choiceIndex = Number(answer);
    if (Number.isInteger(choiceIndex) && choiceIndex >= 1 && choiceIndex <= choices.length) {
      return choices[choiceIndex - 1].value;
    }

    const matchedChoice = choices.find((choice) => choice.value.toLowerCase() === answer);
    if (matchedChoice) {
      return matchedChoice.value;
    }

    output.write("Please choose one of the listed options.\n\n");
  }
}

async function promptChoice<T extends string>(
  getReadline: () => ReturnType<typeof createInterface>,
  message: string,
  choices: Array<{ value: T; label: string }>,
  defaultValue: T
): Promise<T> {
  if (canUseClackPrompts()) {
    const selection = await select({
      message,
      options: choices as Option<T>[],
      initialValue: defaultValue,
    });

    if (isCancel(selection)) {
      throw new Error("Interrupted");
    }

    return selection as T;
  }

  if (isRawSingleSelectTerminal()) {
    return promptChoiceRaw(message, choices, defaultValue);
  }
  return promptChoiceFallback(getReadline(), message, choices, defaultValue);
}

async function promptText(
  getReadline: () => ReturnType<typeof createInterface>,
  label: string,
  defaultValue?: string
): Promise<string> {
  if (canUseClackPrompts()) {
    const value = await text({
      message: label,
      placeholder: defaultValue,
      defaultValue,
      validate(inputValue: string) {
        if (inputValue.trim().length > 0 || defaultValue !== undefined) {
          return undefined;
        }
        return "A value is required.";
      },
    });

    if (isCancel(value)) {
      throw new Error("Interrupted");
    }

    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return "";
  }

  const rl = getReadline();
  while (true) {
    const answer = (await rl.question(`${label}${defaultValue ? ` [${defaultValue}]` : ""}: `)).trim();
    if (answer) {
      return answer;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    output.write("A value is required.\n");
  }
}

interface SetupPromptContext {
  rl?: ReturnType<typeof createInterface>;
}

function getSetupReadline(context: SetupPromptContext): ReturnType<typeof createInterface> {
  if (!context.rl) {
    context.rl = createInterface({ input, output });
  }
  return context.rl;
}

async function promptSetupChoice<T extends string>(
  context: SetupPromptContext,
  message: string,
  choices: Array<{ value: T; label: string }>,
  defaultValue: T
): Promise<T> {
  return promptChoice(() => getSetupReadline(context), message, choices, defaultValue);
}

async function promptSetupText(context: SetupPromptContext, label: string, defaultValue?: string): Promise<string> {
  return promptText(() => getSetupReadline(context), label, defaultValue);
}

interface SetupGroupModels {
  nexusModel?: string;
  howModel?: string;
  doModel?: string;
  checkModel?: string;
  generalModel?: string;
  exploreModel?: string;
}

interface SetupDiscoveryContext {
  providers: string[];
  defaults: Required<SetupGroupModels>;
}

function sanitizeModelInput(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hasAnyExplicitSetupModelInput(explicit: SetupExplicitOptions): boolean {
  return (
    explicit.model ||
    explicit.allModel ||
    explicit.nexusModel ||
    explicit.howModel ||
    explicit.doModel ||
    explicit.checkModel ||
    explicit.generalModel ||
    explicit.exploreModel
  );
}

function getAgentsByCategory(category: string): string[] {
  return Object.values(AGENT_META)
    .filter((meta) => meta.category.toLowerCase() === category)
    .map((meta) => meta.id)
    .sort();
}

function providerFromModel(model: string | undefined): string | undefined {
  const normalized = sanitizeModelInput(model);
  if (!normalized) {
    return undefined;
  }
  const [provider] = normalized.split("/", 1);
  return provider?.trim() || undefined;
}

function toSlug(inputValue: string): string {
  return inputValue
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function parseProvidersListOutput(stdout: string): string[] {
  const providers = new Set<string>();
  for (const rawLine of stripAnsi(stdout).split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^[●•]\s+(.+?)(?:\s+\S+)?$/);
    if (!match) {
      continue;
    }
    const provider = toSlug(match[1]);
    if (provider && provider !== "credentials") {
      providers.add(provider);
    }
  }
  return Array.from(providers).sort();
}

function toConfigAgentRecord(config: unknown): Record<string, Record<string, unknown>> {
  const root = toRecord(config);
  const agent = toRecord(root.agent);
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(agent)) {
    result[key] = toRecord(value);
  }
  return result;
}

function readModelFromAgentRecord(agent: Record<string, Record<string, unknown>>, agentId: string): string | undefined {
  return sanitizeModelInput(typeof agent[agentId]?.model === "string" ? (agent[agentId].model as string) : undefined);
}

function firstDefinedModel(agent: Record<string, Record<string, unknown>>, ids: string[]): string | undefined {
  for (const id of ids) {
    const model = readModelFromAgentRecord(agent, id);
    if (model) {
      return model;
    }
  }
  return undefined;
}

function readDefaultSetupModelsFromConfig(config: unknown): Required<SetupGroupModels> {
  const agent = toConfigAgentRecord(config);
  const howIds = getAgentsByCategory("how");
  const doIds = getAgentsByCategory("do");
  const checkIds = getAgentsByCategory("check");

  return {
    nexusModel: readModelFromAgentRecord(agent, NEXUS_PRIMARY_AGENT_ID) ?? DEFAULT_MODEL,
    howModel: firstDefinedModel(agent, howIds) ?? DEFAULT_MODEL,
    doModel: firstDefinedModel(agent, doIds) ?? DEFAULT_MODEL,
    checkModel: firstDefinedModel(agent, checkIds) ?? DEFAULT_MODEL,
    generalModel: readModelFromAgentRecord(agent, BUILTIN_AGENT_IDS.general) ?? DEFAULT_MODEL,
    exploreModel: readModelFromAgentRecord(agent, BUILTIN_AGENT_IDS.explore) ?? DEFAULT_MODEL,
  };
}

async function runOpencode(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const result = await execFileAsync("opencode", args, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 10,
    });
    return { ok: true, stdout: result.stdout.toString() };
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error) {
      const stdout = (error as { stdout?: string | Buffer }).stdout;
      return { ok: false, stdout: stdout ? stdout.toString() : "" };
    }
    return { ok: false, stdout: "" };
  }
}

async function buildSetupDiscoveryContext(): Promise<SetupDiscoveryContext> {
  const [providersResult, debugResult] = await Promise.all([
    runOpencode(["providers", "list"]),
    runOpencode(["debug", "config"]),
  ]);

  const providers = new Set<string>(parseProvidersListOutput(providersResult.stdout));
  let defaults = readDefaultSetupModelsFromConfig({});

  if (debugResult.ok) {
    try {
      const parsed = JSON.parse(debugResult.stdout) as unknown;
      defaults = readDefaultSetupModelsFromConfig(parsed);
      const agent = toConfigAgentRecord(parsed);
      for (const value of Object.values(agent)) {
        const model = sanitizeModelInput(typeof value.model === "string" ? (value.model as string) : undefined);
        const provider = providerFromModel(model);
        if (provider) {
          providers.add(provider);
        }
      }
    } catch {
      // keep fallback defaults when debug output is not JSON
    }
  }

  return {
    providers: Array.from(providers).sort(),
    defaults,
  };
}

async function promptModelWithDiscovery(
  context: SetupPromptContext,
  discovery: SetupDiscoveryContext,
  label: string,
  defaultModel: string
): Promise<string> {
  const providerChoices = discovery.providers.map((provider) => ({ value: provider, label: provider }));
  const defaultProvider = providerFromModel(defaultModel) ?? "openai";
  let provider = defaultProvider;

  while (true) {
    if (providerChoices.length > 0) {
      const defaultProviderValue = providerChoices.some((choice) => choice.value === provider) ? provider : providerChoices[0].value;
      provider = await promptSetupChoice(context, `${label} provider`, providerChoices, defaultProviderValue);
      output.write("\n");
    } else {
      output.write("Provider discovery unavailable. Enter provider manually.\n");
      provider = (await promptSetupText(context, `${label} provider`, defaultProvider)).trim();
      output.write("\n");
    }

    const modelsResult = provider ? await runOpencode(["models", provider]) : { ok: false, stdout: "" };
    const discoveredModels = modelsResult.ok
      ? Array.from(
          new Set(
            modelsResult.stdout
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
          )
        )
      : [];

    if (discoveredModels.length > 0) {
      const choices = discoveredModels.map((model) => ({ value: model, label: model }));
      if (defaultModel && !choices.some((choice) => choice.value === defaultModel)) {
        choices.unshift({ value: defaultModel, label: `${defaultModel} (current)` });
      }
      if (providerChoices.length > 0) {
        choices.push({ value: CHANGE_PROVIDER, label: "Change provider" });
      }
      choices.push({ value: MANUAL_MODEL_ENTRY, label: "manual model entry" });
      const defaultModelValue = choices.some((choice) => choice.value === defaultModel) ? defaultModel : choices[0].value;
      const selectedModel = await promptSetupChoice(context, `${label} model`, choices, defaultModelValue);
      output.write("\n");
      if (selectedModel === CHANGE_PROVIDER) {
        continue;
      }
      if (selectedModel !== MANUAL_MODEL_ENTRY) {
        return selectedModel;
      }
    } else {
      output.write(`Model discovery unavailable for provider \`${provider ?? "unknown"}\`. Enter model manually.\n`);
    }

    const suggestedModel = defaultModel || (provider ? `${provider}/${DEFAULT_MODEL.split("/").slice(1).join("/")}` : DEFAULT_MODEL);
    const manualModel = await promptSetupText(context, `${label} model`, suggestedModel);
    output.write("\n");
    return manualModel.trim();
  }
}

function resolveSetupGroupModels(options: SetupCliOptions): SetupGroupModels {
  const baselineModel = sanitizeModelInput(options.allModel ?? options.model);
  return {
    nexusModel: sanitizeModelInput(options.nexusModel) ?? baselineModel,
    howModel: sanitizeModelInput(options.howModel) ?? baselineModel,
    doModel: sanitizeModelInput(options.doModel) ?? baselineModel,
    checkModel: sanitizeModelInput(options.checkModel) ?? baselineModel,
    generalModel: sanitizeModelInput(options.generalModel) ?? baselineModel,
    exploreModel: sanitizeModelInput(options.exploreModel) ?? baselineModel,
  };
}

async function resolveInteractiveOptions(
  command: PluginCommand,
  options: PluginCliOptions,
  explicit: PluginExplicitOptions,
  packageVersion: string | undefined
): Promise<PluginCliOptions> {
  if (!isInteractiveTerminal()) {
    return options;
  }

  const needsScopePrompt = !explicit.configPath && !explicit.scope;
  const needsPinPrompt = !explicit.pin && !explicit.version;

  if (!needsScopePrompt && !needsPinPrompt) {
    return options;
  }

  let rl: ReturnType<typeof createInterface> | undefined;
  const getReadline = (): ReturnType<typeof createInterface> => {
    if (!rl) {
      rl = createInterface({ input, output });
    }
    return rl;
  };
  const resolved = { ...options };

  try {
    if (needsScopePrompt) {
      resolved.scope = await promptChoice(
        getReadline,
        command === "install"
          ? "Where should opencode-nexus be installed?"
          : "Which OpenCode config should be updated?",
        [
          { value: "user", label: "user (~/.config/opencode/opencode.json)" },
          { value: "project", label: "project (./opencode.json)" }
        ],
        DEFAULT_SCOPE
      );
      output.write("\n");

      if (resolved.scope === "project" && !explicit.directory) {
        resolved.directory = path.resolve(await promptText(getReadline, "Project directory", process.cwd()));
        output.write("\n");
      }
    }

    if (needsPinPrompt) {
      const pinSelection = await promptChoice(
        getReadline,
        command === "install"
          ? "Pin a plugin version in the OpenCode config?"
          : "Write a pinned plugin version to the OpenCode config?",
        [
          {
            value: "yes",
            label: packageVersion
              ? `yes (recommended, default: ${packageVersion})`
              : "yes (recommended)"
          },
          { value: "no", label: "no (write bare opencode-nexus spec)" }
        ],
        "yes"
      );
      resolved.pin = pinSelection === "yes";
      output.write("\n");

      if (resolved.pin) {
        resolved.version = (await promptText(
          getReadline,
          command === "install" ? "Plugin version" : "Updated plugin version",
          packageVersion
        )).trim();
        output.write("\n");
      } else {
        resolved.version = undefined;
      }
    }

    return resolved;
  } finally {
    rl?.close();
  }
}

async function resolveInteractiveSetupOptions(
  options: SetupCliOptions,
  explicit: SetupExplicitOptions,
  _defaultModelValue: string
): Promise<SetupCliOptions> {
  if (!isInteractiveTerminal()) {
    return options;
  }

  const needsScopePrompt = !explicit.configPath && !explicit.scope;
  const needsModelPrompt = !hasAnyExplicitSetupModelInput(explicit);

  if (!needsScopePrompt && !needsModelPrompt) {
    return options;
  }

  const promptContext: SetupPromptContext = {};
  const resolved = { ...options };

  try {
    if (needsScopePrompt) {
      resolved.scope = await promptSetupChoice(
        promptContext,
        "Which OpenCode config should be updated?",
        [
          { value: "user", label: "user (~/.config/opencode/opencode.json)" },
          { value: "project", label: "project (./opencode.json)" },
        ],
        DEFAULT_SCOPE
      );
      output.write("\n");

      if (resolved.scope === "project" && !explicit.directory) {
        resolved.directory = path.resolve(await promptSetupText(promptContext, "Project directory", process.cwd()));
        output.write("\n");
      }
    }

    if (needsModelPrompt) {
      const discovery = await buildSetupDiscoveryContext();
      const setupFlow = await promptSetupChoice(
        promptContext,
        "How should setup configure models?",
        [
          { value: "grouped", label: "grouped by role (recommended)" },
          { value: "all", label: "all surfaced roles at once" },
        ],
        "grouped"
      );
      output.write("\n");

      if (setupFlow === "all") {
        resolved.allModel = await promptModelWithDiscovery(
          promptContext,
          discovery,
          "All surfaced roles",
          discovery.defaults.nexusModel
        );
      } else {
        resolved.nexusModel = await promptModelWithDiscovery(
          promptContext,
          discovery,
          "Nexus primary",
          discovery.defaults.nexusModel
        );
        resolved.howModel = await promptModelWithDiscovery(promptContext, discovery, "HOW agents", discovery.defaults.howModel);
        resolved.doModel = await promptModelWithDiscovery(promptContext, discovery, "DO agents", discovery.defaults.doModel);
        resolved.checkModel = await promptModelWithDiscovery(
          promptContext,
          discovery,
          "CHECK agents",
          discovery.defaults.checkModel
        );
        resolved.generalModel = await promptModelWithDiscovery(
          promptContext,
          discovery,
          "general agent",
          discovery.defaults.generalModel
        );
        resolved.exploreModel = await promptModelWithDiscovery(
          promptContext,
          discovery,
          "explore agent",
          discovery.defaults.exploreModel
        );
      }
    }

    return resolved;
  } finally {
    promptContext.rl?.close();
  }
}

async function promptSetupHandoff(): Promise<boolean> {
  if (!isInteractiveTerminal()) {
    return false;
  }

  let rl: ReturnType<typeof createInterface> | undefined;
  const getReadline = (): ReturnType<typeof createInterface> => {
    if (!rl) {
      rl = createInterface({ input, output });
    }
    return rl;
  };

  try {
    const selection = await promptChoice(
      getReadline,
      "Configure agent model values now with `setup`?",
      [
        { value: "no", label: "no (finish install only)" },
        { value: "yes", label: "yes (run setup flow now)" },
      ],
      "no"
    );
    output.write("\n");
    return selection === "yes";
  } finally {
    rl?.close();
  }
}

function resolveConfigPath(options: BaseCliOptions): string {
  if (options.configPath) {
    return options.configPath;
  }
  if (options.scope === "user") {
    return path.join(os.homedir(), ".config", "opencode", "opencode.json");
  }
  return path.join(options.directory, "opencode.json");
}

function applyPluginSpec(config: ConfigLike, pluginSpec: string): ConfigLike {
  const currentPlugin = normalizePluginList(config.plugin);
  const nextPlugin = currentPlugin.filter((entry) => entry !== PACKAGE_NAME && !entry.startsWith(`${PACKAGE_NAME}@`));
  nextPlugin.push(pluginSpec);
  return {
    ...config,
    $schema: config.$schema ?? OPENCODE_SCHEMA_URL,
    plugin: nextPlugin
  };
}

async function executePluginCommand(
  command: PluginCommand,
  options: PluginCliOptions,
  packageVersion: string | undefined,
  outputMode: OutputMode = "json"
): Promise<void> {
  const configPath = resolveConfigPath(options);
  const pluginSpec = buildPluginSpec({
    pin: options.pin,
    version: options.version,
    packageVersion
  });

  const config = await readJsonFile<ConfigLike>(configPath, { $schema: OPENCODE_SCHEMA_URL });
  const next = applyPluginSpec(config, pluginSpec);
  await writeJsonFile(configPath, next);

  if (outputMode === "human") {
    const action = command === "install" ? "Install" : "Update";
    const summary = [
      `${action} complete.`,
      `Scope: ${options.scope}`,
      `Config: ${configPath}`,
      `Plugin: ${pluginSpec}`,
      `Pinned: ${options.pin ? "yes" : "no"}`,
    ].join("\n");

    if (canUseClackPrompts()) {
      outro(summary);
      return;
    }

    console.log(summary);
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        command,
        scope: options.scope,
        configPath,
        pluginSpec,
        pinned: options.pin
      },
      null,
      2
    )
  );
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function applySetupModels(config: ConfigLike, models: SetupGroupModels): { next: ConfigLike; updatedAgents: string[] } {
  const currentAgent = toRecord(config.agent);
  const nextAgent: Record<string, unknown> = { ...currentAgent };
  const targets = new Map<string, string>();
  const assign = (ids: string[], model: string | undefined): void => {
    const normalized = sanitizeModelInput(model);
    if (!normalized) {
      return;
    }
    for (const id of ids) {
      targets.set(id, normalized);
    }
  };

  assign([NEXUS_PRIMARY_AGENT_ID], models.nexusModel);
  assign(getAgentsByCategory("how"), models.howModel);
  assign(getAgentsByCategory("do"), models.doModel);
  assign(getAgentsByCategory("check"), models.checkModel);
  assign([BUILTIN_AGENT_IDS.general], models.generalModel);
  assign([BUILTIN_AGENT_IDS.explore], models.exploreModel);

  for (const [agentId, model] of targets.entries()) {
    const current = toRecord(nextAgent[agentId]);
    nextAgent[agentId] = {
      ...current,
      model,
    };
  }

  return {
    next: {
      ...config,
      $schema: config.$schema ?? OPENCODE_SCHEMA_URL,
      agent: nextAgent,
    },
    updatedAgents: Array.from(targets.keys()).sort(),
  };
}

function printInteractiveSetupSummary(result: {
  scope: Scope;
  configPath: string;
  models: SetupGroupModels;
  updatedAgents: string[];
}): void {
  const modelLabels: Record<keyof SetupGroupModels, string> = {
    nexusModel: "Nexus primary",
    howModel: "HOW agents",
    doModel: "DO agents",
    checkModel: "CHECK agents",
    generalModel: "general agent",
    exploreModel: "explore agent",
  };

  const modelSummary = (Object.keys(modelLabels) as Array<keyof SetupGroupModels>)
    .map((group) => {
      const value = sanitizeModelInput(result.models[group]);
      if (!value) {
        return undefined;
      }
      return `- ${modelLabels[group]}: ${value}`;
    })
    .filter((line): line is string => Boolean(line));

  const summary = [
    "Setup complete.",
    `Scope: ${result.scope}`,
    `Config: ${result.configPath}`,
    `Updated agents (${result.updatedAgents.length}): ${result.updatedAgents.join(", ")}`,
    modelSummary.length > 0 ? `Applied model groups:\n${modelSummary.join("\n")}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  if (canUseClackPrompts()) {
    outro(summary);
    return;
  }

  console.log(summary);
}

async function executeSetupCommand(options: SetupCliOptions, outputMode: OutputMode = "json"): Promise<void> {
  const models = resolveSetupGroupModels(options);
  const hasAnyModel = Object.values(models).some((value) => Boolean(sanitizeModelInput(value)));
  if (!hasAnyModel) {
    throw new Error(
      "Setup requires model input: use `--all-model <value>` (or `--model <value>`) and optional group overrides."
    );
  }

  const configPath = resolveConfigPath(options);
  const config = await readJsonFile<ConfigLike>(configPath, { $schema: OPENCODE_SCHEMA_URL });
  const { next, updatedAgents } = applySetupModels(config, models);
  await writeJsonFile(configPath, next);

  if (outputMode === "human") {
    printInteractiveSetupSummary({
      scope: options.scope,
      configPath,
      models,
      updatedAgents,
    });
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        command: "setup",
        scope: options.scope,
        configPath,
        models,
        updatedAgents,
      },
      null,
      2
    )
  );
}

async function main(): Promise<void> {
  const interactive = isInteractiveTerminal();
  const setupOutputMode: OutputMode = interactive ? "human" : "json";
  const pluginOutputMode: OutputMode = interactive ? "human" : "json";
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.kind === "help") {
    printHelp(parsed.command);
    return;
  }

  if (parsed.kind === "version") {
    const packageVersion = await readPackageVersion();
    console.log(packageVersion ?? "unknown");
    return;
  }

  if (parsed.kind === "setup-command") {
    const resolvedOptions = await resolveInteractiveSetupOptions(parsed.options, parsed.explicit, DEFAULT_MODEL);
    await executeSetupCommand(resolvedOptions, setupOutputMode);
    return;
  }

  const packageVersion = await readPackageVersion();
  const resolvedOptions = await resolveInteractiveOptions(parsed.command, parsed.options, parsed.explicit, packageVersion);
  await executePluginCommand(parsed.command, resolvedOptions, packageVersion, pluginOutputMode);

  if (parsed.command === "install" && interactive) {
    const shouldRunSetup = await promptSetupHandoff();
    if (!shouldRunSetup) {
      return;
    }

    const setupOptions = await resolveInteractiveSetupOptions(
      {
        scope: resolvedOptions.scope,
        directory: resolvedOptions.directory,
        configPath: resolvedOptions.configPath,
      },
      {
        scope: true,
        directory: true,
        configPath: true,
        model: false,
        allModel: false,
        nexusModel: false,
        howModel: false,
        doModel: false,
        checkModel: false,
        generalModel: false,
        exploreModel: false,
      },
      DEFAULT_MODEL
    );
    await executeSetupCommand(setupOptions, setupOutputMode);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[opencode-nexus] ${message}`);
  process.exit(1);
});
