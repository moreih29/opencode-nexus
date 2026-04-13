import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { appendHistory } from "../shared/history.js";
import { evaluatePipelineSnapshot as evaluatePipelineSnapshotPure } from "../pipeline/evaluator.js";
import { createNexusPaths } from "../shared/paths.js";
import { readJsonFile, writeJsonFile } from "../shared/json-store.js";
import { fileExists } from "../shared/state.js";
import { PlanFileSchema, TasksFileSchema, type PlanFile, type TaskItem, type TasksFile } from "../shared/schema.js";

const z = tool.schema;

interface PipelineEvaluatorSnapshot {
  hasTasksFile: boolean;
  hasTaskCycle: boolean;
  tasks: Array<{ id?: number; status: TaskItem["status"] }>;
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
    plan_issue: z.number().optional(),
    deps: z.array(z.number()).optional(),
    context: z.string().optional(),
    approach: z.string().optional(),
    acceptance: z.string().optional(),
    risk: z.string().optional(),
    goal: z.string().optional(),
    decisions: z.array(z.string()).optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const now = new Date().toISOString();

    const tasksFile = await readJsonFile<TasksFile>(paths.TASKS_FILE, { tasks: [] });
    const id = (tasksFile.tasks.length > 0 ? Math.max(...tasksFile.tasks.map(t => t.id)) : 0) + 1;
    const task: TaskItem = {
      id,
      title: args.title,
      status: "pending",
      owner: args.owner,
      plan_issue: args.plan_issue,
      deps: args.deps,
      created_at: now,
      updated_at: now,
      context: args.context,
      approach: args.approach,
      acceptance: args.acceptance,
      risk: args.risk
    };

    if (args.goal !== undefined) {
      tasksFile.goal = args.goal;
    }
    if (args.decisions !== undefined) {
      tasksFile.decisions = [...(tasksFile.decisions ?? []), ...args.decisions];
    }

    tasksFile.tasks.push(task);
    TasksFileSchema.parse(tasksFile);
    await writeJsonFile(paths.TASKS_FILE, tasksFile);
    await syncPlanIssueTaskLink(paths.PLAN_FILE, args.plan_issue, id);

    const planActive = await fileExists(paths.PLAN_FILE);
    const linkageNote = planActive && !args.plan_issue ? " Link this task to its plan issue with plan_issue when possible." : "";

    return JSON.stringify(
      {
        task: {
          id,
          title: args.title,
          status: task.status,
          deps: task.deps ?? [],
          plan_issue: task.plan_issue ?? null,
          created_at: task.created_at
        },
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
      return JSON.stringify({ exists: false });
    }

    const tasksFile = TasksFileSchema.parse(await readJsonFile<TasksFile>(paths.TASKS_FILE, { tasks: [] }));
    const includeCompleted = args.include_completed ?? true;
    const tasks = includeCompleted
      ? tasksFile.tasks
      : tasksFile.tasks.filter((task) => task.status !== "completed");

    const totals = {
      total: tasksFile.tasks.length,
      completed: tasksFile.tasks.filter((task) => task.status === "completed").length,
      pending: tasksFile.tasks.filter((task) => task.status === "pending").length,
      in_progress: tasksFile.tasks.filter((task) => task.status === "in_progress").length,
      blocked: tasksFile.tasks.filter((task) => task.status === "blocked").length,
      ready: tasksFile.tasks
        .filter(
          (t) =>
            t.status === "pending" &&
            (t.deps ?? []).every((depId) => tasksFile.tasks.find((d) => d.id === depId)?.status === "completed")
        )
        .map((t) => t.id)
    };

    return JSON.stringify({ goal: tasksFile.goal ?? "", summary: totals, tasks }, null, 2);
  }
});

