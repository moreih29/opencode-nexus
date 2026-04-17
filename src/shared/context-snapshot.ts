import fs from "node:fs/promises";
import path from "node:path";
import { isInvocationActive, readAgentTracker } from "./agent-tracker.js";
import { collectKnowledgeIndex } from "./knowledge-index.js";
import type { NexusPaths } from "./paths.js";
import { TasksFileSchema } from "./schema.js";
import { fileExists } from "./state.js";

const PLAN_LIMIT = 20;
const TASK_LIMIT = 30;
const READY_TASK_LIMIT = 30;
const KNOWLEDGE_LIMIT = 50;
const ACTIVE_AGENT_LIMIT = 30;

type SnapshotMode = "plan" | "run" | "idle";

export async function buildCompactionStateSnapshot(paths: NexusPaths): Promise<string> {
  const mode = await resolveMode(paths);
  const [planLine, tasksLine, knowledgeLine, activeAgentsLine] = await Promise.all([
    buildPlanLine(paths),
    buildTasksLine(paths),
    buildKnowledgeLine(paths),
    buildActiveAgentsLine(paths)
  ]);

  return [
    "[nexus-state-snapshot]",
    `active mode: ${mode}`,
    planLine,
    tasksLine,
    knowledgeLine,
    activeAgentsLine
  ].join("\n");
}

async function resolveMode(paths: NexusPaths): Promise<SnapshotMode> {
  const [hasPlan, hasTasks] = await Promise.all([fileExists(paths.PLAN_FILE), fileExists(paths.TASKS_FILE)]);
  if (hasPlan) {
    return "plan";
  }
  if (hasTasks) {
    return "run";
  }
  return "idle";
}

async function buildPlanLine(paths: NexusPaths): Promise<string> {
  if (!(await fileExists(paths.PLAN_FILE))) {
    return "plan: none";
  }

  try {
    const raw = JSON.parse(await fs.readFile(paths.PLAN_FILE, "utf8")) as {
      topic?: unknown;
      issues?: Array<{ id?: unknown; title?: unknown; status?: unknown }>;
    };

    const topic = typeof raw.topic === "string" ? raw.topic : "unknown";
    const issues = Array.isArray(raw.issues) ? raw.issues : [];
    const issueItems = issues.map((issue) => {
      const id = typeof issue.id === "number" ? issue.id : "?";
      const title = typeof issue.title === "string" ? issue.title : "untitled";
      const status = normalizeIssueStatus(issue.status);
      return `#${id} "${title}" [${status}]`;
    });
    return `plan: "${topic}" — issues: ${formatBoundedList(issueItems, PLAN_LIMIT)}`;
  } catch {
    return 'plan: "unknown" — issues: unavailable';
  }
}

async function buildTasksLine(paths: NexusPaths): Promise<string> {
  if (!(await fileExists(paths.TASKS_FILE))) {
    return "tasks: none | ready tasks: none";
  }

  try {
    const raw = JSON.parse(await fs.readFile(paths.TASKS_FILE, "utf8"));
    const parsed = TasksFileSchema.safeParse(raw);
    if (!parsed.success) {
      return "tasks: unavailable | ready tasks: unavailable";
    }

    const tasks = parsed.data.tasks;
    const taskItems = tasks.map((task) => `#${task.id} "${task.title}" [${task.status}]`);
    const ready = buildReadyTaskIDs(tasks);
    const readyItems = ready.map((taskID) => `#${taskID}`);

    return `tasks: ${formatBoundedList(taskItems, TASK_LIMIT)} | ready tasks: ${formatBoundedList(readyItems, READY_TASK_LIMIT)}`;
  } catch {
    return "tasks: unavailable | ready tasks: unavailable";
  }
}

async function buildKnowledgeLine(paths: NexusPaths): Promise<string> {
  const index = await collectKnowledgeIndex(paths);
  const context = formatBracketedList(index.context.map((file) => path.basename(file)), KNOWLEDGE_LIMIT);
  const memory = formatBracketedList(index.memory.map((file) => path.basename(file)), KNOWLEDGE_LIMIT);
  const rules = formatBracketedList(index.rules.map((file) => path.basename(file)), KNOWLEDGE_LIMIT);
  return `knowledge_index: context=${context}, memory=${memory}, rules=${rules}`;
}

async function buildActiveAgentsLine(paths: NexusPaths): Promise<string> {
  try {
    const tracker = await readAgentTracker(paths.AGENT_TRACKER_FILE);
    const agents = tracker.invocations
      .filter((invocation) => isInvocationActive(invocation.status))
      .map((invocation) => {
        const label = invocation.coordination_label?.trim();
        if (label) {
          return `${invocation.agent_type}[@${label}]`;
        }
        return invocation.agent_type;
      });
    return `active agents: ${formatBoundedList(agents, ACTIVE_AGENT_LIMIT)}`;
  } catch {
    return "active agents: unavailable";
  }
}

function buildReadyTaskIDs(tasks: Array<{ id: number; status: string; deps?: number[] }>): number[] {
  const statusByID = new Map<number, string>();
  for (const task of tasks) {
    statusByID.set(task.id, task.status);
  }

  const ready: number[] = [];
  for (const task of tasks) {
    if (task.status !== "pending") {
      continue;
    }
    const deps = Array.isArray(task.deps) ? task.deps : [];
    const allDepsCompleted = deps.every((dep) => statusByID.get(dep) === "completed");
    if (allDepsCompleted) {
      ready.push(task.id);
    }
  }

  return ready;
}

function normalizeIssueStatus(status: unknown): "pending" | "decided" | "tasked" {
  if (status === "decided") {
    return "decided";
  }
  if (status === "tasked") {
    return "tasked";
  }
  return "pending";
}

function formatBoundedList(items: string[], limit: number): string {
  if (items.length === 0) {
    return "none";
  }
  if (items.length <= limit) {
    return items.join(", ");
  }

  const visible = items.slice(0, limit).join(", ");
  const remaining = items.length - limit;
  return `${visible} (+${remaining} more)`;
}

function formatBracketedList(items: string[], limit: number): string {
  if (items.length === 0) {
    return "[]";
  }

  if (items.length <= limit) {
    return `[${items.join(", ")}]`;
  }

  const visible = items.slice(0, limit).join(", ");
  const remaining = items.length - limit;
  return `[${visible} (+${remaining} more)]`;
}
