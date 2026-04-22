import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";
import { architect } from "./agents/architect.js";
import { designer } from "./agents/designer.js";
import { engineer } from "./agents/engineer.js";
import { lead } from "./agents/lead.js";
import { postdoc } from "./agents/postdoc.js";
import { researcher } from "./agents/researcher.js";
import { reviewer } from "./agents/reviewer.js";
import { strategist } from "./agents/strategist.js";
import { tester } from "./agents/tester.js";
import { writer } from "./agents/writer.js";

const NEXUS_GITIGNORE = `# Nexus: whitelist tracked files, ignore everything else
*
!.gitignore
!context/
!context/**
!memory/
!memory/**
!history.json
`;

const TAG_INSTRUCTIONS = new Map([
  ["[plan]", "Activate the nx-plan skill and follow its planning workflow for this request."],
  ["[auto-plan]", "Activate the nx-auto-plan skill and follow its autonomous planning workflow for this request."],
  ["[run]", "Activate the nx-run skill and follow its execution workflow for this request."],
  ["[m]", "Store the relevant content from this request under .nexus/memory/ using Nexus memory conventions."],
  ["[m:gc]", "Clean up and merge .nexus/memory/ using Nexus memory conventions."],
  ["[d]", "Record the current plan decision with nx_plan_decide."],
]);

const NEXUS_AGENTS = {
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

function ensureNexusStructure(root: string) {
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

function extractLeadingTag(text: string) {
  const trimmed = text.trimStart();
  for (const tag of TAG_INSTRUCTIONS.keys()) {
    if (trimmed.startsWith(tag)) return tag;
  }
  return null;
}

function stripLeadingTag(text: string, tag: string) {
  const leadingWhitespace = text.match(/^\s*/)?.[0] ?? "";
  const remaining = text.slice(leadingWhitespace.length);
  if (!remaining.startsWith(tag)) return text;
  return `${leadingWhitespace}${remaining.slice(tag.length).trimStart()}`;
}

function toAgentConfig(agent: { description?: string; mode?: string; permission?: Record<string, unknown>; system?: string }) {
  return {
    description: agent.description,
    mode: agent.mode,
    permission: agent.permission,
    prompt: agent.system,
  };
}

function mergeAgentConfig(base: Record<string, unknown>, override: Record<string, unknown>) {
  const merged = { ...base, ...override };

  const basePermission = typeof base.permission === "object" && base.permission !== null ? base.permission : {};
  const overridePermission = typeof override.permission === "object" && override.permission !== null ? override.permission : {};
  if (Object.keys(basePermission).length > 0 || Object.keys(overridePermission).length > 0) {
    merged.permission = { ...basePermission, ...overridePermission };
  }

  return merged;
}

export const OpencodeNexus: Plugin = async ({ directory }) => {
  return {
    config: async (config) => {
      const configRecord = config as Record<string, unknown>;
      config.agent ??= {};

      for (const [id, agent] of Object.entries(NEXUS_AGENTS)) {
        const generated = toAgentConfig(agent);
        const existing = typeof config.agent[id] === "object" && config.agent[id] !== null ? config.agent[id] : {};
        config.agent[id] = mergeAgentConfig(generated, existing as Record<string, unknown>);
      }

      if (typeof configRecord.default_agent !== "string" || configRecord.default_agent.length === 0) {
        configRecord.default_agent = "lead";
      }
    },
    event: async ({ event }) => {
      if (event.type !== "session.created") return;
      if (event.properties.info.parentID) return;
      ensureNexusStructure(directory);
    },
    "chat.message": async (_input, output) => {
      const textPart = output.parts.find((part) => part.type === "text");
      if (!textPart || typeof textPart.text !== "string") return;

      const tag = extractLeadingTag(textPart.text);
      if (!tag) return;

      const strippedText = stripLeadingTag(textPart.text, tag).trim();
      const instruction = TAG_INSTRUCTIONS.get(tag);
      if (!instruction) return;

      textPart.text = `${strippedText}\n\n[Nexus Hook]\n${instruction}`.trim();
    },
  };
};

export default OpencodeNexus;
