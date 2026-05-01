import type { TaskRegistry, TaskEntry } from "./registry.js";

export interface BgTaskState {
  isBgSession(sessionID: string): boolean;
  onIdle(sessionID: string): Promise<void>;
  onError(sessionID: string, error: unknown): void;
  removeBySessionId(sessionID: string): void;
  spawnTask(taskId: string, sessionId: string, parentSessionId: string, agent: string, description: string, prompt: string, timeoutMs?: number): Promise<void>;
  getResult(taskId: string): Promise<{ status: string; result?: string; error?: string }>;
}

function getTimeoutMs(): number {
  const env = process.env.OPENCODE_NEXUS_BG_TIMEOUT_MS;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 10 * 60 * 1000;
}

function summarizeError(err: unknown): string {
  if (typeof err !== "object" || err === null) return "unknown";
  const record = err as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.length > 0) return record.message;
  if (typeof record.name === "string") return record.name;
  return "unknown";
}

export function createBgTaskState(deps: {
  client: any;
  registry: TaskRegistry;
}): BgTaskState {
  const { client, registry } = deps;
  const watchdogs = new Map<string, NodeJS.Timeout>();

  function clearWatchdog(sessionId: string): void {
    const timeout = watchdogs.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      watchdogs.delete(sessionId);
    }
  }

  async function injectTaskCompletion(task: TaskEntry): Promise<void> {
    const remaining = registry.getRunningByParent(task.parentSessionId);
    const noReply = remaining.length > 0;

    let notification: string;
    if (noReply) {
      notification = `<system-reminder>
[BACKGROUND TASK COMPLETED]
**ID:** \`${task.taskId}\`
**Agent:** ${task.agent}
**Description:** ${task.description}

**${remaining.length} task(s) still in progress.**
Do NOT poll — continue productive work.
Use task(task_id="${task.taskId}") to retrieve this result when ready.
</system-reminder>`;
    } else {
      notification = `<system-reminder>
[ALL BACKGROUND TASKS COMPLETE]
- ${task.taskId}: ${task.agent} — ${task.description}

Use task(task_id="${task.taskId}") to retrieve each result.
</system-reminder>`;
    }

    try {
      await client.session.promptAsync({
        path: { id: task.parentSessionId },
        body: { noReply, parts: [{ type: "text", text: notification }] },
      });
    } catch {
      // best-effort notification; swallow failures
    }
  }

  return {
    isBgSession(sessionID: string): boolean {
      return registry.getBySessionId(sessionID) !== undefined;
    },

    async onIdle(sessionID: string): Promise<void> {
      clearWatchdog(sessionID);
      const task = registry.getBySessionId(sessionID);
      if (!task) return;

      try {
        const res = await client.session.messages({ path: { id: sessionID } });
        const messages: Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> }> =
          res.data;
        let result = "";
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].info.role === "assistant") {
            const parts = messages[i].parts;
            for (let j = 0; j < parts.length; j++) {
              const part = parts[j];
              if (part.type === "text" && typeof part.text === "string") {
                result = part.text;
                break;
              }
            }
            if (result) break;
          }
        }
        registry.setIdle(sessionID, result);
        await injectTaskCompletion(task);
      } catch {
        registry.setIdle(sessionID, "");
        await injectTaskCompletion(task).catch(() => {});
      }
    },

    onError(sessionID: string, error: unknown): void {
      clearWatchdog(sessionID);
      registry.setError(sessionID, summarizeError(error));
    },

    removeBySessionId(sessionID: string): void {
      clearWatchdog(sessionID);
      registry.removeBySessionId(sessionID);
    },

    async spawnTask(
      taskId: string,
      sessionId: string,
      parentSessionId: string,
      agent: string,
      description: string,
      prompt: string,
      timeoutMs?: number,
    ): Promise<void> {
      const timeout = setTimeout(async () => {
        try {
          await client.session.abort({ path: { id: sessionId } });
        } catch {
          // abort is best-effort
        }
        registry.setError(sessionId, "timeout");
      }, timeoutMs ?? getTimeoutMs());
      watchdogs.set(sessionId, timeout);

      try {
        await client.session.promptAsync({
          path: { id: sessionId },
          body: { agent, parts: [{ type: "text", text: prompt }] },
        });
      } catch {
        // promptAsync failure is handled via onError by the event system
      }
    },

    async getResult(taskId: string): Promise<{ status: string; result?: string; error?: string }> {
      const entry = registry.getByTaskId(taskId);
      if (!entry) return { status: "unknown" };
      const result: { status: string; result?: string; error?: string } = { status: entry.status };
      if (entry.status === "idle" && entry.result !== undefined) result.result = entry.result;
      if (entry.status === "error" && entry.error !== undefined) result.error = entry.error;
      return result;
    },
  };
}
