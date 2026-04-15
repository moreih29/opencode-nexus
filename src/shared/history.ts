import { readJsonFile, updateJsonFileLocked } from "./json-store.js";

export const HISTORY_SCHEMA_VERSION = "0.5";

export interface HistoryCycle {
  schema_version?: string;
  completed_at: string;
  branch: string;
  plan?: unknown;
  tasks?: unknown;
  memoryHint?: unknown;
}

interface HistoryFile {
  schema_version?: string;
  cycles: HistoryCycle[];
}

export async function appendHistory(historyFile: string, cycle: HistoryCycle): Promise<void> {
  await updateJsonFileLocked<HistoryFile>(historyFile, { cycles: [] }, (history) => {
    const cycles = Array.isArray(history.cycles) ? history.cycles : [];
    return {
      ...history,
      schema_version: HISTORY_SCHEMA_VERSION,
      cycles: [...cycles, { schema_version: HISTORY_SCHEMA_VERSION, ...cycle }]
    };
  });
}

export async function nextPlanId(historyFile: string): Promise<number> {
  const history = await readJsonFile<HistoryFile>(historyFile, { cycles: [] });
  let maxId = 0;

  for (const cycle of history.cycles) {
    const plan = cycle.plan as { id?: unknown } | undefined;
    if (typeof plan?.id === "number") {
      maxId = Math.max(maxId, plan.id);
    }
  }

  return maxId + 1;
}
