import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileExists } from "./state.js";

const fileMutationQueues = new Map<string, Promise<void>>();

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  if (!(await fileExists(filePath))) {
    return fallback;
  }
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tempPath, filePath);
}

export async function updateJsonFileLocked<T>(
  filePath: string,
  fallback: T,
  mutator: (current: T) => T | Promise<T>
): Promise<T> {
  return runWithFileLock(filePath, async () => {
    const current = await readJsonFile(filePath, fallback);
    const next = await mutator(current);
    await writeJsonFile(filePath, next);
    return next;
  });
}

export async function runWithFileLock<T>(filePath: string, action: () => Promise<T>): Promise<T> {
  const previous = fileMutationQueues.get(filePath) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => current);
  fileMutationQueues.set(filePath, next);

  await previous;
  try {
    return await action();
  } finally {
    release();
    next.finally(() => {
      if (fileMutationQueues.get(filePath) === next) {
        fileMutationQueues.delete(filePath);
      }
    });
  }
}
