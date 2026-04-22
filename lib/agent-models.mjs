import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import React, { useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput, useWindowSize } from "ink";
import { promptSelectInteractive } from "./ink-select.mjs";
import { projectConfigPath, userConfigPath } from "./install-spec.mjs";

const h = React.createElement;
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
const AGENT_LABEL_WIDTH = Math.max(...AGENT_IDS.map((agentId) => agentId.length));
const MAIN_ACTIONS = [
  { id: "next", label: "Next" },
  { id: "done", label: "Done" },
  { id: "cancel", label: "Cancel" },
];
const BACK = "__back__";

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getViewport(total, visibleCount, focusIndex) {
  if (total <= visibleCount) {
    return { start: 0, end: total };
  }

  const start = clamp(focusIndex - Math.floor(visibleCount / 2), 0, total - visibleCount);
  return { start, end: start + visibleCount };
}

function buildProviderItems(providersById) {
  return [
    ...[...providersById.entries()].map(([providerId, models]) => ({
      id: providerId,
      label: providerId,
      hint: `${models.length} models`,
    })),
    { id: BACK, label: "Back" },
  ];
}

function buildModelItems(providersById, provider) {
  return [
    ...(providersById.get(provider) ?? []).map((model) => ({
      id: model,
      label: model,
    })),
    { id: BACK, label: "Back" },
  ];
}

function TextLine({ text, color, dimColor, bold }) {
  return h(Text, { wrap: "truncate-end", color, dimColor, bold }, text);
}

function MainScreen({ config, cursor, selectedAgents, status, rows }) {
  const selectedSet = useMemo(() => new Set(selectedAgents), [selectedAgents]);
  const statusLineCount = status ? 1 : 0;
  const reservedRows = 3 + 1 + MAIN_ACTIONS.length + 1 + 1 + statusLineCount;
  const availableAgentRows = Math.max(1, rows - reservedRows);
  const agentFocus = clamp(cursor, 0, AGENT_IDS.length - 1);
  const { start, end } = getViewport(AGENT_IDS.length, availableAgentRows, agentFocus);

  const children = [
    h(TextLine, { key: "title", text: "Configure Nexus agent models", bold: true }),
    h(TextLine, {
      key: "help",
      text: "Use up/down to move, Space to toggle agents, Enter to select, q to cancel",
      dimColor: true,
    }),
    h(TextLine, { key: "gap-1", text: "" }),
  ];

  for (let index = start; index < end; index += 1) {
    const agentId = AGENT_IDS[index];
    const active = cursor === index;
    const selected = selectedSet.has(agentId) ? "x" : " ";
    const pointer = active ? ">" : " ";
    const line = `${pointer} [${selected}] ${agentId.padEnd(AGENT_LABEL_WIDTH)}  > ${formatAgentLabel(config, agentId)}`;
    children.push(h(TextLine, {
      key: `agent-${agentId}`,
      text: line,
      color: active ? "cyan" : undefined,
      bold: active,
    }));
  }

  children.push(h(TextLine, { key: "gap-2", text: "" }));

  MAIN_ACTIONS.forEach((action, index) => {
    const active = cursor === AGENT_IDS.length + index;
    const pointer = active ? ">" : " ";
    children.push(h(TextLine, {
      key: `action-${action.id}`,
      text: `${pointer} ${action.label}`,
      color: active ? "cyan" : undefined,
      bold: active,
    }));
  });

  children.push(h(TextLine, { key: "gap-3", text: "" }));
  children.push(h(TextLine, {
    key: "selected",
    text: `Selected: ${selectedAgents.length > 0 ? selectedAgents.join(", ") : "none"}`,
    dimColor: true,
  }));

  if (status) {
    children.push(h(TextLine, {
      key: "status",
      text: status.text,
      color: status.kind === "error" ? "yellow" : "green",
    }));
  }

  return h(Box, { flexDirection: "column" }, children);
}

function ChoiceScreen({ title, subtitle, items, cursor, status, rows }) {
  const statusLineCount = status ? 2 : 0;
  const subtitleLineCount = subtitle ? 1 : 0;
  const reservedRows = 3 + subtitleLineCount + statusLineCount;
  const availableRows = Math.max(1, rows - reservedRows);
  const { start, end } = getViewport(items.length, availableRows, cursor);

  const children = [
    h(TextLine, { key: "title", text: title, bold: true }),
    h(TextLine, {
      key: "help",
      text: "Use up/down to move, Enter to select, Escape to go back, q to cancel",
      dimColor: true,
    }),
  ];

  if (subtitle) {
    children.push(h(TextLine, { key: "subtitle", text: subtitle, dimColor: true }));
  }

  children.push(h(TextLine, { key: "gap", text: "" }));

  for (let index = start; index < end; index += 1) {
    const item = items[index];
    const active = cursor === index;
    const pointer = active ? ">" : " ";
    const line = `${pointer} ${item.label}${item.hint ? `  > ${item.hint}` : ""}`;
    children.push(h(TextLine, {
      key: `item-${item.id}`,
      text: line,
      color: active ? "cyan" : undefined,
      bold: active,
    }));
  }

  if (status) {
    children.push(h(TextLine, { key: "status-gap", text: "" }));
    children.push(h(TextLine, {
      key: "status",
      text: status.text,
      color: status.kind === "error" ? "yellow" : "green",
    }));
  }

  return h(Box, { flexDirection: "column" }, children);
}

