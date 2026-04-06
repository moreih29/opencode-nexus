import fs from "node:fs/promises";
import path from "node:path";
import type { NexusPaths } from "./paths.js";

export async function appendSessionAuditLog(
  paths: NexusPaths,
  sessionID: string | null,
  entry: Record<string, unknown>
): Promise<void> {
  const normalizedSessionID = normalizeIdentifier(sessionID ?? "unknown-session");
  const dir = path.join(paths.AUDIT_LOGS_ROOT, "sessions", normalizedSessionID);
  await fs.mkdir(dir, { recursive: true });
  await appendJsonl(path.join(dir, "session.jsonl"), entry);
}

export async function appendSubagentAuditLog(
  paths: NexusPaths,
  sessionID: string | null,
  subagentID: string,
  entry: Record<string, unknown>
): Promise<void> {
  const normalizedSessionID = normalizeIdentifier(sessionID ?? "unknown-session");
  const normalizedSubagentID = normalizeIdentifier(subagentID);
  const dir = path.join(paths.AUDIT_LOGS_ROOT, "sessions", normalizedSessionID, "subagents");
  await fs.mkdir(dir, { recursive: true });
  await appendJsonl(path.join(dir, `${normalizedSubagentID}.jsonl`), entry);
}

export async function appendGlobalAuditLog(paths: NexusPaths, entry: Record<string, unknown>): Promise<void> {
  await fs.mkdir(paths.AUDIT_LOGS_ROOT, { recursive: true });
  await appendJsonl(path.join(paths.AUDIT_LOGS_ROOT, "all.jsonl"), entry);
}

export function toAuditRecord(value: unknown): unknown {
  return sanitizeValue(value, 0);
}

function normalizeIdentifier(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "unknown";
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function appendJsonl(filePath: string, entry: Record<string, unknown>): Promise<void> {
  await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth >= 5) {
    return "[truncated-depth]";
  }

  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.length > 2000 ? `${value.slice(0, 2000)}...[truncated]` : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const entries = Object.entries(source).slice(0, 50);
    return Object.fromEntries(entries.map(([key, nested]) => [key, sanitizeValue(nested, depth + 1)]));
  }

  return String(value);
}
