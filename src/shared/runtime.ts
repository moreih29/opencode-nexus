import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonFile } from "./json-store.js";
import { HARNESS_ID } from "./paths.js";

export const RUNTIME_SCHEMA_VERSION = "0.5";

interface ExistingRuntime {
  teams_enabled?: boolean;
}

interface RuntimePayload {
  schema_version: string;
  teams_enabled: boolean;
  session_started_at: string;
  harness_id: string;
  harness_version: string;
}

let cachedHarnessVersion: string | null = null;

async function readHarnessVersion(): Promise<string> {
  if (cachedHarnessVersion !== null) {
    return cachedHarnessVersion;
  }
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(here, "..", "..", "package.json");
    const raw = await fs.readFile(pkgPath, "utf8");
    cachedHarnessVersion = (JSON.parse(raw) as { version?: string }).version ?? "unknown";
  } catch {
    cachedHarnessVersion = "unknown";
  }
  return cachedHarnessVersion;
}

export async function writeRuntimeFile(runtimeFile: string): Promise<void> {
  const harnessVersion = await readHarnessVersion();
  const existing = await readJsonFile<ExistingRuntime>(runtimeFile, {});
  const payload: RuntimePayload = {
    schema_version: RUNTIME_SCHEMA_VERSION,
    teams_enabled: existing.teams_enabled ?? true,
    session_started_at: new Date().toISOString(),
    harness_id: HARNESS_ID,
    harness_version: harnessVersion
  };
  await fs.writeFile(runtimeFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
}
