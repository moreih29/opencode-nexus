import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { readMeetParticipantContinuityFromCore } from "../orchestration/meet-continuity-adapter.js";
import { summarizeCoordinationGroups } from "../shared/agent-tracker.js";
import { readMeetSidecar } from "../shared/meet-sidecar.js";
import { createNexusPaths } from "../shared/paths.js";
import { readJsonFile } from "../shared/json-store.js";
import { fileExists, readTasksSummary } from "../shared/state.js";

export const nxContext = tool({
  description: "Read current Nexus context summary",
  args: {},
  async execute(_args, context) {
    const root = context.worktree ?? context.directory;
    const paths = createNexusPaths(root);

    const [hasMeet, hasTasks, tasksSummary, branch, meet, meetSidecar, coordinationGroups] = await Promise.all([
      fileExists(paths.MEET_FILE),
      fileExists(paths.TASKS_FILE),
      readTasksSummary(paths.TASKS_FILE),
      readCurrentBranch(root),
      readJsonFile<{ topic?: string; issues?: Array<{ id?: string; title?: string; status?: string }> } | null>(paths.MEET_FILE, null),
      readMeetSidecar(paths.MEET_SIDECAR_FILE),
      summarizeCoordinationGroups(paths.AGENT_TRACKER_FILE)
    ]);

    const activeMode = hasMeet ? "meet" : hasTasks ? "run" : "idle";
    const currentIssue = meet?.issues?.find((issue) => issue.status === "discussing") ?? meet?.issues?.find((issue) => issue.status === "pending") ?? null;
    const mergedParticipants = meetSidecar
      ? await Promise.all(
          meetSidecar.panel.participants.map(async (participant) => {
            const coreParticipant = await readMeetParticipantContinuityFromCore(paths.ORCHESTRATION_CORE_FILE, participant.role);

            return {
              role: participant.role,
              task_id: coreParticipant?.task_id ?? null,
              session_id: coreParticipant?.session_id ?? null,
              last_summary: coreParticipant?.last_summary ?? participant.last_summary ?? null
            };
          })
        )
      : [];

    return JSON.stringify(
      {
        branch,
        branchGuard: branch === "main" || branch === "master",
        activeMode,
        meetTopic: typeof meet?.topic === "string" ? meet.topic : null,
        currentIssue,
        handoff: meetSidecar
          ? {
              policy: meetSidecar.handoff.policy,
              canonicalReady: meetSidecar.handoff.canonical_ready,
              panelMembership: {
                roles: meetSidecar.panel.participants.map((item) => item.role)
              },
              resumability: {
                participants: mergedParticipants
                  .filter((item) => item.task_id || item.session_id)
                  .map((item) => ({ role: item.role, task_id: item.task_id ?? null, session_id: item.session_id ?? null }))
              },
              followupSuggestions: mergedParticipants
                .filter((item) => item.task_id || item.session_id || item.last_summary)
                .map((item) => ({
                  role: item.role,
                  reason: item.task_id || item.session_id ? "continuity" : "summary-only"
                }))
            }
          : null,
        coordinationGroups,
        tasksSummary: tasksSummary ?? { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0 }
      },
      null,
      2
    );
  }
});

async function readCurrentBranch(projectRoot: string): Promise<string> {
  try {
    const head = (await fs.readFile(path.join(projectRoot, ".git", "HEAD"), "utf8")).trim();
    if (!head.startsWith("ref: ")) {
      return "detached";
    }
    const ref = head.slice(5);
    return ref.split("/").at(-1) ?? "unknown";
  } catch {
    return "unknown";
  }
}
