export type PipelineTaskStatus = "pending" | "in_progress" | "blocked" | "completed" | string;

export interface PipelineTaskLike {
  id?: string;
  status?: PipelineTaskStatus;
}

export interface PipelineTaskSummaryLike {
  total?: number;
  pending?: number;
  in_progress?: number;
  blocked?: number;
  completed?: number;
}

export interface PipelineSnapshot {
  mode?: string | null;
  hasMeet?: boolean;
  hasTasks?: boolean;
  hasTasksFile?: boolean;
  hasTaskCycle?: boolean;
  tasks?: PipelineTaskLike[];
  taskSummary?: PipelineTaskSummaryLike;
  qaTriggerReasons?: string[];
  shouldTriggerQa?: boolean;
  qa?: {
    shouldSpawn?: boolean;
    reasons?: string[];
  };
}

export type PipelineTaskCycleState = "none" | "empty" | "active" | "completed-open";

export interface PipelineEvaluation {
  taskCycleState: PipelineTaskCycleState;
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

interface NormalizedSummary {
  total: number;
  pending: number;
  inProgress: number;
  blocked: number;
  completed: number;
}

export function evaluatePipelineSnapshot(snapshot: PipelineSnapshot): PipelineEvaluation {
  const hasTaskCycle = inferHasTaskCycle(snapshot);
  const summary = normalizeSummary(snapshot);

  const taskCycleState = resolveTaskCycleState(hasTaskCycle, summary);
  const editsAllowed = taskCycleState === "empty" || taskCycleState === "active";
  const canCloseCycle = taskCycleState === "completed-open";
  const shouldTriggerQa = canCloseCycle && inferQaSignal(snapshot);
  const nextGuidanceKey = resolveNextGuidance(taskCycleState, summary.blocked > 0, shouldTriggerQa);

  return {
    taskCycleState,
    editsAllowed,
    canCloseCycle,
    shouldTriggerQa,
    nextGuidanceKey
  };
}

function inferHasTaskCycle(snapshot: PipelineSnapshot): boolean {
  if (typeof snapshot.hasTaskCycle === "boolean") {
    return snapshot.hasTaskCycle;
  }
  if (typeof snapshot.hasTasksFile === "boolean") {
    return snapshot.hasTasksFile;
  }
  if (typeof snapshot.hasTasks === "boolean") {
    return snapshot.hasTasks;
  }
  if (snapshot.taskSummary) {
    return true;
  }
  return Array.isArray(snapshot.tasks);
}

function normalizeSummary(snapshot: PipelineSnapshot): NormalizedSummary {
  const fromSummary = snapshot.taskSummary;
  if (fromSummary) {
    return {
      total: normalizeCount(fromSummary.total),
      pending: normalizeCount(fromSummary.pending),
      inProgress: normalizeCount(fromSummary.in_progress),
      blocked: normalizeCount(fromSummary.blocked),
      completed: normalizeCount(fromSummary.completed)
    };
  }

  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
  const summary: NormalizedSummary = {
    total: tasks.length,
    pending: 0,
    inProgress: 0,
    blocked: 0,
    completed: 0
  };

  for (const task of tasks) {
    const status = String(task?.status ?? "").trim().toLowerCase();
    if (status === "pending") {
      summary.pending += 1;
      continue;
    }
    if (status === "in_progress") {
      summary.inProgress += 1;
      continue;
    }
    if (status === "blocked") {
      summary.blocked += 1;
      continue;
    }
    if (status === "completed") {
      summary.completed += 1;
      continue;
    }
    summary.pending += 1;
  }

  return summary;
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function resolveTaskCycleState(hasTaskCycle: boolean, summary: NormalizedSummary): PipelineTaskCycleState {
  if (!hasTaskCycle) {
    return "none";
  }
  if (summary.total <= 0) {
    return "empty";
  }
  if (summary.pending > 0 || summary.inProgress > 0 || summary.blocked > 0) {
    return "active";
  }
  if (summary.completed > 0 && summary.completed === summary.total) {
    return "completed-open";
  }
  return "active";
}

function inferQaSignal(snapshot: PipelineSnapshot): boolean {
  if (typeof snapshot.shouldTriggerQa === "boolean") {
    return snapshot.shouldTriggerQa;
  }
  if (Array.isArray(snapshot.qaTriggerReasons) && snapshot.qaTriggerReasons.length > 0) {
    return true;
  }
  if (snapshot.qa?.shouldSpawn === true) {
    return true;
  }
  return Array.isArray(snapshot.qa?.reasons) && snapshot.qa.reasons.length > 0;
}

function resolveNextGuidance(
  state: PipelineTaskCycleState,
  hasBlockedTasks: boolean,
  shouldTriggerQa: boolean
): PipelineEvaluation["nextGuidanceKey"] {
  if (state === "none") {
    return "task_cycle_required";
  }
  if (state === "empty") {
    return "add_first_task";
  }
  if (state === "active") {
    return hasBlockedTasks ? "resolve_blocked_tasks" : "resume_active_cycle";
  }
  return shouldTriggerQa ? "spawn_qa_then_close" : "close_cycle";
}
