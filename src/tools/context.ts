import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { createNexusPaths } from "../shared/paths";
import { readRunState } from "../shared/run-state";
import { fileExists, readTasksSummary } from "../shared/state";

export const nxContext = tool({
  description: "Read current Nexus context summary",
  args: {},
  async execute(_args, context) {
    const root = context.worktree ?? context.directory;
    const paths = createNexusPaths(root);

    const [hasMeet, hasTasks, tasksSummary, branch, runState] = await Promise.all([
      fileExists(paths.MEET_FILE),
      fileExists(paths.TASKS_FILE),
      readTasksSummary(paths.TASKS_FILE),
      readCurrentBranch(root),
      readRunState(paths.RUN_FILE)
    ]);

    const activeMode = hasMeet ? "meet" : hasTasks ? "run" : "idle";

    return JSON.stringify(
      {
        branch,
        activeMode,
        runPhase: runState?.phase ?? null,
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
