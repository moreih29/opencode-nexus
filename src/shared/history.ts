import { readJsonFile, writeJsonFile } from "./json-store";

export interface HistoryCycle {
  completed_at: string;
  branch: string;
  meet?: unknown;
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

export async function nextMeetId(historyFile: string): Promise<number> {
  const history = await readJsonFile<HistoryFile>(historyFile, { cycles: [] });
  let maxId = 0;

  for (const cycle of history.cycles) {
    const meet = cycle.meet as { id?: unknown } | undefined;
    if (typeof meet?.id === "number") {
      maxId = Math.max(maxId, meet.id);
    }
  }

  return maxId + 1;
}
