import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const agentPrompts = await fs.readFile(path.join(root, "src", "agents", "prompts.ts"), "utf8");
const skillPrompts = await fs.readFile(path.join(root, "src", "skills", "prompts.ts"), "utf8");
const systemPrompt = await fs.readFile(path.join(root, "src", "plugin", "system-prompt.ts"), "utf8");
const template = await fs.readFile(path.join(root, "templates", "nexus-section.md"), "utf8");

for (const agent of ["architect", "designer", "postdoc", "strategist", "engineer", "researcher", "writer", "qa", "reviewer"]) {
  assert.match(agentPrompts, new RegExp(`${agent}: \\[`, "i"));
}

for (const token of [
  "Evidence Requirement:",
  "Response Format:",
  "Artifact Rule:",
  "Severity Levels:",
  "Completion Report",
  "Escalation:"
]) {
  assert.match(agentPrompts, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

for (const skill of ["nx-meet", "nx-run", "nx-init", "nx-sync", "nx-setup"]) {
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
  "DELEGATION PLAYBOOK",
  "OUTPUT CONTRACTS",
  "PLATFORM MAPPING",
  "MODE PLAYBOOK (run)",
  "MODE PLAYBOOK (meet)"
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
