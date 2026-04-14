import fs from "node:fs/promises";
import path from "node:path";

import { AGENT_META } from "../dist/agents/generated/index.js";
import { SKILL_META, SKILL_PROMPTS } from "../dist/skills/generated/index.js";
import { NEXUS_TAGS } from "../dist/shared/tags.js";

const NEXUS_AGENT_CATALOG = Object.values(AGENT_META);
const NEXUS_SKILL_CATALOG = Object.values(SKILL_META);

const root = process.cwd();
const outDir = path.join(root, "templates");
const outFile = path.join(outDir, "nexus-section.md");

await fs.mkdir(outDir, { recursive: true });

const agents = NEXUS_AGENT_CATALOG.map((a) => `| ${a.name} | ${a.category.toUpperCase()} | ${a.description} | ${a.id} |`).join("\n");
const skills = NEXUS_SKILL_CATALOG.map((s) => `| ${s.id} | ${s.trigger_display} | ${s.purpose} |`).join("\n");
const tags = NEXUS_TAGS.map((t) => `| ${t.tag} | ${t.purpose} |`).join("\n");

const content = [
  "## Nexus Agent Orchestration",
  "",
  "**Default: DELEGATE** - route code work, analysis, and multi-file changes to agents.",
  "**OpenCode model** - lead-mediated orchestration with task state, hook guardrails, and coordination labels instead of Claude team objects.",
  "",
  "### Agent Routing",
  "",
  "Use agents when parallel work or a second specialized perspective is helpful.",
  "",
  "| Name | Category | Task | Agent |",
  "|---|---|---|---|",
  agents,
  "",
  "Small single-file tasks can stay with the lead agent.",
  "Reuse an existing `team_name` label before inventing a new one; it is a grouping label, not a platform-native team object.",
  "",
  "### Skills",
  "",
  "| Skill | Trigger | Purpose |",
  "|---|---|---|",
  skills,
  "",
  "### Tags",
  "",
  "| Tag | Purpose |",
  "|---|---|",
  tags,
  "",
  "### Operational Rules",
  "",
  "- Use `[plan]` before major implementation decisions.",
  "- In planning sessions, research first and discuss one issue at a time.",
  "- Use `[d]` only inside an active plan and only after supporting discussion is recorded.",
  "- Use `[run]` when execution should follow the task pipeline.",
  "- Register each execution unit with `nx_task_add` before file edits.",
  "- Keep edits scoped to active tasks and update status with `nx_task_update`.",
  "- Verify before closure; run `nx_sync` when useful, then archive with `nx_task_close`.",
  "- Apply Branch Guard on `main` or `master` before substantial execution.",
  "",
  "### Coordination Model",
  "",
  "- Lead owns task state, delegation, and final reporting.",
  "- HOW agents advise on approach and do not own implementation state.",
  "- DO agents execute scoped work against active tasks only.",
  "- CHECK agents report PASS/FAIL plus findings by severity.",
  "- `team_name` is a shared coordination label used to group related subagent work.",
  "- All grouped execution is lead-mediated; subagents do not directly coordinate each other.",
  "",
  "### Platform Mapping",
  "",
  "- Primary instruction path: `AGENTS.md` plus `opencode.json.instructions`.",
  "- `CLAUDE.md` is legacy migration input only.",
  "- Claude slash skills map to `nx_*` tools plus tags and hook injection.",
  "- Claude team APIs map to lead-coordinated OpenCode delegation with `team_name` labels.",
  "- Exit/edit guardrails replace Claude nonstop behavior.",
  ""
].join("\n");

await fs.writeFile(outFile, content, "utf8");
console.log(`generated ${path.relative(root, outFile)}`);

// Generate SKILL.md files for skills that have prompts in SKILL_PROMPTS.
// Handwritten skills (nx-init, nx-sync, nx-setup) are preserved — only
// nx-plan and nx-run (which have authoritative prompt bodies) are auto-generated.
// NOTE: drift risk for handwritten skills is accepted (Option A decision).
const GENERATED_SKILL_IDS = Object.keys(SKILL_PROMPTS).filter(
  (id) => !["nx-init", "nx-sync", "nx-setup"].includes(id)
);

for (const skillId of GENERATED_SKILL_IDS) {
  const catalog = SKILL_META[skillId];
  if (!catalog) {
    console.warn(`  [warn] SKILL_PROMPTS has "${skillId}" but no catalog entry — skipping`);
    continue;
  }
  const skillOutDir = path.join(outDir, "skills", skillId);
  const skillOutFile = path.join(skillOutDir, "SKILL.md");
  await fs.mkdir(skillOutDir, { recursive: true });
  const frontmatter = [
    "---",
    `name: ${catalog.id}`,
    `description: ${catalog.purpose}`,
    "license: MIT",
    "compatibility: opencode",
    "---",
    ""
  ].join("\n");
  const skillContent = frontmatter + SKILL_PROMPTS[skillId];
  await fs.writeFile(skillOutFile, skillContent, "utf8");
  console.log(`generated ${path.relative(root, skillOutFile)}`);
}
