import type { NexusAgentProfile } from "../agents/catalog";
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

  const phaseLine = runPhase ? `- Current run phase: ${runPhase}` : "- Current run phase: unknown";
  const modePlaybook = buildModePlaybook(mode);
  const taskPipeline = [
    "TASK PIPELINE (mandatory for file modifications):",
    "1. Check active meet decisions first and preserve issue linkage when tasks come from a meet.",
    "2. Register each execution unit with nx_task_add before editing files.",
    "3. Keep edits scoped to active tasks only.",
    "4. As each task completes, call nx_task_update.",
    "5. When all tasks complete, verify, sync knowledge if needed, then close with nx_task_close."
  ].join("\n");
  const delegationPlaybook = [
    "DELEGATION PLAYBOOK:",
    "- HOW agents advise on approach, UX, research method, and strategy; they do not own implementation state.",
    "- DO agents execute scoped work against active tasks only.",
    "- CHECK agents verify and report PASS/FAIL plus severity; they do not silently fix application code.",
    "- Multi-task or multi-file execution must not stay Lead solo once decomposition is required; involve Engineer for code execution units.",
    "- Use nx_briefing(role, hint?) before specialist delegation when context or prior decisions matter.",
    "- Reuse an existing team_name coordination label before inventing a new one.",
    "- All grouped execution is lead-mediated; subagents do not directly coordinate each other."
  ].join("\n");
  const outputContracts = [
    "OUTPUT CONTRACTS:",
    "- HOW agents: current state/user perspective, problem/opportunity, recommendation, trade-offs, risks.",
    "- DO agents: report completion with changed scope, summary, and notable constraints or decisions.",
    "- CHECK agents: list checks, PASS/FAIL, findings by severity, and recommended actions.",
    "- Research roles must surface citations, contradicting evidence, and null results where relevant.",
    "- Claims of impossibility, infeasibility, or platform limits require evidence."
  ].join("\n");
  const legacyMapping = [
    "PLATFORM MAPPING:",
    "- Primary instruction path: AGENTS.md plus opencode.json.instructions.",
    "- CLAUDE.md is a legacy migration input only, not the primary runtime instruction file.",
    "- Slash-skill behavior is represented through nx_* tools, tags, hooks, and system injection.",
    "- team_name is a coordination label, not a platform-native team object."
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
    modePlaybook,
    taskPipeline,
    delegationPlaybook,
    outputContracts,
    legacyMapping,
    "Runtime Note:",
    "- Detailed role and skill procedures live in AGENTS.md, instructions, and the nx_* skill/tool surfaces; keep system injection focused on current state and mandatory execution guardrails.",
    "Skills:",
    skillRows,
    "Agent Models:",
    modelRows,
    "</nexus>"
  ].join("\n");
}

function buildModePlaybook(mode: BuildSystemInput["mode"]): string {
  if (mode === "meet") {
    return [
      "MODE PLAYBOOK (meet):",
      "- Research before forming the agenda and before opening the current issue discussion.",
      "- Continue an existing meet session when one exists.",
      "- Discuss one issue at a time and log significant reasoning with nx_meet_discuss before recording a decision.",
      "- Present options with pros, cons, trade-offs, and a recommendation before seeking a decision.",
      "- Record final decisions with [d] and nx_meet_decide.",
      "- Offer [run] only after all issues are decided and gaps are checked."
    ].join("\n");
  }

  if (mode === "run") {
    return [
      "MODE PLAYBOOK (run):",
      "- If no tasks exist yet, decompose the work and call nx_task_add before editing files.",
      "- Link execution tasks back to meet_issue when they originate from a meet decision.",
      "- Once decomposition yields multiple tasks or multiple files, do not continue as Lead solo; delegate code units to Engineer.",
      "- Use nx_briefing before specialist delegation when prior decisions or role-specific context matter.",
      "- Serialize overlapping file work; parallelize only independent work.",
      "- Trigger QA or Reviewer when verification risk is non-trivial.",
      "- After verification, run nx_sync when useful and archive with nx_task_close."
    ].join("\n");
  }

  if (mode === "decide") {
    return [
      "MODE PLAYBOOK (decide):",
      "- Ensure the current issue has supporting discussion before recording the decision.",
      "- Record the decision against the active meet issue, not as a free-floating note.",
      "- Return to the next pending issue or offer [run] when all issues are decided."
    ].join("\n");
  }

  if (mode === "rule") {
    return [
      "MODE PLAYBOOK (rule):",
      "- Capture durable conventions only.",
      "- Prefer concise, reusable rules tagged for future filtering.",
      "- Save rules through dedicated Nexus rule tooling rather than burying them in free text."
    ].join("\n");
  }

  return [
    "MODE PLAYBOOK (idle):",
    "- Check whether an active meet or task cycle already exists before starting something new.",
    "- Use [meet] for significant decisions before implementation.",
    "- Use [run] when execution should follow the task pipeline.",
    "- Close completed cycles instead of leaving state hanging."
  ].join("\n");
}
