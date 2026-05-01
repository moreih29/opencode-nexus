import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { architect } from "../agents/architect.js";
import { designer } from "../agents/designer.js";
import { engineer } from "../agents/engineer.js";
import { lead } from "../agents/lead.js";
import { postdoc } from "../agents/postdoc.js";
import { researcher } from "../agents/researcher.js";
import { reviewer } from "../agents/reviewer.js";
import { strategist } from "../agents/strategist.js";
import { tester } from "../agents/tester.js";
import { writer } from "../agents/writer.js";

export const NEXUS_GITIGNORE = `# Nexus: whitelist tracked files, ignore everything else
*
!.gitignore
!context/
!context/**
!memory/
!memory/**
!history.json
`;

export const TAG_INSTRUCTIONS = new Map([
  ["[plan]", "Activate the nx-plan skill and follow its planning workflow for this request."],
  ["[auto-plan]", "Activate the nx-auto-plan skill and follow its autonomous planning workflow for this request."],
  ["[run]", "Activate the nx-run skill and follow its execution workflow for this request."],
  ["[m]", "Store the relevant content from this request under .nexus/memory/ using Nexus memory conventions."],
  ["[m:gc]", "Clean up and merge .nexus/memory/ using Nexus memory conventions."],
  ["[d]", "Record the current plan decision with nx_plan_decide."],
]);

export const NEXUS_AGENTS = {
  architect,
  designer,
  engineer,
  lead,
  postdoc,
  researcher,
  reviewer,
  strategist,
  tester,
  writer,
};

export function ensureNexusStructure(root: string) {
  const nexusDir = join(root, ".nexus");
  const contextDir = join(nexusDir, "context");
  const memoryDir = join(nexusDir, "memory");
  const stateDir = join(nexusDir, "state");
  const gitignorePath = join(nexusDir, ".gitignore");

  mkdirSync(contextDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, NEXUS_GITIGNORE, "utf8");
  }
}

export function extractLeadingTag(text: string) {
  const trimmed = text.trimStart();
  for (const tag of TAG_INSTRUCTIONS.keys()) {
    if (trimmed.startsWith(tag)) return tag;
  }
  return null;
}

export function stripLeadingTag(text: string, tag: string) {
  const leadingWhitespace = text.match(/^\s*/)?.[0] ?? "";
  const remaining = text.slice(leadingWhitespace.length);
  if (!remaining.startsWith(tag)) return text;
  return `${leadingWhitespace}${remaining.slice(tag.length).trimStart()}`;
}

export function toAgentConfig(agent: { description?: string; mode?: string; permission?: Record<string, unknown>; system?: string }) {
  // Default to "subagent" so opencode's tab cycling shows only agents that
  // explicitly opt in to "primary" (e.g. lead). The upstream nexus-core sync
  // ships our 9 subagents without a `mode` field, and recent opencode
  // versions treat undefined as tab-cyclable, which surfaced as a UX
  // regression. Users can still override per-agent via opencode.json.
  return {
    description: agent.description,
    mode: agent.mode ?? "subagent",
    permission: agent.permission,
    prompt: agent.system,
  };
}

export function mergeAgentConfig(base: Record<string, unknown>, override: Record<string, unknown>) {
  const merged = { ...base, ...override };

  const basePermission = typeof base.permission === "object" && base.permission !== null ? base.permission : {};
  const overridePermission = typeof override.permission === "object" && override.permission !== null ? override.permission : {};
  if (Object.keys(basePermission).length > 0 || Object.keys(overridePermission).length > 0) {
    merged.permission = { ...basePermission, ...overridePermission };
  }

  return merged;
}
