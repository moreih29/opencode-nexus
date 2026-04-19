import path from "node:path";
import os from "node:os";

export type NexusPaths = ReturnType<typeof createNexusPaths>;

export const HARNESS_ID = "opencode-nexus";
export const NEXUS_ISOLATED_CONFIG_FILENAME = "opencode-nexus.jsonc";
export const NEXUS_OPENCODE_GLOBAL_DIR = path.join(os.homedir(), ".config", "opencode");

export function createNexusPaths(projectRoot: string) {
  const NEXUS_ROOT = path.join(projectRoot, ".nexus");
  const CONTEXT_ROOT = path.join(NEXUS_ROOT, "context");
  const MEMORY_ROOT = path.join(NEXUS_ROOT, "memory");
  const RULES_ROOT = path.join(NEXUS_ROOT, "rules");
  const STATE_ROOT = path.join(NEXUS_ROOT, "state");
  const HARNESS_NAMESPACE_ROOT = path.join(STATE_ROOT, HARNESS_ID);

  return {
    PROJECT_ROOT: projectRoot,
    NEXUS_ROOT,
    CONTEXT_ROOT,
    MEMORY_ROOT,
    RULES_ROOT,
    STATE_ROOT,
    HARNESS_NAMESPACE_ROOT,
    HISTORY_FILE: path.join(NEXUS_ROOT, "history.json"),
    PLAN_FILE: path.join(STATE_ROOT, "plan.json"),
    TASKS_FILE: path.join(STATE_ROOT, "tasks.json"),
    AGENT_TRACKER_FILE: path.join(HARNESS_NAMESPACE_ROOT, "agent-tracker.json"),
    TOOL_LOG_FILE: path.join(HARNESS_NAMESPACE_ROOT, "tool-log.jsonl"),
    MEMORY_ACCESS_FILE: path.join(HARNESS_NAMESPACE_ROOT, "memory-access.jsonl"),
    ARTIFACTS_ROOT: path.join(STATE_ROOT, "artifacts")
  };
}

export function isNexusInternalPath(filePath: string, projectRoot: string): boolean {
  const normalized = path.resolve(projectRoot, filePath);

  const allowed = [
    path.join(projectRoot, ".nexus", "state"),
    path.join(projectRoot, "AGENTS.md"),
    path.join(projectRoot, ".opencode")
  ];

  return allowed.some((base) => normalized === base || normalized.startsWith(`${base}${path.sep}`));
}

export function getGlobalIsolatedConfigPath(): string {
  return path.join(NEXUS_OPENCODE_GLOBAL_DIR, NEXUS_ISOLATED_CONFIG_FILENAME);
}

export function getProjectIsolatedConfigPath(projectRoot: string): string {
  return path.join(projectRoot, ".opencode", NEXUS_ISOLATED_CONFIG_FILENAME);
}
