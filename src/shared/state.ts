import fs from "node:fs/promises";
import path from "node:path";
import { AgentTrackerSchema, TasksFileSchema, type TaskStatus } from "./schema.js";
import { HARNESS_ID, type NexusPaths } from "./paths.js";

export interface TasksSummary {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
}

export async function ensureNexusStructure(paths: NexusPaths): Promise<void> {
  await fs.mkdir(paths.NEXUS_ROOT, { recursive: true });
  await fs.mkdir(paths.CONTEXT_ROOT, { recursive: true });
  await fs.mkdir(paths.MEMORY_ROOT, { recursive: true });
  await fs.mkdir(paths.RULES_ROOT, { recursive: true });
  await fs.mkdir(paths.STATE_ROOT, { recursive: true });
  await fs.mkdir(paths.HARNESS_NAMESPACE_ROOT, { recursive: true });
  await fs.mkdir(paths.ARTIFACTS_ROOT, { recursive: true });

  await ensureFile(paths.HISTORY_FILE, JSON.stringify({ cycles: [] }, null, 2) + "\n");
  await ensureFile(paths.AGENT_TRACKER_FILE, JSON.stringify(createInitialAgentTracker(), null, 2) + "\n");
  await ensureFile(paths.TOOL_LOG_FILE, "");
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readTasksSummary(tasksFile: string): Promise<TasksSummary | null> {
  if (!(await fileExists(tasksFile))) {
    return null;
  }

  const raw = await fs.readFile(tasksFile, "utf8");
  const parsed = TasksFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Invalid tasks schema: ${parsed.error.message}`);
  }

  const summary: TasksSummary = {
    total: parsed.data.tasks.length,
    pending: 0,
    in_progress: 0,
    completed: 0
  };

  for (const task of parsed.data.tasks) {
    summary[task.status as TaskStatus] += 1;
  }

  return summary;
}

export async function resetAgentTracker(trackerFile: string): Promise<void> {
  await fs.writeFile(trackerFile, JSON.stringify(createInitialAgentTracker(), null, 2) + "\n", "utf8");
}

export async function resetToolLog(toolLogFile: string): Promise<void> {
  await fs.writeFile(toolLogFile, "", "utf8");
}

export async function validateAgentTracker(trackerFile: string): Promise<void> {
  if (!(await fileExists(trackerFile))) {
    await resetAgentTracker(trackerFile);
    return;
  }

  const raw = await fs.readFile(trackerFile, "utf8");
  const parsed = AgentTrackerSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    await resetAgentTracker(trackerFile);
  }
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  if (await fileExists(filePath)) {
    return;
  }
  await fs.writeFile(filePath, content, "utf8");
}

function createInitialAgentTracker() {
  return {
    harness_id: HARNESS_ID,
    started_at: new Date().toISOString(),
    invocations: []
  };
}
