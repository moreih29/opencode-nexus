import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import { cancel, intro, isCancel, multiselect, note, outro, select } from "@clack/prompts";
import { projectConfigPath, userConfigPath } from "./install-spec.mjs";

const ANSI_ESCAPE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const AGENT_IDS = [
  "lead",
  "general",
  "explore",
  "architect",
  "designer",
  "postdoc",
  "strategist",
  "engineer",
  "researcher",
  "writer",
  "reviewer",
  "tester",
];
const INVERSE_ON = "\x1b[7m";
const INVERSE_OFF = "\x1b[27m";

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readJson(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stripAnsi(text) {
  return text.replace(ANSI_ESCAPE, "");
}

function resolveConfigPath(scope, cwd = process.cwd()) {
  if (scope === "user") {
    return userConfigPath();
  }

  return projectConfigPath(cwd);
}

function getAgentModelSpec(config, agentId) {
  const agentModel = config.agent?.[agentId]?.model;
  if (typeof agentModel === "string" && agentModel.length > 0) {
    return { value: agentModel, source: "agent" };
  }

  if (typeof config.model === "string" && config.model.length > 0) {
    return { value: config.model, source: "global" };
  }

  return { value: null, source: "unset" };
}

function formatAgentLabel(config, agentId) {
  const spec = getAgentModelSpec(config, agentId);
  if (!spec.value) {
    return "inherit";
  }

  const parts = spec.value.split("/");
  return parts.at(-1) || spec.value;
}

function withAgentModelSpec(config, agentIds, modelSpec) {
  const next = {
    ...config,
    agent: typeof config.agent === "object" && config.agent !== null ? { ...config.agent } : {},
  };

  for (const agentId of agentIds) {
    const existing = typeof next.agent[agentId] === "object" && next.agent[agentId] !== null ? next.agent[agentId] : {};
    next.agent[agentId] = {
      ...existing,
      model: modelSpec,
    };
  }

  return next;
}

function setAgentModelSpec(config, agentIds, modelSpec) {
  const next = withAgentModelSpec(config, agentIds, modelSpec);
  Object.assign(config, next);
}

function withAgentModelUnset(config, agentIds) {
  const next = {
    ...config,
    agent: typeof config.agent === "object" && config.agent !== null ? { ...config.agent } : {},
  };

  for (const agentId of agentIds) {
    if (typeof next.agent[agentId] === "object" && next.agent[agentId] !== null) {
      const { model: _model, ...rest } = next.agent[agentId];
      if (Object.keys(rest).length === 0) {
        delete next.agent[agentId];
      } else {
        next.agent[agentId] = rest;
      }
    }
  }

  if (Object.keys(next.agent).length === 0) {
    delete next.agent;
  }

  return next;
}

function unsetAgentModelSpec(config, agentIds) {
  const next = withAgentModelUnset(config, agentIds);
  delete config.agent;
  Object.assign(config, next);
}

function parseModelLines(output) {
  return stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[^/\s]+\/.+$/.test(line));
}

