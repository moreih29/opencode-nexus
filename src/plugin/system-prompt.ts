import { SKILL_PROMPTS } from "../skills/prompts.js";

interface SkillMeta {
  id: string;
  name: string;
  description: string;
  trigger_display: string;
  purpose: string;
}

interface BuildSystemInput {
  mode: "plan" | "run" | "decide" | "rule" | "sync" | "memory" | "memory_gc" | "idle";
  agents: { id: string; category: string; model: string }[];
  skills: SkillMeta[];
}

type NexusMode = BuildSystemInput["mode"];

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

function listAgentsByCategory(agents: BuildSystemInput["agents"], category: string): string {
  return agents
    .filter((agent) => agent.category === category)
    .map((agent) => agent.id)
    .join(", ");
}

function buildTaskPipeline(mode: NexusMode): string | null {
  if (mode !== "run") {
    return null;
  }

  return joinLines([
    "TASK PIPELINE (mandatory for file modifications in run mode):",
    "1. Check active plan decisions first and preserve issue linkage when tasks come from a plan.",
    "2. Register each execution unit with nx_task_add before editing files.",
    "3. Keep edits scoped to active tasks only.",
    "4. As each task completes, call nx_task_update.",
    "5. When all tasks complete, verify, sync knowledge if needed, then close with nx_task_close."
  ]);
}

const DELEGATION_PLAYBOOK = joinLines([
  "DELEGATION PLAYBOOK:",
  "- HOW agents advise on approach, UX, research method, and strategy; they do not own implementation state.",
  "- DO agents execute scoped work against active tasks only.",
  "- CHECK agents verify and report PASS/FAIL plus severity; they do not silently fix application code.",
  "- Multi-task or multi-file execution must not stay Lead solo once decomposition is required; involve Engineer for code execution units.",
  "- Read relevant .nexus/ files (decisions, context, memory) before specialist delegation when context or prior decisions matter.",
  "- Reuse an existing coordination label before inventing a new one when grouping related work.",
  "- All grouped execution is lead-mediated; subagents do not directly coordinate each other."
]);

const OUTPUT_CONTRACTS = joinLines([
  "OUTPUT CONTRACTS:",
  "- HOW agents: current state/user perspective, problem/opportunity, recommendation, trade-offs, risks.",
  "- DO agents: report completion with changed scope, summary, and notable constraints or decisions.",
  "- CHECK agents: list checks, PASS/FAIL, findings by severity, and recommended actions.",
  "- Research roles must surface citations, contradicting evidence, and null results where relevant.",
  "- Claims of impossibility, infeasibility, or platform limits require evidence."
]);

const PLATFORM_MAPPING = joinLines([
  "PLATFORM MAPPING:",
  "- Primary instruction path: AGENTS.md plus opencode.json.instructions.",
  "- CLAUDE.md is a legacy migration input only, not the primary runtime instruction file.",
  "- Slash-skill behavior is represented through nx_* tools, tags, hooks, and system injection.",
  "- Coordination labels are optional metadata, not platform-native team objects."
]);

export function buildNexusSystemPrompt(input: BuildSystemInput): string {
  const { mode, agents, skills } = input;

  const how = listAgentsByCategory(agents, "how");
  const execute = listAgentsByCategory(agents, "do");
  const check = listAgentsByCategory(agents, "check");

  const skillRows = skills.map((s) => `- ${s.id} (${s.trigger_display}): ${s.purpose}`).join("\n");
  const modelRows = agents.map((a) => `- ${a.id}: ${a.model}`).join("\n");

  const modePlaybook = buildModePlaybook(mode);
  const skillKey = mode === "plan" ? "nx-plan" : mode === "run" ? "nx-run" : mode === "sync" ? "nx-sync" : null;
  const skillBody = skillKey !== null ? (SKILL_PROMPTS[skillKey] ?? null) : null;
  const taskPipeline = buildTaskPipeline(mode);

  const nexusBlock = [
    "<nexus>",
    "Role: You are operating under Nexus orchestration.",
    "Constraints:",
    "- Enforce task pipeline for code changes in run mode.",
    "- Keep HOW agents in analysis/design lane; DO/CHECK execute and verify.",
    "- Prefer explicit state transitions over ad-hoc execution.",
    "- When the nexus primary is available, treat it as the preferred orchestration lead.",
    "Context:",
    `- Active mode: ${mode}`,
    `- HOW agents: ${how}`,
    `- DO agents: ${execute}`,
    `- CHECK agents: ${check}`,
    "Guidelines:",
    "- [plan]: discuss and decide before implementation.",
    "- [run]: execute with tasks, then verify, then close cycle.",
    "- Branch Guard: avoid substantial execution directly on main/master.",
    "- [d]: record decision in active plan session.",
    "- [rule]: write stable team conventions.",
    "- Coordination labels are optional lead-managed metadata, not platform-native team objects.",
    "- All grouped execution is lead-mediated; subagents do not directly coordinate each other.",
    "- Structure subagent delegation payloads with role, task, context, and constraints fields.",
    "- Setup/maintenance skills (nx-init, nx-sync) are called via skill() only when the user explicitly requests them or directly mentions the need. Do not invoke them proactively without user instruction.",
    modePlaybook,
    ...(taskPipeline ? [taskPipeline] : []),
    DELEGATION_PLAYBOOK,
    OUTPUT_CONTRACTS,
    PLATFORM_MAPPING,
    "Runtime Note:",
    "- Detailed role and skill procedures live in AGENTS.md, instructions, and the nx_* skill/tool surfaces; keep system injection focused on current state and mandatory execution guardrails.",
    "Skills:",
    skillRows,
    "Agent Models:",
    modelRows,
    "</nexus>"
  ].join("\n");

  if (skillBody === null) {
    return nexusBlock;
  }

  return [
    nexusBlock,
    `<nexus-skill id="${skillKey}">`,
    skillBody,
    `</nexus-skill>`
  ].join("\n");
}

