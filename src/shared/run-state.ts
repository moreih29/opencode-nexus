import { readJsonFile, writeJsonFile } from "./json-store.js";
import { fileExists } from "./state.js";
import { RunStateSchema, type RunPhase, type RunState } from "./schema.js";

const TRANSITIONS: Record<RunPhase, RunPhase[]> = {
  intake: ["design", "execute"],
  design: ["execute", "verify"],
  execute: ["verify"],
  verify: ["execute", "design", "complete"],
  complete: ["intake"]
};

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

export async function setRunPhase(runFile: string, phase: RunPhase, reason?: string, force = false): Promise<RunState> {
  const current = await ensureRunState(runFile);
  if (!force && current.phase !== phase) {
    const allowed = TRANSITIONS[current.phase] ?? [];
    if (!allowed.includes(phase)) {
      throw new Error(`Invalid run phase transition: ${current.phase} -> ${phase}`);
    }
  }
  return writeRunState(runFile, phase, reason);
}

export async function ensureRunState(runFile: string): Promise<RunState> {
  const current = await readRunState(runFile);
  if (current) {
    return current;
  }
  return writeRunState(runFile, "intake", "run-state initialized");
}
