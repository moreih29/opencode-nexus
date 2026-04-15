import { promises as fs } from "node:fs";
import { runWithFileLock } from "./json-store.js";

export interface ToolLogEntry {
  ts: string;
  agent_id: string;
  session_id?: string;
  tool: string;
  file: string;
}

export async function appendToolLogEntry(filePath: string, entry: ToolLogEntry): Promise<void> {
  await runWithFileLock(filePath, async () => {
    await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
  });
}

export async function readToolLog(filePath: string): Promise<ToolLogEntry[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as ToolLogEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is ToolLogEntry => entry !== null);
  } catch {
    return [];
  }
}

export async function resetToolLog(filePath: string): Promise<void> {
  await runWithFileLock(filePath, async () => {
    await fs.writeFile(filePath, "", "utf8");
  });
}

export async function aggregateFilesForAgent(filePath: string, agentId: string): Promise<string[]> {
  const entries = await readToolLog(filePath);
  const files = new Set<string>();
  for (const e of entries) {
    if (e.agent_id === agentId && e.file) files.add(e.file);
  }
  return Array.from(files);
}

export async function aggregateFilesForSession(filePath: string, sessionId: string): Promise<string[]> {
  const entries = await readToolLog(filePath);
  const files = new Set<string>();
  for (const entry of entries) {
    if ((entry.session_id === sessionId || entry.agent_id === sessionId) && entry.file) {
      files.add(entry.file);
    }
  }
  return Array.from(files);
}
