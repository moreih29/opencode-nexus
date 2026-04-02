import path from "node:path";

export type NexusPaths = ReturnType<typeof createNexusPaths>;

export function createNexusPaths(projectRoot: string) {
  const NEXUS_ROOT = path.join(projectRoot, ".nexus");
  const CORE_ROOT = path.join(NEXUS_ROOT, "core");
  const RULES_ROOT = path.join(NEXUS_ROOT, "rules");
  const STATE_ROOT = path.join(NEXUS_ROOT, "state");

  return {
    PROJECT_ROOT: projectRoot,
    NEXUS_ROOT,
    CORE_ROOT,
    RULES_ROOT,
    STATE_ROOT,
    HISTORY_FILE: path.join(NEXUS_ROOT, "history.json"),
    CONFIG_FILE: path.join(NEXUS_ROOT, "config.json"),
    MEET_FILE: path.join(STATE_ROOT, "meet.json"),
    MEET_SIDECAR_FILE: path.join(STATE_ROOT, "meet.opencode.json"),
    TASKS_FILE: path.join(STATE_ROOT, "tasks.json"),
    RUN_FILE: path.join(STATE_ROOT, "run.json"),
    AGENT_TRACKER_FILE: path.join(STATE_ROOT, "agent-tracker.json"),
    REOPEN_TRACKER_FILE: path.join(STATE_ROOT, "reopen-tracker.json"),
    STOP_WARNED_FILE: path.join(STATE_ROOT, "stop-warned"),
    ARTIFACTS_ROOT: path.join(STATE_ROOT, "artifacts")
  };
}

export function isNexusInternalPath(filePath: string, projectRoot: string): boolean {
  const normalized = path.resolve(projectRoot, filePath);

  const allowed = [
    path.join(projectRoot, ".nexus", "state"),
    path.join(projectRoot, ".nexus", "config.json"),
    path.join(projectRoot, "AGENTS.md"),
    path.join(projectRoot, ".opencode")
  ];

  return allowed.some((base) => normalized === base || normalized.startsWith(`${base}${path.sep}`));
}
