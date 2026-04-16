#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { AGENT_META } from "./agents/prompts.js";
import { NEXUS_PRIMARY_AGENT_ID } from "./agents/primary.js";
import { readJsonFile, writeJsonFile } from "./shared/json-store.js";

type Command = "install" | "update" | "setup";
type PluginCommand = "install" | "update";
type Scope = "project" | "user";

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

function printTopLevelHelp(): void {
  console.log([
    "opencode-nexus CLI",
    "",
    "Usage:",
    "  opencode-nexus <command> [options]",
    "  opencode-nexus --help",
    "  opencode-nexus --version",
    "",
    "Commands:",
    "  install   Add opencode-nexus plugin entry to an OpenCode config",
    "  update    Update the opencode-nexus plugin version in config",
    "  setup     Configure model values under agent.*.model",
    "",
    "Global options:",
    "  -v, --version            Show CLI package version when used without a command",
    "  --help                   Show this help",
    "",
    "Run `opencode-nexus <command> --help` for command-specific options.",
    "",
    "Examples:",
    "  opencode-nexus install --help",
    "  opencode-nexus setup --help",
    "  opencode-nexus --version",
  ].join("\n"));
}

function printPluginHelp(command: PluginCommand): void {
  const title = command === "install" ? "Install" : "Update";
  console.log([
    `${title} command`,
    "",
    "Usage:",
    `  opencode-nexus ${command} [options]`,
    "",
    "Options:",
    "  --scope <user|project>   Target OpenCode config scope (default: user)",
    "  --directory <path>       Project root for project scope (default: cwd)",
    "  --config <path>          Explicit config file path override",
    "  --version <value>        Plugin version/spec suffix (default: current package version)",
    "  --no-pin                 Write unpinned plugin spec (opencode-nexus)",
    "  --help                   Show this help",
    "",
    "Examples:",
    `  opencode-nexus ${command}`,
    `  opencode-nexus ${command} --scope user`,
    `  opencode-nexus ${command} --scope project --directory /path/to/repo`,
    command === "update"
      ? "  opencode-nexus update --scope project --version 0.6.0"
      : "  opencode-nexus install --scope user --no-pin",
    "",
    "Interactive mode prompts for missing values when stdin/stdout are TTYs.",
  ].join("\n"));
}

function printSetupHelp(): void {
  console.log([
    "Setup command",
    "",
    "Usage:",
    "  opencode-nexus setup [options]",
    "",
    "Options:",
    "  --scope <user|project>   Target OpenCode config scope (default: user)",
    "  --directory <path>       Project root for project scope (default: cwd)",
    "  --config <path>          Explicit config file path override",
    "  --model <value>          Model value written to agent.*.model",
    "  --help                   Show this help",
    "",
    "Examples:",
    "  opencode-nexus setup",
    "  opencode-nexus setup --scope project --directory /path/to/repo --model openai/gpt-5.3-codex",
    "  opencode-nexus setup --scope user --model anthropic/claude-sonnet-4",
    "",
    "Interactive mode prompts for missing values when stdin/stdout are TTYs.",
  ].join("\n"));
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
  if (isRawSingleSelectTerminal()) {
    return promptChoiceRaw(message, choices, defaultValue);
  }
  return promptChoiceFallback(getReadline(), message, choices, defaultValue);
}

async function promptText(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue?: string
): Promise<string> {
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
        resolved.directory = path.resolve(await promptText(getReadline(), "Project directory", process.cwd()));
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
          getReadline(),
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
  defaultModelValue: string
): Promise<SetupCliOptions> {
  if (!isInteractiveTerminal()) {
    return options;
  }

  const needsScopePrompt = !explicit.configPath && !explicit.scope;
  const needsModelPrompt = !explicit.model;

  if (!needsScopePrompt && !needsModelPrompt) {
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
        "Which OpenCode config should be updated?",
        [
          { value: "user", label: "user (~/.config/opencode/opencode.json)" },
          { value: "project", label: "project (./opencode.json)" },
        ],
        DEFAULT_SCOPE
      );
      output.write("\n");

      if (resolved.scope === "project" && !explicit.directory) {
        resolved.directory = path.resolve(await promptText(getReadline(), "Project directory", process.cwd()));
        output.write("\n");
      }
    }

    if (needsModelPrompt) {
      resolved.model = (await promptText(getReadline(), "Model for agent.*.model", defaultModelValue)).trim();
      output.write("\n");
    }

    return resolved;
  } finally {
    rl?.close();
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
  packageVersion: string | undefined
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

function applySetupModel(config: ConfigLike, model: string): { next: ConfigLike; updatedAgents: string[] } {
  const normalizedModel = model.trim();
  const currentAgent = toRecord(config.agent);
  const nextAgent: Record<string, unknown> = { ...currentAgent };
  const targets = new Set<string>([NEXUS_PRIMARY_AGENT_ID, ...Object.keys(AGENT_META), ...Object.keys(currentAgent)]);

  for (const agentId of targets) {
    const current = toRecord(nextAgent[agentId]);
    nextAgent[agentId] = {
      ...current,
      model: normalizedModel,
    };
  }

  return {
    next: {
      ...config,
      $schema: config.$schema ?? OPENCODE_SCHEMA_URL,
      agent: nextAgent,
    },
    updatedAgents: Array.from(targets).sort(),
  };
}

async function executeSetupCommand(options: SetupCliOptions): Promise<void> {
  const model = options.model?.trim();
  if (!model) {
    throw new Error("Setup requires `--model <value>` in non-interactive mode.");
  }

  const configPath = resolveConfigPath(options);
  const config = await readJsonFile<ConfigLike>(configPath, { $schema: OPENCODE_SCHEMA_URL });
  const { next, updatedAgents } = applySetupModel(config, model);
  await writeJsonFile(configPath, next);

  console.log(
    JSON.stringify(
      {
        ok: true,
        command: "setup",
        scope: options.scope,
        configPath,
        model,
        updatedAgents,
      },
      null,
      2
    )
  );
}

async function main(): Promise<void> {
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
    await executeSetupCommand(resolvedOptions);
    return;
  }

  const packageVersion = await readPackageVersion();
  const resolvedOptions = await resolveInteractiveOptions(parsed.command, parsed.options, parsed.explicit, packageVersion);
  await executePluginCommand(parsed.command, resolvedOptions, packageVersion);

  if (parsed.command === "install" && isInteractiveTerminal()) {
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
      },
      DEFAULT_MODEL
    );
    await executeSetupCommand(setupOptions);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[opencode-nexus] ${message}`);
  process.exit(1);
});