export const nxTaskUpdate = tool({
  description: "Update task status",
  args: {
    id: z.number(),
    status: z.enum(["pending", "in_progress", "completed", "blocked"]),
    note: z.string().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.TASKS_FILE))) {
      throw new Error("tasks.json not found");
    }
    const tasksFile = TasksFileSchema.parse(await readJsonFile<TasksFile>(paths.TASKS_FILE, { tasks: [] }));
    const tracker = await readTracker(paths.REOPEN_TRACKER_FILE);
    const task = tasksFile.tasks.find((item) => item.id === args.id);

    if (!task) {
      throw new Error(`Task id ${args.id} not found`);
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
        task: { id: args.id, title: task.title, status: args.status },
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
    const plan = await readJsonFile<Record<string, unknown> | null>(paths.PLAN_FILE, null);
    const tasks = await readJsonFile<TasksFile | null>(paths.TASKS_FILE, null);
    const tracker = await readTracker(paths.REOPEN_TRACKER_FILE);

    // Note: conformance contract (nexus-core v0.2.0) specifies task_close always succeeds.
    // Pipeline evaluation is used for advisory guidance only, not as a gate.

    const taskCount = tasks?.tasks.length ?? 0;
    const decisionCount = Array.isArray((plan as { issues?: unknown[] } | null)?.issues)
      ? ((plan as { issues: Array<{ decision?: unknown }> }).issues.filter((issue) => issue.decision).length)
      : 0;

    const memoryHint = {
      taskCount,
      decisionCount,
      hadLoopDetection: tracker.reopenCount > 0 || tracker.blockedTransitions > 0,
      reopenCount: tracker.reopenCount,
      blockedTransitions: tracker.blockedTransitions,
      cycleTopics: [typeof (plan as { topic?: unknown } | null)?.topic === "string" ? (plan as { topic: string }).topic : ""]
        .filter(Boolean)
    };

    const cycleTimestamp = new Date().toISOString();
    const branch = await readCurrentBranch(context.worktree ?? context.directory);
    const shouldArchive = args.archive ?? true;

    if (shouldArchive) {
      await appendHistory(paths.HISTORY_FILE, {
        completed_at: cycleTimestamp,
        branch,
        plan: plan ?? undefined,
        tasks: tasks?.tasks ?? [],
        memoryHint
      });
    }

    const history = await readJsonFile<{ cycles: unknown[] }>(paths.HISTORY_FILE, { cycles: [] });
    const totalCycles = history.cycles.length;

    await safeUnlink(paths.PLAN_FILE);
    await safeUnlink(paths.TASKS_FILE);
    await safeUnlink(paths.STOP_WARNED_FILE);
    await writeJsonFile(paths.REOPEN_TRACKER_FILE, { reopenCount: 0, blockedTransitions: 0 });

    await writeMemoryCycleNote(paths.AUTO_ROOT, memoryHint);

    return JSON.stringify(
      {
        closed: true,
        cycle: cycleTimestamp,
        branch,
        archived: {
          plan: plan !== null,
          decisions: decisionCount,
          tasks: taskCount
        },
        total_cycles: totalCycles,
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

async function syncPlanIssueTaskLink(planFile: string, issueID: number | undefined, taskID: number): Promise<void> {
  if (!issueID || !(await fileExists(planFile))) {
    return;
  }

  const plan = PlanFileSchema.parse(await readJsonFile<PlanFile>(planFile, {} as PlanFile));
  const issue = plan.issues.find((item) => item.id === issueID);
  if (!issue) {
    return;
  }

  issue.task_refs = Array.from(new Set([...(issue.task_refs ?? []), taskID]));
  if (issue.decision) {
    issue.status = "tasked";
  }
  await writeJsonFile(planFile, plan);
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
  autoRoot: string,
  memoryHint: {
    taskCount: number;
    decisionCount: number;
    hadLoopDetection: boolean;
    reopenCount: number;
    blockedTransitions: number;
    cycleTopics: string[];
  }
): Promise<void> {
  await fs.mkdir(autoRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(autoRoot, `cycle-${stamp}.md`);
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
