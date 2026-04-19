import { z } from "zod";

export const ALLOWED_AGENT_IDS = [
  "nexus",
  "architect",
  "designer",
  "postdoc",
  "strategist",
  "engineer",
  "researcher",
  "writer",
  "reviewer",
  "tester",
  "general",
  "explore"
] as const;

export type AllowedAgentId = typeof ALLOWED_AGENT_IDS[number];

export const isolatedAgentSchema = z
  .object({
    model: z.string().optional(),
    tools: z.record(z.string(), z.boolean()).optional()
  })
  .strict();

export const isolatedConfigSchema = z
  .object({
    version: z.literal(1),
    agents: z.record(z.string(), isolatedAgentSchema).optional().default({})
  })
  .strict();

export type IsolatedAgentConfig = z.infer<typeof isolatedAgentSchema>;
export type IsolatedConfig = z.infer<typeof isolatedConfigSchema>;

export interface ValidationResult {
  config: IsolatedConfig;
  warnings: string[];
}

const allowedAgentIdSet = new Set<string>(ALLOWED_AGENT_IDS);
const ROOT_KEYS = new Set(["version", "agents"]);

export function validateIsolatedConfig(raw: unknown): ValidationResult {
  const warnings: string[] = [];

  if (!isRecord(raw)) {
    warnings.push("$: expected object, using default config");
    return { config: createEmptyConfig(), warnings };
  }

  for (const key of Object.keys(raw)) {
    if (!ROOT_KEYS.has(key)) {
      warnings.push(`${key}: unknown root field, dropped`);
    }
  }

  const version = normalizeVersion(raw.version, warnings);
  const agents = normalizeAgents(raw.agents, warnings);

  const parsed = isolatedConfigSchema.safeParse({ version, agents });
  if (!parsed.success) {
    warnings.push(`$: failed final schema validation (${formatZodIssues(parsed.error.issues)}), using default config`);
    return { config: createEmptyConfig(), warnings };
  }

  return {
    config: parsed.data,
    warnings
  };
}

function normalizeVersion(value: unknown, warnings: string[]): 1 {
  if (value === undefined) {
    warnings.push("version: missing, defaulted to 1");
    return 1;
  }

  if (value !== 1) {
    warnings.push(`version: expected literal 1, received ${String(value)}; defaulted to 1`);
    return 1;
  }

  return 1;
}

function normalizeAgents(value: unknown, warnings: string[]): IsolatedConfig["agents"] {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    warnings.push("agents: expected object, dropped invalid value");
    return {};
  }

  const normalized: IsolatedConfig["agents"] = {};
  for (const [agentId, rawAgentConfig] of Object.entries(value)) {
    if (!allowedAgentIdSet.has(agentId)) {
      warnings.push(`agents.${agentId}: unknown agentId, dropped`);
      continue;
    }

    const parsedAgent = isolatedAgentSchema.safeParse(rawAgentConfig);
    if (!parsedAgent.success) {
      warnings.push(`agents.${agentId}: invalid config (${formatZodIssues(parsedAgent.error.issues)}), dropped`);
      continue;
    }

    normalized[agentId] = parsedAgent.data;
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const issuePath = issue.path.length > 0 ? issue.path.join(".") : "$";
      return `${issuePath}: ${issue.message}`;
    })
    .join("; ");
}

function createEmptyConfig(): IsolatedConfig {
  return { version: 1, agents: {} };
}
