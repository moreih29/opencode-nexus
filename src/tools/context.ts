import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { readPlanParticipantContinuityFromCore } from "../orchestration/plan-continuity-adapter.js";
import { summarizeCoordinationGroups } from "../shared/agent-tracker.js";
import { readPlanSidecar } from "../shared/plan-sidecar.js";
import { createNexusPaths } from "../shared/paths.js";
import { readJsonFile } from "../shared/json-store.js";
import { fileExists, readTasksSummary } from "../shared/state.js";

export const nxContext = tool({
  description: "Read current Nexus context summary",
  args: {},
  async execute(_args, context) {
    const root = context.worktree ?? context.directory;
    const paths = createNexusPaths(root);

    const [hasPlan, hasTasks, tasksSummary, branch, plan, planSidecar, coordinationGroups, tasksFile] = await Promise.all([
      fileExists(paths.PLAN_FILE),
      fileExists(paths.TASKS_FILE),
      readTasksSummary(paths.TASKS_FILE),
      readCurrentBranch(root),
      readJsonFile<{ topic?: string; issues?: Array<{ id?: number; title?: string; status?: string }> } | null>(paths.PLAN_FILE, null),
      readPlanSidecar(paths.PLAN_SIDECAR_FILE),
      summarizeCoordinationGroups(paths.AGENT_TRACKER_FILE),
      readJsonFile<{ goal?: string; decisions?: string[] } | null>(paths.TASKS_FILE, null)
    ]);

    const activeMode = hasPlan ? "plan" : hasTasks ? "team" : null;
    const goal = typeof tasksFile?.goal === "string" ? tasksFile.goal : null;
    const decisions = Array.isArray(tasksFile?.decisions) ? tasksFile.decisions : [];
    const currentIssue = plan?.issues?.find((issue: { status?: string }) => issue.status === "discussing") ?? plan?.issues?.find((issue: { status?: string }) => issue.status === "pending") ?? null;
    const mergedParticipants = planSidecar
      ? await Promise.all(
          planSidecar.panel.participants.map(async (participant: { role: string; last_summary?: string | null }) => {
            const coreParticipant = await readPlanParticipantContinuityFromCore(paths.ORCHESTRATION_CORE_FILE, participant.role);

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
        goal,
        decisions,
        planTopic: typeof plan?.topic === "string" ? plan.topic : null,
        currentIssue,
        handoff: planSidecar
          ? {
              policy: planSidecar.handoff.policy,
              canonicalReady: planSidecar.handoff.canonical_ready,
              panelMembership: {
                roles: planSidecar.panel.participants.map((item: { role: string }) => item.role)
              },
              resumability: {
                participants: mergedParticipants
                  .filter((item: { task_id: string | null; session_id: string | null }) => item.task_id || item.session_id)
                  .map((item: { role: string; task_id: string | null; session_id: string | null }) => ({ role: item.role, task_id: item.task_id ?? null, session_id: item.session_id ?? null }))
              },
              followupSuggestions: mergedParticipants
                .filter((item: { task_id: string | null; session_id: string | null; last_summary: string | null }) => item.task_id || item.session_id || item.last_summary)
                .map((item: { role: string; task_id: string | null; session_id: string | null }) => ({
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
