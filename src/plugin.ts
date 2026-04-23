import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";
import { architect } from "./agents/architect.js";
import { designer } from "./agents/designer.js";
import { engineer } from "./agents/engineer.js";
import { lead } from "./agents/lead.js";
import { postdoc } from "./agents/postdoc.js";
import { researcher } from "./agents/researcher.js";
import { reviewer } from "./agents/reviewer.js";
import { strategist } from "./agents/strategist.js";
import { tester } from "./agents/tester.js";
import { writer } from "./agents/writer.js";

const NEXUS_GITIGNORE = `# Nexus: whitelist tracked files, ignore everything else
*
!.gitignore
!context/
!context/**
!memory/
!memory/**
!history.json
`;

const TAG_INSTRUCTIONS = new Map([
  ["[plan]", "Activate the nx-plan skill and follow its planning workflow for this request."],
  ["[auto-plan]", "Activate the nx-auto-plan skill and follow its autonomous planning workflow for this request."],
  ["[run]", "Activate the nx-run skill and follow its execution workflow for this request."],
  ["[m]", "Store the relevant content from this request under .nexus/memory/ using Nexus memory conventions."],
  ["[m:gc]", "Clean up and merge .nexus/memory/ using Nexus memory conventions."],
  ["[d]", "Record the current plan decision with nx_plan_decide."],
]);

const NEXUS_AGENTS = {
  architect,
  designer,
  engineer,
  lead,
  postdoc,
  researcher,
  reviewer,
  strategist,
  tester,
  writer,
};

const PILL_KEY = "nexus-state";
const PILL_COLOR = "#007AFF";
const RUNNING_ICON = "bolt";
const RUNNING_VALUE = "Running";
const NEEDS_INPUT_ICON = "bell";
const NEEDS_INPUT_VALUE = "Needs Input";
const LOG_SOURCE = "nexus";

function ensureNexusStructure(root: string) {
  const nexusDir = join(root, ".nexus");
  const contextDir = join(nexusDir, "context");
  const memoryDir = join(nexusDir, "memory");
  const stateDir = join(nexusDir, "state");
  const gitignorePath = join(nexusDir, ".gitignore");

  mkdirSync(contextDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, NEXUS_GITIGNORE, "utf8");
  }
}

function extractLeadingTag(text: string) {
  const trimmed = text.trimStart();
  for (const tag of TAG_INSTRUCTIONS.keys()) {
    if (trimmed.startsWith(tag)) return tag;
  }
  return null;
}

function stripLeadingTag(text: string, tag: string) {
  const leadingWhitespace = text.match(/^\s*/)?.[0] ?? "";
  const remaining = text.slice(leadingWhitespace.length);
  if (!remaining.startsWith(tag)) return text;
  return `${leadingWhitespace}${remaining.slice(tag.length).trimStart()}`;
}

function toAgentConfig(agent: { description?: string; mode?: string; permission?: Record<string, unknown>; system?: string }) {
  return {
    description: agent.description,
    mode: agent.mode,
    permission: agent.permission,
    prompt: agent.system,
  };
}

function mergeAgentConfig(base: Record<string, unknown>, override: Record<string, unknown>) {
  const merged = { ...base, ...override };

  const basePermission = typeof base.permission === "object" && base.permission !== null ? base.permission : {};
  const overridePermission = typeof override.permission === "object" && override.permission !== null ? override.permission : {};
  if (Object.keys(basePermission).length > 0 || Object.keys(overridePermission).length > 0) {
    merged.permission = { ...basePermission, ...overridePermission };
  }

  return merged;
}

// cmux integration: forward lifecycle signals to the cmux desktop app via its
// CLI (`cmux notify`) so users get native OS notifications when a response is
// ready or the agent is asking for input. This is a best-effort integration:
// we only fire when the OpenCode process is running inside a cmux terminal
// (identified by the CMUX_WORKSPACE_ID env var that cmux injects) and we
// swallow any failure silently so non-cmux environments see no change.
// Disable entirely by setting OPENCODE_NEXUS_CMUX=0 or OPENCODE_NEXUS_CMUX=false.
function isCmuxNotifyEnabled(): boolean {
  if (!process.env.CMUX_WORKSPACE_ID) return false;
  const flag = process.env.OPENCODE_NEXUS_CMUX;
  if (flag === "0" || flag === "false") return false;
  return true;
}

