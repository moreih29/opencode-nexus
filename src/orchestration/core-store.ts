import { readJsonFile, writeJsonFile } from "../shared/json-store.js";
import { OrchestrationCoreStateSchema, type OrchestrationCoreState } from "../shared/schema.js";
import { fileExists } from "../shared/state.js";

export function createEmptyOrchestrationCoreState(now = new Date().toISOString()): OrchestrationCoreState {
  return {
    schema_version: 1,
    updated_at: now,
    invocations: []
  };
}

export async function readOrchestrationCoreState(filePath: string): Promise<OrchestrationCoreState> {
  const fallback = createEmptyOrchestrationCoreState();
  const hasCanonical = await fileExists(filePath);
  if (!hasCanonical) {
    return fallback;
  }
  const raw = await readJsonFile<unknown>(filePath, fallback);
  const parsed = OrchestrationCoreStateSchema.safeParse(raw);
  if (!parsed.success) {
    return fallback;
  }
  return parsed.data;
}

export async function writeOrchestrationCoreState(filePath: string, state: OrchestrationCoreState): Promise<void> {
  await writeJsonFile(filePath, state);
}