function runCommand(command, args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

export async function listAvailableModels(cwd = process.cwd()) {
  const result = await runCommand("opencode", ["models", "--pure"], cwd);
  if (result.code !== 0) {
    throw new Error(stripAnsi(result.stderr || result.stdout || "Failed to list OpenCode models"));
  }

  const entries = parseModelLines(result.stdout);
  if (entries.length === 0) {
    throw new Error("No OpenCode models were found. Check your OpenCode provider setup.");
  }

  const grouped = new Map();
  for (const entry of entries) {
    const [provider, ...rest] = entry.split("/");
    const model = rest.join("/");
    if (!provider || !model) continue;

    const current = grouped.get(provider) ?? [];
    current.push(model);
    grouped.set(provider, current);
  }

  for (const models of grouped.values()) {
    models.sort((a, b) => a.localeCompare(b));
  }

  return new Map([...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

export function canUseInteractiveTerminal() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function parseAgents(agentList) {
  const entries = agentList
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw new Error("No agents were provided.");
  }

  for (const entry of entries) {
    if (!AGENT_IDS.includes(entry)) {
      throw new Error(`Unknown agent: ${entry}`);
    }
  }

  return entries;
}

async function selectCycleAction() {
  return select({
    message: "What's next?",
    options: [
      { value: "done", label: "Done", hint: "save and exit" },
      { value: "continue", label: "Continue mapping", hint: "map another batch" },
      { value: "cancel", label: "Cancel", hint: "discard changes and exit" },
    ],
    initialValue: "done",
  });
}

function formatModelHint(config, agentId) {
  const spec = getAgentModelSpec(config, agentId);
  return spec.value ? `current: ${spec.value}` : "inherit";
}

function summarizeMapping(agentIds, modelSpec) {
  return `${agentIds.join(", ")} -> ${modelSpec}`;
}

export async function configureAgentModelsInteractive({ scope, cwd = process.cwd() } = {}) {
  if (!canUseInteractiveTerminal()) {
    throw new Error("Interactive model configuration requires a TTY.");
  }

  let resolvedScope = scope;
  if (resolvedScope !== "project" && resolvedScope !== "user") {
    const selectedScope = await select({
      message: "Choose where to write agent model settings",
      options: [
        {
          value: "project",
          label: "project",
          hint: "Write model overrides to the current repository",
        },
        {
          value: "user",
          label: "user",
          hint: "Write model overrides to your global OpenCode config",
        },
      ],
      initialValue: "project",
    });

    if (isCancel(selectedScope)) {
      return { configPath: null, saved: false, config: null };
    }

    resolvedScope = selectedScope;
  }

  const configPath = resolveConfigPath(resolvedScope, cwd);
  const config = readJson(configPath);
  const providersById = await listAvailableModels(cwd);
  let dirty = false;
  let previousSummary = "No changes yet";
  let cancelled = false;
  let shouldSave = false;
  let exitMessage = "No model changes saved.";

  intro("Configure Nexus agent models");

  while (true) {
    note(previousSummary, "Previous mapping");

    const selectedAgents = await multiselect({
      message: `Select agents (${INVERSE_ON}Space${INVERSE_OFF} toggle, ${INVERSE_ON}Enter${INVERSE_OFF} submit; submit empty to finish)`,
      options: AGENT_IDS.map((agentId) => ({
        value: agentId,
        label: agentId,
        hint: formatModelHint(config, agentId),
      })),
      required: false,
      initialValues: [],
    });

    if (isCancel(selectedAgents)) {
      note("Selection cancelled; pending mappings are preserved until you choose an exit action.", "Cycle result");
    } else if (selectedAgents.length === 0) {
      if (!dirty) {
        break;
      }

      note("No agents selected; choose whether to save pending mappings.", "Cycle result");
    } else {
      const provider = await select({
        message: `Choose a provider for ${selectedAgents.join(", ")}`,
        options: [
          { value: "__inherit__", label: "inherit", hint: "use the default model (clear override)" },
          ...[...providersById.entries()].map(([providerId, models]) => ({
            value: providerId,
            label: providerId,
            hint: `${models.length} models`,
          })),
        ],
      });

      if (isCancel(provider)) {
        note("Provider selection cancelled; pending mappings are preserved until you choose an exit action.", "Cycle result");
      } else if (provider === "__inherit__") {
        unsetAgentModelSpec(config, selectedAgents);
        dirty = true;
        previousSummary = `${selectedAgents.join(", ")} -> inherit`;
        note(previousSummary, "Cycle result");
      } else {
        const model = await select({
          message: `Choose a model from ${provider}`,
          options: (providersById.get(provider) ?? []).map((modelId) => ({
            value: modelId,
            label: modelId,
          })),
        });

        if (isCancel(model)) {
          note("Model selection cancelled; pending mappings are preserved until you choose an exit action.", "Cycle result");
        } else {
          const modelSpec = `${provider}/${model}`;
          setAgentModelSpec(config, selectedAgents, modelSpec);
          dirty = true;
          previousSummary = summarizeMapping(selectedAgents, modelSpec);
          note(previousSummary, "Cycle result");
        }
      }
    }

    const action = await selectCycleAction();
    if (isCancel(action) || action === "cancel") {
      cancelled = true;
      break;
    }

    if (action === "continue") {
      continue;
    }

    shouldSave = dirty;
    exitMessage = dirty ? `wrote: ${configPath}` : "No model changes saved.";
    break;
  }

  if (cancelled) {
    cancel("Agent model configuration cancelled. No changes were saved.");
    return { configPath, saved: false, config };
  }

  if (shouldSave) {
    writeJson(configPath, config);
  }

  outro(exitMessage);
  return { configPath, saved: shouldSave, config };
}

export async function configureAgentModelsDirect({ scope = "project", cwd = process.cwd(), agents, model } = {}) {
  if (typeof agents !== "string" || typeof model !== "string") {
    throw new Error("Direct model configuration requires both --agents and --model.");
  }

  const providersById = await listAvailableModels(cwd);
  const [provider, ...rest] = model.split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) {
    throw new Error(`Model must be in provider/model format: ${model}`);
  }

  const providerModels = providersById.get(provider);
  if (!providerModels || !providerModels.includes(modelId)) {
    throw new Error(`Model is not available in OpenCode: ${model}`);
  }

  const configPath = resolveConfigPath(scope, cwd);
  const config = readJson(configPath);
  const agentIds = parseAgents(agents);
  setAgentModelSpec(config, agentIds, model);
  writeJson(configPath, config);
  return { configPath, model, agentIds };
}
