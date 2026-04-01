import { readJsonFile, writeJsonFile } from "./json-store";
import { fileExists } from "./state";
import { RunStateSchema, type RunPhase, type RunState } from "./schema";

export async function readRunState(runFile: string): Promise<RunState | null> {
  if (!(await fileExists(runFile))) {
    return null;
  }
  const raw = await readJsonFile<unknown>(runFile, null);
  const parsed = RunStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function writeRunState(runFile: string, phase: RunPhase, reason?: string): Promise<RunState> {
  const next: RunState = {
    phase,
    updated_at: new Date().toISOString(),
    reason
  };
  await writeJsonFile(runFile, next);
  return next;
}

export async function ensureRunState(runFile: string): Promise<RunState> {
  const current = await readRunState(runFile);
  if (current) {
    return current;
  }
  return writeRunState(runFile, "intake", "run-state initialized");
}
