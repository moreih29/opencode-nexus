import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { createNexusPaths } from "../shared/paths";
import { readJsonFile } from "../shared/json-store";
import { readRunState } from "../shared/run-state";
import { fileExists, readTasksSummary } from "../shared/state";

export const nxContext = tool({
  description: "Read current Nexus context summary",
  args: {},
  async execute(_args, context) {
    const root = context.worktree ?? context.directory;
    const paths = createNexusPaths(root);

    const [hasMeet, hasTasks, tasksSummary, branch, runState, meet] = await Promise.all([
      fileExists(paths.MEET_FILE),
      fileExists(paths.TASKS_FILE),
      readTasksSummary(paths.TASKS_FILE),
      readCurrentBranch(root),
      readRunState(paths.RUN_FILE),
      readJsonFile<{ topic?: string; issues?: Array<{ id?: string; title?: string; status?: string }> } | null>(paths.MEET_FILE, null)
    ]);

    const activeMode = hasMeet ? "meet" : hasTasks ? "run" : "idle";
    const currentIssue = meet?.issues?.find((issue) => issue.status === "discussing") ?? meet?.issues?.find((issue) => issue.status === "pending") ?? null;

    return JSON.stringify(
      {
        branch,
        branchGuard: branch === "main" || branch === "master",
        activeMode,
        runPhase: runState?.phase ?? null,
        meetTopic: typeof meet?.topic === "string" ? meet.topic : null,
        currentIssue,
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