function cmuxSpawn(args: string[]): void {
  if (!isCmuxNotifyEnabled()) return;
  try {
    const child = spawn("cmux", args, {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch {}
}

function cmuxNotify(title: string, body: string): void {
  cmuxSpawn(["notify", "--title", title, "--body", body]);
}

function cmuxSetStatus(key: string, value: string, icon: string, color: string): void {
  cmuxSpawn(["set-status", key, value, "--icon", icon, "--color", color]);
}

function cmuxClearStatus(key: string): void {
  cmuxSpawn(["clear-status", key]);
}

function cmuxLog(level: "info" | "error" | "warning" | "progress" | "success", source: string, message: string): void {
  cmuxSpawn(["log", "--level", level, "--source", source, "--", message]);
}

function extractErrorSummary(err: unknown): string {
  if (typeof err !== "object" || err === null) return "unknown";
  const record = err as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.length > 0) return record.message;
  if (typeof record.name === "string" && record.name.length > 0) return record.name;
  if (typeof record.type === "string" && record.type.length > 0) return record.type;
  if (typeof record.code === "string" && record.code.length > 0) return record.code;
  return "unknown";
}

export const OpencodeNexus: Plugin = async ({ directory }) => {
  // Track root sessions so we only forward `session.idle` to cmux for the
  // top-level session. Subagent sessions also emit `session.idle` whenever
  // they finish a turn, and notifying on each of those would be spam.
  const rootSessions = new Set<string>();

  return {
    config: async (config) => {
      const configRecord = config as Record<string, unknown>;
      config.agent ??= {};

      for (const [id, agent] of Object.entries(NEXUS_AGENTS)) {
        const generated = toAgentConfig(agent);
        const existing = typeof config.agent[id] === "object" && config.agent[id] !== null ? config.agent[id] : {};
        config.agent[id] = mergeAgentConfig(generated, existing as Record<string, unknown>);
      }

      if (typeof configRecord.default_agent !== "string" || configRecord.default_agent.length === 0) {
        configRecord.default_agent = "lead";
      }
    },
    event: async ({ event }) => {
      if (event.type === "session.created") {
        if (!event.properties.info.parentID) {
          rootSessions.add(event.properties.info.id);
          ensureNexusStructure(directory);
        }
        return;
      }
      if (event.type === "session.deleted") {
        const wasRoot = rootSessions.has(event.properties.info.id);
        rootSessions.delete(event.properties.info.id);
        if (wasRoot) {
          cmuxClearStatus(PILL_KEY);
        }
        return;
      }
      if (event.type === "session.idle" && rootSessions.has(event.properties.sessionID)) {
        cmuxNotify("opencode-nexus", "Response ready");
        cmuxClearStatus(PILL_KEY);
        return;
      }
      if (event.type === "session.status" && rootSessions.has(event.properties.sessionID)) {
        const status = event.properties.status;
        if (status.type === "busy") {
          cmuxSetStatus(PILL_KEY, RUNNING_VALUE, RUNNING_ICON, PILL_COLOR);
        } else if (status.type === "retry") {
          cmuxLog("warning", LOG_SOURCE, `Retrying (attempt ${status.attempt}): ${status.message}`);
        }
        return;
      }
      if (event.type === "session.error") {
        const sessionID = event.properties.sessionID;
        if (sessionID && !rootSessions.has(sessionID)) return;

        const summary = extractErrorSummary(event.properties.error);
        cmuxLog("error", LOG_SOURCE, summary);
        cmuxNotify("opencode-nexus", "Session error");
        return;
      }
      if (event.type === "permission.replied" && rootSessions.has(event.properties.sessionID)) {
        cmuxClearStatus(PILL_KEY);
        return;
      }
    },
    "tool.execute.before": async (input) => {
      if (input.tool === "question") {
        cmuxNotify("opencode-nexus", "Waiting for your input");
        cmuxSetStatus(PILL_KEY, NEEDS_INPUT_VALUE, NEEDS_INPUT_ICON, PILL_COLOR);
      }
    },
    "permission.ask": async (_input, _output) => {
      cmuxNotify("opencode-nexus", "Permission requested");
      cmuxSetStatus(PILL_KEY, NEEDS_INPUT_VALUE, NEEDS_INPUT_ICON, PILL_COLOR);
    },
    "chat.message": async (_input, output) => {
      const textPart = output.parts.find((part) => part.type === "text");
      if (!textPart || typeof textPart.text !== "string") return;

      const tag = extractLeadingTag(textPart.text);
      if (!tag) return;

      const strippedText = stripLeadingTag(textPart.text, tag).trim();
      const instruction = TAG_INSTRUCTIONS.get(tag);
      if (!instruction) return;

      textPart.text = `${strippedText}\n\n[Nexus Hook]\n${instruction}`.trim();
    },
  };
};

export default OpencodeNexus;
