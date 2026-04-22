import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "opencode-nexus";
export const SCHEMA_URL = "https://opencode.ai/config.json";
export const DEFAULT_AGENT = "lead";
export const MCP_SERVER_NAME = "nx";
export const MCP_SERVER_CONFIG = Object.freeze({
  type: "local",
  command: Object.freeze(["nexus-mcp"]),
});
export const CORE_SKILLS = Object.freeze(["nx-auto-plan", "nx-plan", "nx-run"]);

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const packageRoot = join(moduleDir, "..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

export const PACKAGE_VERSION = packageJson.version;
export const PACKAGE_SPEC = `${PACKAGE_NAME}@${PACKAGE_VERSION}`;

export function projectConfigPath(cwd = process.cwd()) {
  return join(cwd, "opencode.json");
}

export function userConfigPath() {
  return join(homedir(), ".config", "opencode", "opencode.json");
}

export function projectSkillsDir(cwd = process.cwd()) {
  return join(cwd, ".opencode", "skills");
}

export function userSkillsDir() {
  return join(homedir(), ".config", "opencode", "skills");
}

export function bundledSkillsDir() {
  return join(packageRoot, "skills");
}

export function isPluginEntry(value) {
  return typeof value === "string" && (value === PACKAGE_NAME || value.startsWith(`${PACKAGE_NAME}@`));
}
