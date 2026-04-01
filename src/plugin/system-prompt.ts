import type { NexusAgentProfile } from "../agents/catalog";
import { AGENT_PROMPTS } from "../agents/prompts";
import type { NexusSkillProfile } from "../skills/catalog";
import { SKILL_PROMPTS } from "../skills/prompts";

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
  const skillPromptRows = skills.map((s) => `### ${s.id}\n${SKILL_PROMPTS[s.id]}`).join("\n\n");
  const modelRows = agents.map((a) => `- ${a.id}: ${a.model}`).join("\n");
  const promptRows = agents
    .map((a) => `### ${a.id}\n${AGENT_PROMPTS[a.id] ?? "No prompt"}`)
    .join("\n\n");

  const phaseLine = runPhase ? `- Current run phase: ${runPhase}` : "- Current run phase: unknown";
  const taskPipeline = [
    "TASK PIPELINE (mandatory for file modifications):",
    "1. Check active meet decisions first and preserve issue linkage when tasks come from a meet.",
    "2. Register each execution unit with nx_task_add before editing files.",
    "3. Keep edits scoped to active tasks only.",
    "4. As each task completes, call nx_task_update.",
    "5. When all tasks complete, verify, sync knowledge if needed, then close with nx_task_close."
  ].join("\n");

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
    "- Branch Guard: avoid substantial execution directly on main/master.",
    "- [d]: record decision in active meet session.",
    "- [rule]: write stable team conventions.",
    "- team_name is only a lead-managed coordination label, not a platform-native team object.",
    "- All grouped execution is lead-mediated; subagents do not directly coordinate each other.",
    "- Use nx_delegate_template for subagent delegation payloads.",
    taskPipeline,
    "Skills:",
    skillRows,
    "Skill Prompts:",
    skillPromptRows,
    "Agent Models:",
    modelRows,
    "Agent Prompts:",
    promptRows,
    "</nexus>"
  ].join("\n");
}
