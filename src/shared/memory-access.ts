import fs from "node:fs/promises";
import path from "node:path";
import { runWithFileLock } from "./json-store.js";
import { MemoryAccessRecordSchema, type MemoryAccessRecord } from "./schema.js";

const MEMORY_ACCESS_SCHEMA_VERSION = "1.0";

export interface UpsertMemoryAccessArgs {
  filePath: string;
  agentID: string;
  now?: string;
}

export async function upsertMemoryAccessRecord(memoryAccessFile: string, args: UpsertMemoryAccessArgs): Promise<void> {
  await runWithFileLock(memoryAccessFile, async () => {
    const records = await readMemoryAccessRecordsUnlocked(memoryAccessFile);
    const timestamp = args.now ?? new Date().toISOString();

    const existing = records.get(args.filePath);
    const next: MemoryAccessRecord = MemoryAccessRecordSchema.parse({
      path: args.filePath,
      last_accessed_ts: timestamp,
      access_count: (existing?.access_count ?? 0) + 1,
      last_agent: args.agentID,
      schema_version: MEMORY_ACCESS_SCHEMA_VERSION
    });

    records.set(args.filePath, next);
    await writeMemoryAccessRecordsUnlocked(memoryAccessFile, records);
  });
}

export async function readMemoryAccessRecords(memoryAccessFile: string): Promise<Map<string, MemoryAccessRecord>> {
  return runWithFileLock(memoryAccessFile, async () => readMemoryAccessRecordsUnlocked(memoryAccessFile));
}

export async function pruneMemoryAccessRecords(memoryAccessFile: string, deletedPaths: string[]): Promise<number> {
  if (deletedPaths.length === 0) {
    return 0;
  }

  return runWithFileLock(memoryAccessFile, async () => {
    const records = await readMemoryAccessRecordsUnlocked(memoryAccessFile);
    let pruned = 0;
    for (const deletedPath of deletedPaths) {
      if (records.delete(deletedPath)) {
        pruned += 1;
      }
    }

    if (pruned > 0) {
      await writeMemoryAccessRecordsUnlocked(memoryAccessFile, records);
    }

    return pruned;
  });
}

async function readMemoryAccessRecordsUnlocked(memoryAccessFile: string): Promise<Map<string, MemoryAccessRecord>> {
  let raw = "";
  try {
    raw = await fs.readFile(memoryAccessFile, "utf8");
  } catch {
    return new Map();
  }

  const records = new Map<string, MemoryAccessRecord>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    try {
      const parsed = MemoryAccessRecordSchema.parse(JSON.parse(line));
      records.set(parsed.path, parsed);
    } catch {
      // Skip malformed lines to avoid blocking new writes.
    }
  }

  return records;
}

async function writeMemoryAccessRecordsUnlocked(
  memoryAccessFile: string,
  records: Map<string, MemoryAccessRecord>
): Promise<void> {
  await fs.mkdir(path.dirname(memoryAccessFile), { recursive: true });
  const lines = Array.from(records.values()).map((record) => JSON.stringify(record));
  const nextRaw = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  await fs.writeFile(memoryAccessFile, nextRaw, "utf8");
}
