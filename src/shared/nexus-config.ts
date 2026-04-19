import fs from "node:fs/promises";
import { IsolatedConfig, validateIsolatedConfig } from "./nexus-config-schema.js";
import { writeJsonFile } from "./json-store.js";

export interface ReadIsolatedConfigResult {
  config: IsolatedConfig;
  warnings: string[];
  source: "parsed" | "missing" | "parse-error";
}

export async function readIsolatedConfig(path: string): Promise<ReadIsolatedConfigResult> {
  let raw: string;

  try {
    raw = await fs.readFile(path, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return {
        config: createEmptyConfig(),
        warnings: [],
        source: "missing"
      };
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (error) {
    return {
      config: createEmptyConfig(),
      warnings: [formatParseError(path, error)],
      source: "parse-error"
    };
  }

  const validated = validateIsolatedConfig(parsed);
  return {
    config: validated.config,
    warnings: validated.warnings,
    source: "parsed"
  };
}

export async function writeIsolatedConfig(path: string, config: IsolatedConfig): Promise<void> {
  const validated = validateIsolatedConfig(config);
  await writeJsonFile(path, validated.config);
}

export function mergeIsolatedConfigs(...configs: IsolatedConfig[]): IsolatedConfig {
  const merged: IsolatedConfig = {
    version: 1,
    agents: {}
  };

  for (const config of configs) {
    merged.version = config.version;

    for (const [agentId, incomingAgentConfig] of Object.entries(config.agents)) {
      const existing = merged.agents[agentId] ?? {};
      const nextTools =
        existing.tools || incomingAgentConfig.tools
          ? {
              ...(existing.tools ?? {}),
              ...(incomingAgentConfig.tools ?? {})
            }
          : undefined;

      merged.agents[agentId] = {
        ...existing,
        ...incomingAgentConfig,
        ...(nextTools ? { tools: nextTools } : {})
      };
    }
  }

  return merged;
}

function stripJsonComments(src: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let isEscaped = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];

    if (inLineComment) {
      if (ch === "\n" || ch === "\r") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        out += ch;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === "\\") {
        isEscaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    out += ch;
  }

  return out;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function formatParseError(configPath: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${configPath}: failed to parse JSONC (${message})`;
}

function createEmptyConfig(): IsolatedConfig {
  return { version: 1, agents: {} };
}