function AgentModelsApp({ configPath, initialConfig, providersById }) {
  const { exit } = useApp();
  const { rows } = useWindowSize();
  const [config, setConfig] = useState(initialConfig);
  const [screen, setScreen] = useState("main");
  const [cursor, setCursor] = useState(0);
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [provider, setProvider] = useState(null);
  const [status, setStatus] = useState(null);
  const [dirty, setDirty] = useState(false);

  const providerItems = useMemo(() => buildProviderItems(providersById), [providersById]);
  const modelItems = useMemo(() => buildModelItems(providersById, provider), [providersById, provider]);
  const currentItems = screen === "provider" ? providerItems : modelItems;

  function finish(saved) {
    exit({ configPath, saved, config });
  }

  function saveAndFinish() {
    if (dirty) {
      writeJson(configPath, config);
    }

    finish(dirty);
  }

  function cancelAndFinish() {
    finish(false);
  }

  function moveCursor(delta) {
    const maxIndex = screen === "main"
      ? AGENT_IDS.length + MAIN_ACTIONS.length - 1
      : Math.max(0, currentItems.length - 1);
    setCursor((value) => clamp(value + delta, 0, maxIndex));
  }

  function toggleCurrentAgent() {
    const agentId = AGENT_IDS[cursor];
    if (!agentId) return;

    setSelectedAgents((value) => {
      if (value.includes(agentId)) {
        return value.filter((entry) => entry !== agentId);
      }

      return AGENT_IDS.filter((entry) => entry === agentId || value.includes(entry));
    });
    setStatus(null);
  }

  function goBack() {
    if (screen === "model") {
      setScreen("provider");
      setCursor(0);
      return;
    }

    if (screen === "provider") {
      setScreen("main");
      setCursor(0);
    }
  }

  function handleMainEnter() {
    if (cursor < AGENT_IDS.length) {
      toggleCurrentAgent();
      return;
    }

    const action = MAIN_ACTIONS[cursor - AGENT_IDS.length]?.id;
    if (action === "next") {
      if (selectedAgents.length === 0) {
        setStatus({ kind: "error", text: "Select at least one agent before continuing." });
        return;
      }

      setScreen("provider");
      setCursor(0);
      setStatus(null);
      return;
    }

    if (action === "done") {
      saveAndFinish();
      return;
    }

    if (action === "cancel") {
      cancelAndFinish();
    }
  }

  function handleChoiceEnter() {
    const item = currentItems[cursor];
    if (!item) return;

    if (item.id === BACK) {
      goBack();
      return;
    }

    if (screen === "provider") {
      setProvider(item.id);
      setScreen("model");
      setCursor(0);
      setStatus(null);
      return;
    }

    const modelSpec = `${provider}/${item.id}`;
    setConfig((value) => withAgentModelSpec(value, selectedAgents, modelSpec));
    setSelectedAgents([]);
    setScreen("main");
    setCursor(0);
    setStatus({ kind: "success", text: `Updated ${selectedAgents.join(", ")} -> ${modelSpec}` });
    setDirty(true);
  }

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      cancelAndFinish();
      return;
    }

    if (key.escape) {
      if (screen === "main") {
        cancelAndFinish();
        return;
      }

      goBack();
      return;
    }

    if (key.upArrow) {
      moveCursor(-1);
      return;
    }

    if (key.downArrow) {
      moveCursor(1);
      return;
    }

    if (input === " " && screen === "main" && cursor < AGENT_IDS.length) {
      toggleCurrentAgent();
      return;
    }

    if (!key.return) {
      return;
    }

    if (screen === "main") {
      handleMainEnter();
      return;
    }

    handleChoiceEnter();
  });

  const subtitle = screen === "provider"
    ? `Selected agents: ${selectedAgents.join(", ")}`
    : provider
      ? `Selected provider: ${provider}`
      : "";

  if (screen === "main") {
    return h(MainScreen, {
      config,
      cursor,
      selectedAgents,
      status,
      rows,
    });
  }

  return h(ChoiceScreen, {
    title: screen === "provider" ? `Choose a provider for ${selectedAgents.join(", ")}` : `Choose a model from ${provider}`,
    subtitle,
    items: currentItems,
    cursor,
    status,
    rows,
  });
}

export async function configureAgentModelsInteractive({ scope, cwd = process.cwd() } = {}) {
  if (!canUseInteractiveTerminal()) {
    throw new Error("Interactive model configuration requires a TTY.");
  }

  let resolvedScope = scope;
  if (resolvedScope !== "project" && resolvedScope !== "user") {
    resolvedScope = await promptSelectInteractive({
      title: "Choose where to write agent model settings",
      subtitle: "Project scope updates ./opencode.json. User scope updates ~/.config/opencode/opencode.json.",
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

    if (resolvedScope === null) {
      return { configPath: null, saved: false, config: null };
    }
  }

  const configPath = resolveConfigPath(resolvedScope, cwd);
  const config = readJson(configPath);
  const providersById = await listAvailableModels(cwd);
  const instance = render(h(AgentModelsApp, {
    configPath,
    initialConfig: config,
    providersById,
  }), {
    exitOnCtrlC: false,
    patchConsole: false,
  });

  return instance.waitUntilExit();
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