function buildModePlaybook(mode: BuildSystemInput["mode"]): string {
  if (mode === "plan") {
    return [
      "MODE PLAYBOOK (plan):",
        "- Research before forming the agenda and before opening the current issue discussion.",
        "- Continue an existing plan session when one exists.",
        "- When a follow-up targets a prior HOW participant, prefer nx_plan_followup. It packages resume hints into delegation-ready guidance; fall back to nx_plan_resume when you only need raw continuity details.",
        "- Check nx_context or nx_plan_status for followupReady roles before deciding whether to resume an existing HOW participant or start fresh.",
        "- Discuss one issue at a time and compare options with trade-offs before recording a decision.",
      "- Before asking for a decision, present a comparison table with pros, cons, trade-offs, and a recommendation.",
      "- Record final decisions with [d] and nx_plan_decide.",
      "- Offer [run] only after all issues are decided and gaps are checked."
    ].join("\n");
  }

  if (mode === "run") {
    return [
      "MODE PLAYBOOK (run):",
      "- If no tasks exist yet, decompose the work and call nx_task_add before editing files.",
      "- Link execution tasks back to plan_issue when they originate from a plan decision.",
      "- Once decomposition yields multiple tasks or multiple files, do not continue as Lead solo; delegate code units to Engineer.",
      "- Read relevant .nexus/ files before specialist delegation when prior decisions or role-specific context matter.",
      "- Serialize overlapping file work; parallelize only independent work.",
      "- Trigger QA or Reviewer when verification risk is non-trivial.",
      "- After verification, run nx_sync when useful and archive with nx_task_close."
    ].join("\n");
  }

  if (mode === "decide") {
    return [
      "MODE PLAYBOOK (decide):",
      "- Ensure the current issue has supporting discussion before recording the decision.",
      "- Record the decision against the active plan issue, not as a free-floating note.",
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

  if (mode === "sync") {
    return [
      "MODE PLAYBOOK (sync):",
      "- Invoke skill({name:'nx-sync'}) to run the full context synchronization workflow.",
      "- Scan current project state (codebase, config, decisions) and update .nexus/context/ design documents.",
      "- Check for upstream drift: compare .nexus/context/ with actual code and flag stale entries."
    ].join("\n");
  }

  if (mode === "memory") {
    return [
      "MODE PLAYBOOK (memory save):",
      "- Save only non-recoverable working knowledge in .nexus/memory/{category-topic}.md using Write tool (categories: empirical-, external-, pattern-).",
      "- Use lowercase kebab-case .md filenames with descriptive topic names; avoid dates or version numbers in filenames.",
      "- Merge-before-create: update an existing related file first, and create a new file only when no suitable file exists.",
      "- Keep entries concise; prefer structured lists or short paragraphs over verbatim transcription."
    ].join("\n");
  }

  if (mode === "memory_gc") {
    return [
      "MODE PLAYBOOK (memory gc):",
      "- Manual GC is the default. Review files deliberately rather than applying automatic deletion.",
      "- Use Glob to collect all .nexus/memory/*.md files.",
      "- Identify related, duplicate, or outdated entries across files.",
      "- Merge related content before deletion and keep deletions git-recoverable."
    ].join("\n");
  }

  return [
    "MODE PLAYBOOK (idle):",
    "- Check whether an active plan or task cycle already exists before starting something new.",
    "- Use [plan] for significant decisions before implementation.",
    "- Use [run] when execution should follow the task pipeline.",
    "- Close completed cycles instead of leaving state hanging."
  ].join("\n");
}
