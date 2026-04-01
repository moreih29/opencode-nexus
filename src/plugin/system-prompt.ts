import type { NexusAgentProfile } from "../agents/catalog";
import { AGENT_PROMPTS } from "../agents/prompts";
import type { NexusSkillProfile } from "../skills/catalog";

interface BuildSystemInput {
  mode: "meet" | "run" | "decide" | "rule" | "idle";
  agents: NexusAgentProfile[];
  skills: NexusSkillProfile[];
  runPhase?: string;
}

export function buildNexusSystemPrompt(input: BuildSystemInput): string {
  const { mode, agents, skills, runPhase } = input;

  const how = agents.filter((a) => a.category === "how").map((a) => a.id).join(", ");
  const execute = agents.filter((a) => a.category === "do").map((a) => a.id).join(", ");
  const check = agents.filter((a) => a.category === "check").map((a) => a.id).join(", ");

  const skillRows = skills.map((s) => `- ${s.id} (${s.trigger}): ${s.purpose}`).join("\n");
  const modelRows = agents.map((a) => `- ${a.id}: ${a.model}`).join("\n");
  const promptRows = agents
    .map((a) => `### ${a.id}\n${AGENT_PROMPTS[a.id] ?? "No prompt"}`)
    .join("\n\n");

  const phaseLine = runPhase ? `- Current run phase: ${runPhase}` : "- Current run phase: unknown";

  return [
    "<nexus>",
    "Role: You are operating under Nexus orchestration.",
    "Constraints:",
    "- Enforce task pipeline for code changes.",
    "- Keep HOW agents in analysis/design lane; DO/CHECK execute and verify.",
    "- Prefer explicit state transitions over ad-hoc execution.",
    "Context:",
    `- Active mode: ${mode}`,
    phaseLine,
    `- HOW agents: ${how}`,
    `- DO agents: ${execute}`,
    `- CHECK agents: ${check}`,
    "Guidelines:",
    "- [meet]: discuss and decide before implementation.",
    "- [run]: execute with tasks, then verify, then close cycle.",
    "- [d]: record decision in active meet session.",
    "- [rule]: write stable team conventions.",
    "Skills:",
    skillRows,
    "Agent Models:",
    modelRows,
    "Agent Prompts:",
    promptRows,
    "</nexus>"
  ].join("\n");
}
