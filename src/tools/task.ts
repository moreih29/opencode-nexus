import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { appendHistory } from "../shared/history";
import { createNexusPaths } from "../shared/paths";
import { readJsonFile, writeJsonFile } from "../shared/json-store";
import { setRunPhase, writeRunState } from "../shared/run-state";
import { fileExists } from "../shared/state";
import { TasksFileSchema, type TaskItem, type TasksFile } from "../shared/schema";

const z = tool.schema;

export const nxTaskAdd = tool({
  description: "Add a task to active cycle",
  args: {
    title: z.string(),
    owner: z.string().optional(),
    meet_issue: z.string().optional(),
    deps: z.array(z.string()).optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const now = new Date().toISOString();

    const tasksFile = await readJsonFile<TasksFile>(paths.TASKS_FILE, { tasks: [] });
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task: TaskItem = {
      id,
      title: args.title,
      status: "pending",
      owner: args.owner,
      meet_issue: args.meet_issue,
      deps: args.deps,
      created_at: now,
      updated_at: now
    };

    tasksFile.tasks.push(task);
    TasksFileSchema.parse(tasksFile);
    await writeJsonFile(paths.TASKS_FILE, tasksFile);
    await setRunPhase(paths.RUN_FILE, "execute", "task added", true);

    const meetActive = await fileExists(paths.MEET_FILE);
    const linkageNote = meetActive && !args.meet_issue ? " Link this task to its meet issue with meet_issue when possible." : "";

    return `Added task ${id}: ${args.title}${linkageNote}`;
  }
});

export const nxTaskList = tool({
  description: "List tasks and summary",
  args: {
    include_completed: z.boolean().default(true)
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.TASKS_FILE))) {
      return "No active tasks.";
    }

    const tasksFile = TasksFileSchema.parse(await readJsonFile<TasksFile>(paths.TASKS_FILE, { tasks: [] }));
    const tasks = args.include_completed
      ? tasksFile.tasks
      : tasksFile.tasks.filter((task) => task.status !== "completed");

    const totals = {
      total: tasksFile.tasks.length,
      completed: tasksFile.tasks.filter((task) => task.status === "completed").length,
      pending: tasksFile.tasks.filter((task) => task.status === "pending").length,
      in_progress: tasksFile.tasks.filter((task) => task.status === "in_progress").length,
      blocked: tasksFile.tasks.filter((task) => task.status === "blocked").length
    };

    return JSON.stringify({ summary: totals, tasks }, null, 2);
  }
});

export const nxTaskUpdate = tool({
  description: "Update task status",
  args: {
    id: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "blocked"]),
    note: z.string().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const tasksFile = TasksFileSchema.parse(await readJsonFile<TasksFile>(paths.TASKS_FILE, { tasks: [] }));
    const tracker = await readTracker(paths.REOPEN_TRACKER_FILE);
    const task = tasksFile.tasks.find((item) => item.id === args.id);

    if (!task) {
      throw new Error(`Task not found: ${args.id}`);
    }

    const previousStatus = task.status;
    task.status = args.status;
    task.updated_at = new Date().toISOString();
    await writeJsonFile(paths.TASKS_FILE, tasksFile);

    if (previousStatus === "completed" && args.status !== "completed") {
      tracker.reopenCount += 1;
    }
    if (previousStatus !== "blocked" && args.status === "blocked") {
      tracker.blockedTransitions += 1;
    }
    await writeJsonFile(paths.REOPEN_TRACKER_FILE, tracker);

    const hasActive = tasksFile.tasks.some((item) => item.status === "pending" || item.status === "in_progress" || item.status === "blocked");
    await setRunPhase(
      paths.RUN_FILE,
      hasActive ? "execute" : "verify",
      hasActive ? "tasks still active" : "all tasks completed",
      false
    );

    return args.note ? `Updated ${args.id} -> ${args.status} (${args.note})` : `Updated ${args.id} -> ${args.status}`;
  }
});

