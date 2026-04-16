import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NEXUS_PRIMARY_AGENT_ID, NEXUS_PRIMARY_DESCRIPTION, NEXUS_PRIMARY_PROMPT } from "./agents/primary.js";
import { AGENT_META, AGENT_PROMPTS } from "./agents/prompts.js";

type ConfigLike = Record<string, unknown>;

const TASK_DELEGATION_DISABLED_TOOLS = {
  task: false,
  nx_task_close: false
} as const;

const RESTRICTED_BUILTIN_AGENT_IDS = ["general", "explore"] as const;

export function createConfigHook() {
  return async (config: ConfigLike): Promise<void> => {
    const currentAgent = toRecord(config.agent);
    const nextAgent: Record<string, unknown> = { ...currentAgent };

    nextAgent[NEXUS_PRIMARY_AGENT_ID] = mergePrimaryAgentEntry(toRecord(nextAgent[NEXUS_PRIMARY_AGENT_ID]));

    for (const meta of Object.values(AGENT_META)) {
      nextAgent[meta.id] = mergeSubagentAgentEntry(toRecord(nextAgent[meta.id]), {
        description: meta.description,
        mode: "subagent",
        model: meta.model,
        prompt: AGENT_PROMPTS[meta.id],
        tools: buildSubagentToolPolicy(meta.disallowedTools as string[])
      });
    }

    for (const agentId of RESTRICTED_BUILTIN_AGENT_IDS) {
      nextAgent[agentId] = mergeAgentToolRestrictions(toRecord(nextAgent[agentId]), TASK_DELEGATION_DISABLED_TOOLS);
    }

    config.agent = nextAgent;

    const permission = toRecord(config.permission);
    config.permission = {
      "*": permission["*"] ?? "ask",
      ...permission,
      task: {
        "*": "allow",
        ...(toRecord(permission.task) as Record<string, unknown>)
      }
    };

    if (!config.default_agent) {
      config.default_agent = NEXUS_PRIMARY_AGENT_ID;
    }
  };
}

function mergePrimaryAgentEntry(existing: Record<string, unknown>): Record<string, unknown> {
  const defaults: Record<string, unknown> = {
    description: NEXUS_PRIMARY_DESCRIPTION,
    mode: "primary",
    prompt: NEXUS_PRIMARY_PROMPT,
    color: "accent",
    permission: {
      task: {
        "*": "allow"
      }
    }
  };

  const mergedPermission = mergePrimaryPermission(toRecord(existing.permission));

  return {
    ...defaults,
    ...existing,
    permission: mergedPermission
  };
}

function mergePrimaryPermission(existingPermission: Record<string, unknown>): Record<string, unknown> {
  const defaultPermission = {
    task: {
      "*": "allow"
    }
  };

  return {
    ...defaultPermission,
    ...existingPermission,
    task: {
      ...defaultPermission.task,
      ...toRecord(existingPermission.task)
    }
  };
}

function mergeSubagentAgentEntry(
  existing: Record<string, unknown>,
  defaults: {
    description: string;
    mode: string;
    model: string;
    prompt: string;
    tools: Record<string, boolean>;
  }
): Record<string, unknown> {
  const mergedTools = {
    ...defaults.tools,
    ...toRecord(existing.tools)
  };
  Object.assign(mergedTools, TASK_DELEGATION_DISABLED_TOOLS);

  return {
    ...defaults,
    ...existing,
    tools: mergedTools
  };
}

function mergeAgentToolRestrictions(
  existing: Record<string, unknown>,
  restrictions: Record<string, boolean>
): Record<string, unknown> {
  return {
    ...existing,
    tools: {
      ...toRecord(existing.tools),
      ...restrictions
    }
  };
}

function buildSubagentToolPolicy(disallowedTools: string[]): Record<string, boolean> {
  const policy: Record<string, boolean> = {};
  for (const toolName of disallowedTools) {
    policy[toolName] = false;
  }
  Object.assign(policy, TASK_DELEGATION_DISABLED_TOOLS);
  return policy;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

// --- SKILL FILE DELIVERY (Option D A-leg) ---
// Copies bundled templates/skills/<id>/SKILL.md to user project's
// .opencode/skills/<id>/SKILL.md at plugin init time.
// Idempotent: skips if content hash matches; backs up if user-edited.
// Errors are swallowed after logging to avoid blocking plugin init.

const SKILL_IDS_TO_INSTALL = ["nx-plan", "nx-run", "nx-init", "nx-sync"] as const;

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export async function installSkillFiles(
  projectDirectory: string,
  log: (args: { body: { service: string; level: "info" | "warn" | "error" | "debug"; message: string } }) => Promise<unknown>
): Promise<void> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const templatesRoot = path.resolve(currentDir, "../templates/skills");
  const skillsRoot = path.join(projectDirectory, ".opencode", "skills");

  for (const skillId of SKILL_IDS_TO_INSTALL) {
    const templateFile = path.join(templatesRoot, skillId, "SKILL.md");
    const destDir = path.join(skillsRoot, skillId);
    const destFile = path.join(destDir, "SKILL.md");

    try {
      const templateContent = await fs.readFile(templateFile, "utf8");
      const templateHash = sha256(templateContent);

      await fs.mkdir(destDir, { recursive: true });

      let existingContent: string | null = null;
      try {
        existingContent = await fs.readFile(destFile, "utf8");
      } catch {
        // file does not exist — will write fresh
      }

      if (existingContent !== null) {
        if (sha256(existingContent) === templateHash) {
          // identical — skip
          continue;
        }
        // user-edited — back up before overwriting
        await fs.writeFile(`${destFile}.bak`, existingContent, "utf8");
        await log({
          body: {
            service: "opencode-nexus",
            level: "warn",
            message: `skill file updated (backup written): ${destFile}.bak`
          }
        });
      }

      await fs.writeFile(destFile, templateContent, "utf8");
    } catch (err) {
      await log({
        body: {
          service: "opencode-nexus",
          level: "warn",
          message: `could not install skill file for "${skillId}": ${err instanceof Error ? err.message : String(err)}`
        }
      });
    }
  }
}
