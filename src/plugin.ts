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
const NEEDS_INPUT_ICON = "bell.fill";
const NEEDS_INPUT_VALUE = "Needs Input";
const LOG_SOURCE = "nexus";
const RESPONSE_READY_FALLBACK = "Response ready";
const PREVIEW_MAX_LEN = 100;
const PRE_CHECK_MARKER = "[Pre-check]";

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

// All cmux CLI invocations go through a single promise queue so they reach
// the cmux server socket in the same order the plugin emitted them. Previous
// fire-and-forget detached spawns suffered from an OS-level race: when a
// `set-status` child and a follow-up `clear-status` child were forked in
// rapid succession (e.g. session.status busy immediately followed by
// session.idle), the two processes wrote to the cmux unix socket in
// nondeterministic order and `clear` could land before `set`, leaving the
// pill stuck as "Running" even though the plugin logic had intended to clear
// it. Serialising them via awaiting child exit guarantees the server sees
// writes in plugin-issued order. Callers remain fire-and-forget: the queue
// is maintained internally and we never return a Promise to the event hook.
let cmuxQueue: Promise<void> = Promise.resolve();

function cmuxSpawn(args: string[]): void {
  if (!isCmuxNotifyEnabled()) return;
  cmuxQueue = cmuxQueue
    .catch(() => {})
    .then(
      () =>
        new Promise<void>((resolve) => {
          try {
            const child = spawn("cmux", args, { stdio: "ignore" });
            const done = () => resolve();
            child.once("error", done);
            child.once("exit", done);
          } catch {
            resolve();
          }
        }),
    );
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

// If the assistant response opens with a `[Pre-check]` scaffold block (the
// default opening introduced by nexus-core 0.20.0), skip past it so the
// preview shows the actual body instead of the meta checklist. A blank line
// (`\n\n`) separates the Pre-check block from the body. If the whole text
// is Pre-check with no body, return empty string so the caller falls back.
function stripPreCheck(text: string): string {
  if (!text.trimStart().startsWith(PRE_CHECK_MARKER)) return text;
  const idx = text.indexOf("\n\n");
  if (idx < 0) return "";
  return text.slice(idx + 2);
}

// Collapse whitespace (including newlines that a notification center would
// render as spaces anyway), trim, and truncate to PREVIEW_MAX_LEN characters
// with a trailing ellipsis. Returns empty string only when the input itself
// was whitespace-only; callers decide on a fallback.
function truncateForNotification(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";
  if (collapsed.length <= PREVIEW_MAX_LEN) return collapsed;
  return `${collapsed.slice(0, PREVIEW_MAX_LEN)}…`;
}

// Opt-out flag. Preview is on by default. Users who prefer the old fixed
// "Response ready" body (e.g. because responses may contain sensitive text
// shown in the OS notification center) can set OPENCODE_NEXUS_NOTIFY_PREVIEW
// to "0" or "false" in their shell environment.
function shouldPreviewResponse(): boolean {
  const flag = process.env.OPENCODE_NEXUS_NOTIFY_PREVIEW;
  if (flag === "0" || flag === "false") return false;
  return true;
}

// Temporary (v0.16.1) opt-in diagnostic for the preview cache path. When
// enabled the plugin logs each `message.part.updated` event to cmux so users
// hitting the fallback "Response ready" body can share the payload shape
// (part.type, part.sessionID, whether the session is tracked as root, and
// text length) without us having to raise OpenCode's log level. Off by
// default to avoid flooding the cmux log. Set OPENCODE_NEXUS_DEBUG_PREVIEW
// to "1" or "true" before launching OpenCode to activate. This will be
// revisited or removed once v0.16.2 identifies and fixes the caching path.
function isPreviewDebugEnabled(): boolean {
  const flag = process.env.OPENCODE_NEXUS_DEBUG_PREVIEW;
  return flag === "1" || flag === "true";
}

function buildResponseReadyBody(lastText: string | undefined): string {
  if (!shouldPreviewResponse()) return RESPONSE_READY_FALLBACK;
  if (!lastText) return RESPONSE_READY_FALLBACK;
  const afterPrecheck = stripPreCheck(lastText);
  const preview = truncateForNotification(afterPrecheck);
  return preview.length > 0 ? preview : RESPONSE_READY_FALLBACK;
}

export const OpencodeNexus: Plugin = async ({ directory }) => {
  // Track root sessions so we only forward `session.idle` to cmux for the
  // top-level session. Subagent sessions also emit `session.idle` whenever
  // they finish a turn, and notifying on each of those would be spam.
  const rootSessions = new Set<string>();
  // Holds the most recently observed assistant text part per root session.
  // Updated on every `message.part.updated` with a text part, reset at each
  // new turn (session.status busy) so stale text from a prior turn never
  // leaks into the next notification. Read and cleared on `session.idle`.
  const rootSessionLastText = new Map<string, string>();

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
        rootSessionLastText.delete(event.properties.info.id);
        if (wasRoot) {
          cmuxClearStatus(PILL_KEY);
        }
        return;
      }
      if (event.type === "session.idle" && rootSessions.has(event.properties.sessionID)) {
        const lastText = rootSessionLastText.get(event.properties.sessionID);
        const body = buildResponseReadyBody(lastText);
        cmuxNotify("opencode-nexus", body);
        // Response is complete: it's the user's turn. We set the pill to
        // "Needs Input" (the same value used for question/permission prompts)
        // so the sidebar retains a visible indicator that the agent is
        // waiting for the user. A subsequent session.status busy will
        // overwrite this back to "Running".
        cmuxSetStatus(PILL_KEY, NEEDS_INPUT_VALUE, NEEDS_INPUT_ICON, PILL_COLOR);
        rootSessionLastText.delete(event.properties.sessionID);
        return;
      }
      if (event.type === "session.status" && rootSessions.has(event.properties.sessionID)) {
        const status = event.properties.status;
        if (status.type === "busy") {
          // New turn starting — drop any cached text so the next idle notify
          // never shows the previous turn's preview as a fallback.
          rootSessionLastText.delete(event.properties.sessionID);
          cmuxSetStatus(PILL_KEY, RUNNING_VALUE, RUNNING_ICON, PILL_COLOR);
        } else if (status.type === "retry") {
          cmuxLog("warning", LOG_SOURCE, `Retrying (attempt ${status.attempt}): ${status.message}`);
        } else if (status.type === "idle") {
          // Backs up session.idle for paths where OpenCode emits only the
          // session.status idle variant without the separate session.idle
          // event. Same user-turn semantic as session.idle: switch pill to
          // Needs Input so the sidebar indicates the agent is waiting.
          cmuxSetStatus(PILL_KEY, NEEDS_INPUT_VALUE, NEEDS_INPUT_ICON, PILL_COLOR);
        }
        return;
      }
      if (event.type === "message.part.updated") {
        // Cache the latest text part seen for each root session so that the
        // next session.idle notification can preview the response. The first
        // text part in a turn is the user input; later text parts from the
        // assistant overwrite it via Map.set, so by the time session.idle
        // fires we are holding the assistant's latest text. Subagents and
        // non-root sessions are ignored (no cache slot).
        const part = event.properties.part;
        // v0.16.1 temporary diagnostic: when users hit the "Response ready"
        // fallback even though their response text appeared on screen, we
        // need the per-event (type, sessionID, rootKnown, textLen) shape to
        // pick between part-type / sessionID / payload hypotheses. Gated by
        // an opt-in env so default runs stay quiet.
        if (isPreviewDebugEnabled()) {
          const partSessionID = (part as { sessionID?: unknown }).sessionID;
          const partText = (part as { text?: unknown }).text;
          const textLen = typeof partText === "string" ? String(partText.length) : "NA";
          cmuxLog(
            "info",
            LOG_SOURCE,
            `preview-debug: part.type=${part.type} sessionID=${String(partSessionID)} rootKnown=${rootSessions.has(String(partSessionID))} textLen=${textLen}`,
          );
        }
        if (part.type !== "text") return;
        if (!rootSessions.has(part.sessionID)) return;
        if (typeof part.text === "string" && part.text.length > 0) {
          rootSessionLastText.set(part.sessionID, part.text);
        }
        return;
      }
      if (event.type === "session.error") {
        const sessionID = event.properties.sessionID;
        if (sessionID && !rootSessions.has(sessionID)) return;

        const summary = extractErrorSummary(event.properties.error);
        cmuxLog("error", LOG_SOURCE, summary);
        cmuxNotify("opencode-nexus", "Session error");
        // Clear the pill so a prior Running state does not linger after an
        // abort (e.g. MessageAbortedError) or any other fatal error where
        // session.idle may never fire.
        cmuxClearStatus(PILL_KEY);
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
