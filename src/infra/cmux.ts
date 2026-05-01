import { spawn } from "node:child_process";

export const PILL_KEY = "nexus-state";
export const PILL_COLOR = "#007AFF";
export const RUNNING_ICON = "bolt";
export const RUNNING_VALUE = "Running";
export const NEEDS_INPUT_ICON = "bell.fill";
export const NEEDS_INPUT_VALUE = "Needs Input";
export const LOG_SOURCE = "nexus";
export const RESPONSE_READY_FALLBACK = "Response ready";
const PREVIEW_MAX_LEN = 100;
const PRE_CHECK_MARKER = "[Pre-check]";

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

export function extractErrorSummary(err: unknown): string {
  if (typeof err !== "object" || err === null) return "unknown";
  const record = err as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.length > 0) return record.message;
  if (typeof record.name === "string" && record.name.length > 0) return record.name;
  if (typeof record.type === "string" && record.type.length > 0) return record.type;
  if (typeof record.code === "string" && record.code.length > 0) return record.code;
  return "unknown";
}

export function isAbortError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const record = err as { name?: unknown; message?: unknown };
  if (record.name === "MessageAbortedError") return true;
  if (typeof record.message === "string" && /aborted/i.test(record.message)) return true;
  return false;
}

// Temporary (v0.16.1) opt-in diagnostic for the preview cache path. When
// enabled the plugin logs each `message.part.updated` event to cmux so users
// hitting the fallback "Response ready" body can share the payload shape
// (part.type, part.sessionID, whether the session is tracked as root, and
// text length) without us having to raise OpenCode's log level. Off by
// default to avoid flooding the cmux log. Set OPENCODE_NEXUS_DEBUG_PREVIEW
// to "1" or "true" before launching OpenCode to activate. This will be
// revisited or removed once v0.16.2 identifies and fixes the caching path.
export function isPreviewDebugEnabled(): boolean {
  const flag = process.env.OPENCODE_NEXUS_DEBUG_PREVIEW;
  return flag === "1" || flag === "true";
}

export interface CmuxApi {
  cmuxNotify(title: string, body: string): void;
  cmuxSetStatus(key: string, value: string, icon: string, color: string): void;
  cmuxClearStatus(key: string): void;
  cmuxClearLog(): void;
  cmuxLog(level: "info" | "error" | "warning" | "progress" | "success", source: string, message: string): void;
  extractErrorSummary(err: unknown): string;
  isAbortError(err: unknown): boolean;
  buildResponseReadyBody(lastText: string | undefined): string;
  isPreviewDebugEnabled(): boolean;
  PILL_KEY: string;
  PILL_COLOR: string;
  RUNNING_ICON: string;
  RUNNING_VALUE: string;
  NEEDS_INPUT_ICON: string;
  NEEDS_INPUT_VALUE: string;
  LOG_SOURCE: string;
  RESPONSE_READY_FALLBACK: string;
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

export function createCmuxClient(): CmuxApi {
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

  function cmuxClearLog(): void {
    cmuxSpawn(["clear-log"]);
  }

  function cmuxLog(level: "info" | "error" | "warning" | "progress" | "success", source: string, message: string): void {
    cmuxSpawn(["log", "--level", level, "--source", source, "--", message]);
  }

  function buildResponseReadyBody(lastText: string | undefined): string {
    if (!shouldPreviewResponse()) return RESPONSE_READY_FALLBACK;
    if (!lastText) return RESPONSE_READY_FALLBACK;
    const afterPrecheck = stripPreCheck(lastText);
    const preview = truncateForNotification(afterPrecheck);
    return preview.length > 0 ? preview : RESPONSE_READY_FALLBACK;
  }

  return {
    cmuxNotify,
    cmuxSetStatus,
    cmuxClearStatus,
    cmuxClearLog,
    cmuxLog,
    extractErrorSummary,
    isAbortError,
    buildResponseReadyBody,
    isPreviewDebugEnabled,
    PILL_KEY,
    PILL_COLOR,
    RUNNING_ICON,
    RUNNING_VALUE,
    NEEDS_INPUT_ICON,
    NEEDS_INPUT_VALUE,
    LOG_SOURCE,
    RESPONSE_READY_FALLBACK,
  };
}
