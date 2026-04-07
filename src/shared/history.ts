import { readJsonFile, writeJsonFile } from "./json-store.js";

export interface HistoryCycle {
  completed_at: string;
  branch: string;
  plan?: unknown;
  tasks?: unknown;
  memoryHint?: unknown;
}

interface HistoryFile {
  cycles: HistoryCycle[];
}

export async function appendHistory(historyFile: string, cycle: HistoryCycle): Promise<void> {
  const history = await readJsonFile<HistoryFile>(historyFile, { cycles: [] });
  history.cycles.push(cycle);
  await writeJsonFile(historyFile, history);
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
