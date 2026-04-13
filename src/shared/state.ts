import fs from "node:fs/promises";
import path from "node:path";
import { AgentTrackerSchema, TasksFileSchema, type TaskStatus } from "./schema.js";
import type { NexusPaths } from "./paths.js";

export interface TasksSummary {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
}

export async function ensureNexusStructure(paths: NexusPaths): Promise<void> {
  const now = new Date().toISOString();

  await fs.mkdir(paths.NEXUS_ROOT, { recursive: true });
  await fs.mkdir(paths.CONTEXT_ROOT, { recursive: true });
  await fs.mkdir(paths.MEMORY_ROOT, { recursive: true });
  await fs.mkdir(paths.RULES_ROOT, { recursive: true });
  await fs.mkdir(paths.STATE_ROOT, { recursive: true });
  await fs.mkdir(paths.HARNESS_NAMESPACE_ROOT, { recursive: true });
  await fs.mkdir(paths.ARTIFACTS_ROOT, { recursive: true });
  await fs.mkdir(paths.AUDIT_LOGS_ROOT, { recursive: true });

  await ensureFile(paths.CONFIG_FILE, JSON.stringify({ statuslinePreset: "default" }, null, 2) + "\n");
  await ensureFile(paths.HISTORY_FILE, JSON.stringify({ cycles: [] }, null, 2) + "\n");
  await ensureFile(
    paths.ORCHESTRATION_CORE_FILE,
    JSON.stringify({ schema_version: 1, updated_at: now, invocations: [] }, null, 2) + "\n"
  );
  await ensureFile(paths.REOPEN_TRACKER_FILE, JSON.stringify({ reopenCount: 0, blockedTransitions: 0 }, null, 2) + "\n");

  await fs.writeFile(paths.AGENT_TRACKER_FILE, "[]\n", "utf8");
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
    completed: 0,
    blocked: 0
  };

  for (const task of parsed.data.tasks) {
    summary[task.status as TaskStatus] += 1;
  }

  return summary;
}

export async function resetAgentTracker(trackerFile: string): Promise<void> {
  await fs.writeFile(trackerFile, "[]\n", "utf8");
}

export async function validateAgentTracker(trackerFile: string): Promise<void> {
  if (!(await fileExists(trackerFile))) {
    await fs.writeFile(trackerFile, "[]\n", "utf8");
    return;
  }

  const raw = await fs.readFile(trackerFile, "utf8");
  const parsed = AgentTrackerSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    await fs.writeFile(trackerFile, "[]\n", "utf8");
  }
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  if (await fileExists(filePath)) {
    return;
  }
  await fs.writeFile(filePath, content, "utf8");
}
