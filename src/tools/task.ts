import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { NEXUS_PRIMARY_AGENT_ID } from "../agents/primary.js";
import { appendHistory, type HistoryCycle } from "../shared/history.js";
import { evaluatePipelineSnapshot as evaluatePipelineSnapshotPure } from "../pipeline/evaluator.js";
import { createNexusPaths } from "../shared/paths.js";
import { readJsonFile, updateJsonFileLocked } from "../shared/json-store.js";
import { fileExists } from "../shared/state.js";
import { TasksFileSchema, type TaskItem, type TasksFile } from "../shared/schema.js";

const z = tool.schema;
const OWNER_REUSE_POLICY_VALUES = ["fresh", "resume_if_same_artifact", "resume"] as const;

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
    | "close_cycle"
    | "spawn_qa_then_close";
}

export const nxTaskAdd = tool({
  description: "Add a task to active cycle",
  args: {
    title: z.string(),
    owner: z.string().optional(),
    owner_agent_id: z.string().optional(),
    owner_reuse_policy: z.enum(OWNER_REUSE_POLICY_VALUES).optional(),
    plan_issue: z.number().optional(),
    deps: z.array(z.number()).optional(),
    context: z.string(),
    approach: z.string().optional(),
    acceptance: z.string().optional(),
    risk: z.string().optional(),
    goal: z.string().optional(),
    decisions: z.array(z.string()).optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const now = new Date().toISOString();
    let id = 0;

    await updateJsonFileLocked<TasksFile>(paths.TASKS_FILE, { tasks: [] }, (raw) => {
      const tasksFile = TasksFileSchema.parse(raw);
      id = (tasksFile.tasks.length > 0 ? Math.max(...tasksFile.tasks.map((t) => t.id)) : 0) + 1;
      const task: TaskItem = {
        id,
        title: args.title,
        status: "pending",
        owner: args.owner,
        owner_agent_id: args.owner_agent_id,
        owner_reuse_policy: args.owner_reuse_policy,
        plan_issue: args.plan_issue,
        deps: args.deps,
        created_at: now,
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
      return tasksFile;
    });

    const planActive = await fileExists(paths.PLAN_FILE);
    const linkageNote = planActive && !args.plan_issue ? " Link this task to its plan issue with plan_issue when possible." : "";

    return JSON.stringify(
      {
        task: {
          id,
          title: args.title,
          status: "pending",
          owner: args.owner ?? null,
          owner_agent_id: args.owner_agent_id ?? null,
          owner_reuse_policy: args.owner_reuse_policy ?? null,
          deps: args.deps ?? [],
          plan_issue: args.plan_issue ?? null,
          created_at: now
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
    status: z.enum(["pending", "in_progress", "completed"]),
    note: z.string().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.TASKS_FILE))) {
      throw new Error("tasks.json not found");
    }
    let updatedTitle = "";
    await updateJsonFileLocked<TasksFile>(paths.TASKS_FILE, { tasks: [] }, (raw) => {
      const tasksFile = TasksFileSchema.parse(raw);
      const task = tasksFile.tasks.find((item) => item.id === args.id);

      if (!task) {
        throw new Error(`Task id ${args.id} not found`);
      }

      task.status = args.status;
      updatedTitle = task.title;
      return tasksFile;
    });

    return JSON.stringify(
      {
        task: { id: args.id, title: updatedTitle, status: args.status },
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
  args: {},
  async execute(_args, context) {
    const callerAgent = resolveCallerAgentFromToolContext(context);
    if (callerAgent && callerAgent !== NEXUS_PRIMARY_AGENT_ID) {
      throw new Error(`nx_task_close is Nexus-lead only. Caller "${callerAgent}" is not allowed.`);
    }

    const paths = createNexusPaths(context.worktree ?? context.directory);
    const plan = await readJsonFile<Record<string, unknown> | null>(paths.PLAN_FILE, null);
    const tasks = await readJsonFile<TasksFile | null>(paths.TASKS_FILE, null);

    // Note: conformance contract (nexus-core v0.2.0) specifies task_close always succeeds.
    // Pipeline evaluation is used for advisory guidance only, not as a gate.

    const taskCount = tasks?.tasks.length ?? 0;
    const decisionCount = Array.isArray((plan as { issues?: unknown[] } | null)?.issues)
      ? ((plan as { issues: Array<{ decision?: unknown }> }).issues.filter((issue) => issue.decision).length)
      : 0;

    const memoryHint = {
      taskCount,
      decisionCount,
      cycleTopics: [
        typeof (plan as { topic?: unknown } | null)?.topic === "string" ? (plan as { topic: string }).topic : "",
        typeof tasks?.goal === "string" ? tasks.goal : ""
      ]
        .filter(Boolean)
    };

    const cycleTimestamp = new Date().toISOString();
    const branch = await readCurrentBranch(context.worktree ?? context.directory);
    await appendHistory(paths.HISTORY_FILE, {
      completed_at: cycleTimestamp,
      branch,
      plan: plan ?? undefined,
      tasks: tasks?.tasks ?? [],
      memoryHint
    });

    const history = await readJsonFile<{ cycles: unknown[] }>(paths.HISTORY_FILE, { cycles: [] });
    const totalCycles = history.cycles.length;

    const deleted: string[] = [];
    if (await removeFileIfExists(paths.PLAN_FILE)) {
      deleted.push(path.basename(paths.PLAN_FILE));
    }
    if (await removeFileIfExists(paths.TASKS_FILE)) {
      deleted.push(path.basename(paths.TASKS_FILE));
    }

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
        deleted,
        total_cycles: totalCycles,
        memoryHint
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

async function removeFileIfExists(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
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


function isOpenCodeSessionID(value: string): boolean {
  return value.startsWith("ses_");
}

function resolveCallerAgentFromToolContext(context: unknown): string | null {
  if (!context || typeof context !== "object") {
    return null;
  }
  const caller = pickNestedString(context as Record<string, unknown>, ["agent", "agent_id", "agentID", "agentId", "role"]);
  return caller ? caller.toLowerCase() : null;
}

function pickNestedString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  for (const value of Object.values(source)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const nested = pickNestedString(value as Record<string, unknown>, keys);
    if (nested) {
      return nested;
    }
  }

  return null;
}

async function evaluatePipelineSnapshot(snapshot: PipelineEvaluatorSnapshot): Promise<PipelineEvaluatorResult> {
  return evaluatePipelineSnapshotPure(snapshot);
}

interface HistoryFile {
  cycles: HistoryCycle[];
}

export const nxHistorySearch = tool({
  description: "Search past work cycles in history.json by keyword or return recent N cycles",
  args: {
    query: z.string().optional(),
    last_n: z.number().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const history = await readJsonFile<HistoryFile>(paths.HISTORY_FILE, { cycles: [] });
    const allCycles: HistoryCycle[] = Array.isArray(history.cycles) ? history.cycles : [];

    let matched: HistoryCycle[];
    if (args.query !== undefined && args.query !== "") {
      const lower = args.query.toLowerCase();
      matched = allCycles.filter((cycle) => JSON.stringify(cycle).toLowerCase().includes(lower));
    } else {
      matched = allCycles;
    }

    const total = matched.length;
    const sliced = args.last_n !== undefined ? matched.slice(-args.last_n) : matched;
    const showing = sliced.length;

    return JSON.stringify({ total, showing, cycles: sliced }, null, 2);
  }
});
