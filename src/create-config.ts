import { NEXUS_AGENT_CATALOG } from "./agents/catalog.js";
import { NEXUS_PRIMARY_AGENT_ID, NEXUS_PRIMARY_DESCRIPTION, NEXUS_PRIMARY_PROMPT } from "./agents/primary.js";

type ConfigLike = Record<string, unknown>;

export function createConfigHook() {
  return async (config: ConfigLike): Promise<void> => {
    const currentAgent = toRecord(config.agent);
    const nextAgent: Record<string, unknown> = { ...currentAgent };

    if (!nextAgent[NEXUS_PRIMARY_AGENT_ID]) {
      nextAgent[NEXUS_PRIMARY_AGENT_ID] = {
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
    }

    for (const profile of NEXUS_AGENT_CATALOG) {
      if (nextAgent[profile.id]) {
        continue;
      }
      nextAgent[profile.id] = {
        description: profile.description,
        mode: "subagent",
        model: profile.model,
        tools: buildToolPolicy(profile.disallowedTools)
      };
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

function buildToolPolicy(disallowedTools: string[]): Record<string, boolean> {
  const policy: Record<string, boolean> = {};
  for (const toolName of disallowedTools) {
    policy[toolName] = false;
  }
  return policy;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
