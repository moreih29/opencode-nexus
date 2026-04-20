// Wrapper-local canonical install spec for opencode-nexus CLI.
// Future migration intent: replace these constants with @moreih29/nexus-core canonical-install-spec export when available.

import { homedir } from "node:os";
import { join } from "node:path";

export const PACKAGE_NAME = "opencode-nexus";
export const MCP_SERVER_NAME = "nx";
export const MCP_SERVER_CONFIG = Object.freeze({
  type: "local",
  command: Object.freeze(["nexus-mcp"]),
});
export const DEFAULT_AGENT = "lead";
export const SCHEMA_URL = "https://opencode.ai/config.json";
export const SKILLS_TO_COPY = Object.freeze(["nx-init", "nx-plan", "nx-run", "nx-sync"]);

export function userConfigPath() {
  return join(homedir(), ".config", "opencode", "opencode.json");
}

export function projectConfigPath(cwd = process.cwd()) {
  return join(cwd, "opencode.json");
}

export function userSkillsDir() {
  return join(homedir(), ".config", "opencode", "skills");
}

export function projectSkillsDir(cwd = process.cwd()) {
  return join(cwd, ".opencode", "skills");
}

// Plugin matcher: supports both bare and pinned entries.
export function isNexusPluginEntry(entry) {
  if (typeof entry !== "string") return false;
  return entry === PACKAGE_NAME || entry.startsWith(`${PACKAGE_NAME}@`);
}
