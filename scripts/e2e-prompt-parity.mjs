import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const agentPrompts = await fs.readFile(path.join(root, "src", "agents", "prompts.ts"), "utf8");
const skillPrompts = await fs.readFile(path.join(root, "src", "skills", "prompts.ts"), "utf8");
const systemPrompt = await fs.readFile(path.join(root, "src", "plugin", "system-prompt.ts"), "utf8");
const template = await fs.readFile(path.join(root, "templates", "nexus-section.md"), "utf8");

for (const agent of ["architect", "designer", "postdoc", "strategist", "engineer", "researcher", "writer", "tester", "reviewer"]) {
  assert.match(agentPrompts, new RegExp(`${agent}: \\[`, "i"));
}

for (const token of [
  "Evidence Requirement",
  "Response Format",
  "Severity Levels",
  "Completion Report",
  "Escalation"
]) {
  assert.match(agentPrompts, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const skill of ["nx-plan", "nx-run", "nx-init", "nx-sync", "nx-setup"]) {
  assert.match(skillPrompts, new RegExp(`"${skill}"`));
}

for (const token of [
  "Trigger:",
  "Procedure:",
  "Flow:",
  "Process:",
  "Preservation Rules:",
  "Delegation Rules:",
  "Rollback Routing:",
  "Conflict Handling:"
]) {
  assert.match(skillPrompts, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const token of [
  "MUST NOT handle multi-task or multi-file execution as Lead solo once decomposition is required.",
  "MUST involve at least one Engineer for code execution units.",
  "MUST log discussion before decision; nx_plan_decide never substitutes for the discussion record.",
  "prefer nx_plan_followup to produce delegation-ready resume guidance",
  "Generated identity drafts remain drafts until the user confirms or replaces them.",
  "target paths",
  "git working tree changes",
  "identity confirmation requirement"
]) {
  assert.match(skillPrompts, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const token of [
  "DELEGATION PLAYBOOK",
  "OUTPUT CONTRACTS",
  "PLATFORM MAPPING",
  "MODE PLAYBOOK (run)",
  "MODE PLAYBOOK (plan)"
]) {
  assert.match(systemPrompt, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const token of [
  "Detailed role and skill procedures live in AGENTS.md",
  "Multi-task or multi-file execution must not stay Lead solo once decomposition is required; involve Engineer for code execution units.",
  "Research before forming the agenda and before opening the current issue discussion.",
  "followupReady roles"
]) {
  assert.match(systemPrompt, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const token of [
  "### Operational Rules",
  "### Coordination Model",
  "### Platform Mapping",
  "nx_task_add",
  "nx_sync",
  "coordination label"
]) {
  assert.match(template, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

console.log("e2e prompt parity passed");