export const nxTaskClose = tool({
  description: "Close task cycle and archive history",
  args: {
    archive: z.boolean().default(true)
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const meet = await readJsonFile<Record<string, unknown> | null>(paths.MEET_FILE, null);
    const tasks = await readJsonFile<TasksFile | null>(paths.TASKS_FILE, null);
    const tracker = await readTracker(paths.REOPEN_TRACKER_FILE);

    if (tasks && tasks.tasks.some((task) => task.status !== "completed")) {
      throw new Error("Cannot close cycle before all tasks are completed.");
    }

    const taskCount = tasks?.tasks.length ?? 0;
    const decisionCount = Array.isArray((meet as { issues?: unknown[] } | null)?.issues)
      ? ((meet as { issues: Array<{ decision?: unknown }> }).issues.filter((issue) => issue.decision).length)
      : 0;

    const memoryHint = {
      taskCount,
      decisionCount,
      hadLoopDetection: tracker.reopenCount > 0 || tracker.blockedTransitions > 0,
      reopenCount: tracker.reopenCount,
      blockedTransitions: tracker.blockedTransitions,
      cycleTopics: [typeof (meet as { topic?: unknown } | null)?.topic === "string" ? (meet as { topic: string }).topic : ""]
        .filter(Boolean)
    };

    if (args.archive && (meet || tasks)) {
      await appendHistory(paths.HISTORY_FILE, {
        completed_at: new Date().toISOString(),
        branch: await readCurrentBranch(context.worktree ?? context.directory),
        meet: meet ?? undefined,
        tasks: tasks ?? undefined,
        memoryHint
      });
    }

    await setRunPhase(paths.RUN_FILE, "complete", "cycle closed", false);

    await safeUnlink(paths.MEET_FILE);
    await safeUnlink(paths.TASKS_FILE);
    await safeUnlink(paths.STOP_WARNED_FILE);
    await safeUnlink(paths.RUN_FILE);
    await writeJsonFile(paths.REOPEN_TRACKER_FILE, { reopenCount: 0, blockedTransitions: 0 });

    await writeMemoryCycleNote(paths.CORE_ROOT, memoryHint);

    return JSON.stringify(
      {
        closed: true,
        memoryHint,
        nextStep: "Run nx_sync to promote this archived cycle into core knowledge."
      },
      null,
      2
    );
  }
});

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // noop
  }
}

async function readCurrentBranch(projectRoot: string): Promise<string> {
  const headPath = path.join(projectRoot, ".git", "HEAD");
  try {
    const head = (await fs.readFile(headPath, "utf8")).trim();
    if (head.startsWith("ref: ")) {
      const ref = head.slice(5);
      const parts = ref.split("/");
      return parts[parts.length - 1] ?? "unknown";
    }
    return "detached";
  } catch {
    return "unknown";
  }
}

async function writeMemoryCycleNote(
  coreRoot: string,
  memoryHint: {
    taskCount: number;
    decisionCount: number;
    hadLoopDetection: boolean;
    reopenCount: number;
    blockedTransitions: number;
    cycleTopics: string[];
  }
): Promise<void> {
  const memoryDir = path.join(coreRoot, "memory");
  await fs.mkdir(memoryDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(memoryDir, `cycle-${stamp}.md`);
  const content = [
    "<!-- tags: memory, cycle -->",
    `# Cycle Memory ${stamp}`,
    "",
    `- taskCount: ${memoryHint.taskCount}`,
    `- decisionCount: ${memoryHint.decisionCount}`,
    `- hadLoopDetection: ${memoryHint.hadLoopDetection}`,
    `- reopenCount: ${memoryHint.reopenCount}`,
    `- blockedTransitions: ${memoryHint.blockedTransitions}`,
    `- cycleTopics: ${memoryHint.cycleTopics.join(", ") || "none"}`,
    ""
  ].join("\n");
  await fs.writeFile(filePath, content, "utf8");
}

async function readTracker(filePath: string): Promise<{ reopenCount: number; blockedTransitions: number }> {
  const tracker = await readJsonFile<{ reopenCount?: number; blockedTransitions?: number }>(filePath, {
    reopenCount: 0,
    blockedTransitions: 0
  });
  return {
    reopenCount: Number(tracker.reopenCount ?? 0),
    blockedTransitions: Number(tracker.blockedTransitions ?? 0)
  };
}
