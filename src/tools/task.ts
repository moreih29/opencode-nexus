import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { appendHistory } from "../shared/history.js";
import { evaluatePipelineSnapshot as evaluatePipelineSnapshotPure } from "../pipeline/evaluator.js";
import { createNexusPaths } from "../shared/paths.js";
import { readJsonFile, writeJsonFile } from "../shared/json-store.js";
import { fileExists } from "../shared/state.js";
import { MeetFileSchema, TasksFileSchema, type MeetFile, type TaskItem, type TasksFile } from "../shared/schema.js";

const z = tool.schema;

interface PipelineEvaluatorSnapshot {
  hasTasksFile: boolean;
  hasTaskCycle: boolean;
  tasks: Array<{ id?: string; status: TaskItem["status"] }>;
  qaTriggerReasons: string[];
}

interface PipelineEvaluatorResult {
  taskCycleState: "none" | "empty" | "active" | "completed-open";
  editsAllowed: boolean;
  canCloseCycle: boolean;
  shouldTriggerQa: boolean;
  nextGuidanceKey:
    | "task_cycle_required"
    | "add_first_task"
    | "resume_active_cycle"
    | "resolve_blocked_tasks"
    | "close_cycle"
    | "spawn_qa_then_close";
}

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
    await syncMeetIssueTaskLink(paths.MEET_FILE, args.meet_issue, id);

    const meetActive = await fileExists(paths.MEET_FILE);
    const linkageNote = meetActive && !args.meet_issue ? " Link this task to its meet issue with meet_issue when possible." : "";

    return JSON.stringify(
      {
        nexus_task_id: id,
        title: args.title,
        status: task.status,
        owner: task.owner ?? null,
        meet_issue: task.meet_issue ?? null,
        message: `Added task ${id}: ${args.title}${linkageNote}`
      },
      null,
      2
    );
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
      if (isOpenCodeSessionID(args.id)) {
        throw new Error(
          `Task not found: ${args.id}. This looks like an OpenCode session id (ses_...). nx_task_update expects a Nexus task id (task-...).`
        );
      }
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

    return JSON.stringify(
      {
        nexus_task_id: args.id,
        status: args.status,
        note: args.note ?? null,
        message: args.note ? `Updated ${args.id} -> ${args.status} (${args.note})` : `Updated ${args.id} -> ${args.status}`
      },
      null,
      2
    );
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

    if (tasks) {
      const evaluation = await evaluatePipelineSnapshot({
        hasTasksFile: true,
        hasTaskCycle: true,
        tasks: tasks.tasks.map((task) => ({ id: task.id, status: task.status })),
        qaTriggerReasons: []
      });

      if (!evaluation.canCloseCycle && evaluation.taskCycleState !== "empty") {
        throw new Error("Cannot close cycle before all tasks are completed.");
      }
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

    await safeUnlink(paths.MEET_FILE);
    await safeUnlink(paths.TASKS_FILE);
    await safeUnlink(paths.STOP_WARNED_FILE);
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

async function syncMeetIssueTaskLink(meetFile: string, issueID: string | undefined, taskID: string): Promise<void> {
  if (!issueID || !(await fileExists(meetFile))) {
    return;
  }

  const meet = MeetFileSchema.parse(await readJsonFile<MeetFile>(meetFile, {} as MeetFile));
  const issue = meet.issues.find((item) => item.id === issueID);
  if (!issue) {
    return;
  }

  issue.task_refs = Array.from(new Set([...(issue.task_refs ?? []), taskID]));
  if (issue.decision) {
    issue.status = "tasked";
  }
  await writeJsonFile(meetFile, meet);
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

function isOpenCodeSessionID(value: string): boolean {
  return value.startsWith("ses_");
}

async function evaluatePipelineSnapshot(snapshot: PipelineEvaluatorSnapshot): Promise<PipelineEvaluatorResult> {
  return evaluatePipelineSnapshotPure(snapshot);
}
