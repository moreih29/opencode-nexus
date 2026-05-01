import type { CmuxApi } from "../infra/cmux.js";
import {
  NEXUS_AGENTS,
  TAG_INSTRUCTIONS,
  ensureNexusStructure,
  extractLeadingTag,
  stripLeadingTag,
  toAgentConfig,
  mergeAgentConfig,
} from "../infra/nexus.js";

export interface BgTaskState {
  isBgSession(sessionID: string): boolean;
  onIdle(sessionID: string): Promise<void>;
  onError(sessionID: string, error: unknown): void;
  removeBySessionId(sessionID: string): void;
}

export interface HookDeps {
  directory: string;
  cmux: CmuxApi;
  bgState?: BgTaskState;
}

export function createHooks(deps: HookDeps) {
  const { directory, cmux, bgState } = deps;
  const {
    cmuxNotify, cmuxSetStatus, cmuxClearStatus, cmuxClearLog, cmuxLog,
    extractErrorSummary, isAbortError, buildResponseReadyBody,
    isPreviewDebugEnabled,
  } = cmux;
  const {
    PILL_KEY, PILL_COLOR, RUNNING_ICON, RUNNING_VALUE,
    NEEDS_INPUT_ICON, NEEDS_INPUT_VALUE, LOG_SOURCE,
  } = cmux;

  const rootSessions = new Set<string>();
  const rootSessionLastText = new Map<string, string>();
  const assistantTurnActive = new Map<string, boolean>();
  const sessionRunning = new Set<string>();

  return {
    config: async (config: any) => {
      config.agent ??= {};

      for (const [id, agent] of Object.entries(NEXUS_AGENTS)) {
        const generated = toAgentConfig(agent);
        const existing = typeof config.agent[id] === "object" && config.agent[id] !== null ? config.agent[id] : {};
        config.agent[id] = mergeAgentConfig(generated, existing as Record<string, unknown>);
      }

      if (typeof config.default_agent !== "string" || config.default_agent.length === 0) {
        config.default_agent = "lead";
      }
    },

    event: async ({ event }: { event: { type: string; properties: Record<string, unknown> } }) => {
      if (event.type === "session.created") {
        const info = event.properties.info as { id?: string; parentID?: string };
        if (!info.parentID && typeof info.id === "string") {
          rootSessions.add(info.id);
          ensureNexusStructure(directory);
        }
        return;
      }

      if (event.type === "session.deleted") {
        const info = event.properties.info as { id?: string };
        const sid = typeof info.id === "string" ? info.id : "";
        // bg session cleanup first
        if (sid && bgState?.isBgSession(sid)) {
          bgState.removeBySessionId(sid);
        }
        // root session cleanup
        const wasRoot = rootSessions.has(sid);
        rootSessions.delete(sid);
        sessionRunning.delete(sid);
        rootSessionLastText.delete(sid);
        assistantTurnActive.delete(sid);
        if (wasRoot) {
          cmuxClearStatus(PILL_KEY);
        }
        return;
      }

      if (event.type === "session.idle") {
        const sid = event.properties.sessionID as string;
        // bg task session — handle and early return
        if (sid && bgState?.isBgSession(sid)) {
          await bgState.onIdle(sid);
          return;
        }
        // root session
        if (sid && rootSessions.has(sid)) {
          const lastText = rootSessionLastText.get(sid);
          const body = buildResponseReadyBody(lastText);
          cmuxNotify("opencode-nexus", body);
          cmuxSetStatus(PILL_KEY, NEEDS_INPUT_VALUE, NEEDS_INPUT_ICON, PILL_COLOR);
          sessionRunning.delete(sid);
          rootSessionLastText.delete(sid);
          assistantTurnActive.delete(sid);
        }
        return;
      }

      if (event.type === "session.status") {
        const sid = event.properties.sessionID as string;
        if (!sid || !rootSessions.has(sid)) return;
        const status = event.properties.status as { type: string; attempt?: number; message?: string };
        if (status.type === "busy") {
          if (!sessionRunning.has(sid)) {
            sessionRunning.add(sid);
            cmuxClearLog();
          }
          cmuxSetStatus(PILL_KEY, RUNNING_VALUE, RUNNING_ICON, PILL_COLOR);
        } else if (status.type === "retry") {
          cmuxLog("warning", LOG_SOURCE, `Retrying (attempt ${status.attempt}): ${status.message}`);
        } else if (status.type === "idle") {
          cmuxSetStatus(PILL_KEY, NEEDS_INPUT_VALUE, NEEDS_INPUT_ICON, PILL_COLOR);
          sessionRunning.delete(sid);
        }
        return;
      }

      if (event.type === "message.part.updated") {
        const part = event.properties.part as { type: string; sessionID?: unknown; text?: unknown };
        if (isPreviewDebugEnabled()) {
          const partSessionID = part.sessionID;
          const partText = part.text;
          const textLen = typeof partText === "string" ? String(partText.length) : "NA";
          cmuxLog(
            "info",
            LOG_SOURCE,
            `preview-debug: part.type=${part.type} sessionID=${String(partSessionID)} rootKnown=${rootSessions.has(String(partSessionID))} textLen=${textLen}`,
          );
        }
        const partSessionID = part.sessionID;
        if (typeof partSessionID !== "string" || !rootSessions.has(partSessionID)) return;
        if (part.type === "step-start") {
          assistantTurnActive.set(partSessionID, true);
          rootSessionLastText.delete(partSessionID);
          return;
        }
        if (part.type === "text" && assistantTurnActive.get(partSessionID) === true) {
          const text = part.text;
          if (typeof text === "string" && text.length > 0) {
            rootSessionLastText.set(partSessionID, text);
          }
        }
        return;
      }

      if (event.type === "session.error") {
        const sid = event.properties.sessionID as string;
        // bg session error
        if (sid && bgState?.isBgSession(sid)) {
          bgState.onError(sid, event.properties.error);
          return;
        }
        // root session error
        if (!sid || !rootSessions.has(sid)) return;
        if (isAbortError(event.properties.error)) {
          cmuxSetStatus(PILL_KEY, NEEDS_INPUT_VALUE, NEEDS_INPUT_ICON, PILL_COLOR);
          if (typeof sid === "string") {
            sessionRunning.delete(sid);
            rootSessionLastText.delete(sid);
            assistantTurnActive.delete(sid);
          }
          return;
        }
        const summary = extractErrorSummary(event.properties.error);
        cmuxLog("error", LOG_SOURCE, summary);
        cmuxNotify("opencode-nexus", "Session error");
        cmuxClearStatus(PILL_KEY);
        if (typeof sid === "string") {
          sessionRunning.delete(sid);
        }
        return;
      }

      if (event.type === "permission.replied") {
        const sid = event.properties.sessionID as string;
        if (sid && rootSessions.has(sid)) {
          cmuxClearStatus(PILL_KEY);
        }
        return;
      }
    },

    "tool.execute.before": async (input: { tool: string }) => {
      if (input.tool === "question") {
        cmuxNotify("opencode-nexus", "Waiting for your input");
        cmuxSetStatus(PILL_KEY, NEEDS_INPUT_VALUE, NEEDS_INPUT_ICON, PILL_COLOR);
      }
    },

    "permission.ask": async () => {
      cmuxNotify("opencode-nexus", "Permission requested");
      cmuxSetStatus(PILL_KEY, NEEDS_INPUT_VALUE, NEEDS_INPUT_ICON, PILL_COLOR);
    },

    "chat.message": async (_input: unknown, output: { parts: Array<{ type: string; text?: string }> }) => {
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
}
