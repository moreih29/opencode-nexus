#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { readJsonFile, writeJsonFile } from "./shared/json-store.js";

type Command = "install" | "update";
type Scope = "project" | "user";

interface CliOptions {
  scope: Scope;
  directory: string;
  configPath?: string;
  version?: string;
  pin: boolean;
}

interface ConfigLike {
  $schema?: string;
  plugin?: unknown;
  [key: string]: unknown;
}

interface ExplicitOptions {
  scope: boolean;
  directory: boolean;
  configPath: boolean;
  version: boolean;
  pin: boolean;
}

type ParsedArgs =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "command"; command: Command; options: CliOptions; explicit: ExplicitOptions };

const PACKAGE_NAME = "opencode-nexus";
const OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json";
const DEFAULT_SCOPE: Scope = "user";

function printHelp(): void {
  console.log([
    "opencode-nexus CLI",
    "",
    "Usage:",
    "  opencode-nexus install [options]",
    "  opencode-nexus update [options]",
    "",
    "Options:",
    "  --scope <user|project>   Target OpenCode config scope (default: user)",
    "  --directory <path>       Project root for project scope (default: cwd)",
    "  --config <path>          Explicit config file path override",
    "  --version <value>        Plugin version/spec suffix (default: current package version)",
    "  --no-pin                 Write unpinned plugin spec (opencode-nexus)",
    "  -v, --version            Show CLI package version when used without a command",
    "  --help                   Show this help",
    "",
    "Run `install` or `update` without flags in a terminal to answer prompts interactively.",
    "",
    "Examples:",
    "  opencode-nexus install",
    "  opencode-nexus install --scope user",
    "  opencode-nexus install --scope project --directory /path/to/repo",
    "  opencode-nexus update --scope project --version 0.6.0",
    "  opencode-nexus --version",
  ].join("\n"));
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    return { kind: "help" };
  }

  if (argv.length === 1) {
    const [token] = argv;
    if (token === "--help" || token === "-h") {
      return { kind: "help" };
    }
    if (token === "--version" || token === "-v" || token === "version") {
      return { kind: "version" };
    }
  }

  const [commandRaw, ...rest] = argv;
  if (commandRaw !== "install" && commandRaw !== "update") {
    throw new Error(`Unknown command: ${commandRaw}`);
  }

  const options: CliOptions = {
    scope: DEFAULT_SCOPE,
    directory: process.cwd(),
    pin: true,
  };
  const explicit: ExplicitOptions = {
    scope: false,
    directory: false,
    configPath: false,
    version: false,
    pin: false,
  };

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === "--help" || token === "-h") {
      return { kind: "help" };
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

  return { kind: "command", command: commandRaw, options, explicit };
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

async function promptChoice<T extends string>(
  rl: ReturnType<typeof createInterface>,
  message: string,
  choices: Array<{ value: T; label: string }>,
  defaultValue: T
): Promise<T> {
  const defaultIndex = choices.findIndex((choice) => choice.value === defaultValue) + 1;

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
  command: Command,
  options: CliOptions,
  explicit: ExplicitOptions,
  packageVersion: string | undefined
): Promise<CliOptions> {
  if (!isInteractiveTerminal()) {
    return options;
  }

  const needsScopePrompt = !explicit.configPath && !explicit.scope;
  const needsPinPrompt = !explicit.pin && !explicit.version;

  if (!needsScopePrompt && !needsPinPrompt) {
    return options;
  }

  const rl = createInterface({ input, output });
  const resolved = { ...options };

  try {
    if (needsScopePrompt) {
      resolved.scope = await promptChoice(
        rl,
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
        resolved.directory = path.resolve(await promptText(rl, "Project directory", process.cwd()));
        output.write("\n");
      }
    }

    if (needsPinPrompt) {
      const pinSelection = await promptChoice(
        rl,
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
          rl,
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
    rl.close();
  }
}

function resolveConfigPath(options: CliOptions): string {
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

async function execute(command: Command, options: CliOptions, packageVersion: string | undefined): Promise<void> {
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

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.kind === "help") {
    printHelp();
    return;
  }

  const packageVersion = await readPackageVersion();

  if (parsed.kind === "version") {
    console.log(packageVersion ?? "unknown");
    return;
  }

  const resolvedOptions = await resolveInteractiveOptions(parsed.command, parsed.options, parsed.explicit, packageVersion);
  await execute(parsed.command, resolvedOptions, packageVersion);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[opencode-nexus] ${message}`);
  process.exit(1);
});
