import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface QaTriggerResult {
  shouldSpawn: boolean;
  reasons: string[];
  changedFiles: string[];
}

export async function evaluateQaAutoTrigger(projectRoot: string, memorySignals: string[] = []): Promise<QaTriggerResult> {
  const changedFiles = await listChangedFiles(projectRoot);
  const reasons: string[] = [];

  if (changedFiles.length >= 3) {
    reasons.push("changed_files>=3");
  }

  if (changedFiles.some((f) => /(^|\/)(test|tests)\/|\.(test|spec)\./i.test(f))) {
    reasons.push("test_files_modified");
  }

  if (changedFiles.some((f) => /(api|controller|route|db|database|repository|model)/i.test(f))) {
    reasons.push("api_or_db_area_changed");
  }

  if (memorySignals.some((s) => /failure|regression|incident/i.test(s))) {
    reasons.push("historical_failure_signal");
  }

  return {
    shouldSpawn: reasons.length > 0,
    reasons,
    changedFiles
  };
}

async function listChangedFiles(projectRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only"], { cwd: projectRoot });
    return stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
