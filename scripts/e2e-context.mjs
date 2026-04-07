import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxPlanFollowup, nxPlanJoin, nxPlanResume } from "../dist/tools/meet.js";
import { nxContext } from "../dist/tools/context.js";
import { nxTaskAdd } from "../dist/tools/task.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-context-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");

const paths = createNexusPaths(root);
await ensureNexusStructure(paths);
const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });
await fs.writeFile(
  paths.PLAN_FILE,
  JSON.stringify(
    {
      id: 1,
      topic: "Procedural parity",
      attendees: [{ role: "lead", name: "Lead", joined_at: new Date().toISOString() }],
      issues: [{ id: 1, title: "Plan run workflow", status: "pending", discussion: [] }],
      created_at: new Date().toISOString()
    },
    null,
    2
  ),
  "utf8"
);

const ctx = { directory: root, worktree: root };
await nxPlanJoin.execute({ role: "architect", name: "Architect" }, ctx);
const addResult = JSON.parse(await nxTaskAdd.execute({ title: "Implement workflow" }, ctx));
assert.match(addResult.message, /Link this task to its plan issue/);
assert.equal(typeof addResult.nexus_task_id, "number");

await hooks["tool.execute.before"](
  { tool: "task" },
  { args: { subagent_type: "engineer", team_name: "impl-group", description: "implement workflow" } }
);
await hooks["tool.execute.after"](
  { tool: "task", args: { subagent_type: "engineer", team_name: "impl-group" } },
  { title: "ok", output: "done", metadata: null }
);

await hooks["tool.execute.before"](
  { tool: "task" },
  { args: { subagent_type: "architect", team_name: "plan-panel", description: "review compatibility" } }
);
await hooks["tool.execute.after"](
  { tool: "task", args: { subagent_type: "architect", team_name: "plan-panel" } },
  { title: "ok", output: "Prefer canonical-first handoff.", metadata: { task_id: "task-architect-1", session_id: "session-architect-1" } }
);

const planSidecar = JSON.parse(await fs.readFile(paths.PLAN_SIDECAR_FILE, "utf8"));
const now = new Date().toISOString();
const participants = (Array.isArray(planSidecar?.panel?.participants) ? planSidecar.panel.participants : [])
  .map((item) => {
    if (item.role === "architect") {
      return {
        ...item,
        task_id: "task-architect-sidecar-stale",
        session_id: "session-architect-sidecar-stale",
        last_summary: "Stale sidecar continuity",
        updated_at: now
      };
    }
    return item;
  })
  .concat([
    {
      role: "strategist",
      task_id: "task-strategist-sidecar-1",
      session_id: "session-strategist-sidecar-1",
      last_summary: "Sidecar-only strategist context",
      updated_at: now
    }
  ]);

await fs.writeFile(
  paths.PLAN_SIDECAR_FILE,
  JSON.stringify(
    {
      ...planSidecar,
      panel: {
        ...planSidecar.panel,
        participants
      }
    },
    null,
    2
  ),
  "utf8"
);

const contextResult = JSON.parse(await nxContext.execute({}, ctx));
const resumeResult = JSON.parse(await nxPlanResume.execute({ role: "architect", question: "Can you justify the handoff rule?" }, ctx));
const followupResult = JSON.parse(await nxPlanFollowup.execute({ role: "architect", question: "Can you justify the handoff rule?" }, ctx));
const strategistResumeResult = await nxPlanResume.execute({ role: "strategist", question: "What should we do next?" }, ctx);
const strategistFollowupResult = JSON.parse(await nxPlanFollowup.execute({ role: "strategist", question: "What should we do next?" }, ctx));
const membershipRoles = contextResult.handoff.panelMembership.roles;
const architectContinuity = contextResult.handoff.resumability.participants.find((item) => item.role === "architect");
const strategistContinuity = contextResult.handoff.resumability.participants.find((item) => item.role === "strategist");
const architectFollowup = contextResult.handoff.followupSuggestions.find((item) => item.role === "architect");
const strategistFollowup = contextResult.handoff.followupSuggestions.find((item) => item.role === "strategist");

for (const field of ["branch", "branchGuard", "activeMode", "planTopic", "currentIssue", "handoff", "coordinationGroups", "tasksSummary"]) {
  assert.equal(Object.hasOwn(contextResult, field), true);
}
for (const field of ["policy", "canonicalReady", "panelMembership", "resumability", "followupSuggestions"]) {
  assert.equal(Object.hasOwn(contextResult.handoff, field), true);
}
for (const legacyField of ["howPanelRoles", "resumableParticipants", "followupReady", "suggestedFollowupRoles"]) {
  assert.equal(Object.hasOwn(contextResult.handoff, legacyField), false);
}

assert.equal(contextResult.branchGuard, true);
assert.equal(contextResult.planTopic, "Procedural parity");
assert.equal(contextResult.currentIssue.id, 1);
assert.equal(contextResult.handoff.policy, "canonical-first");
assert.equal(membershipRoles.includes("architect"), true);
assert.equal(membershipRoles.includes("strategist"), true);
assert.equal(Boolean(architectContinuity), true);
assert.equal(architectContinuity.task_id, "task-architect-1");
assert.equal(architectContinuity.session_id, "session-architect-1");
assert.equal(Boolean(strategistContinuity), false);
assert.equal(Boolean(architectFollowup), true);
assert.equal(architectFollowup.reason, "continuity");
assert.equal(Boolean(strategistFollowup), true);
assert.equal(strategistFollowup.reason, "summary-only");
assert.equal(resumeResult.role, "architect");
assert.equal(resumeResult.task_id, "task-architect-1");
assert.equal(resumeResult.session_id, "session-architect-1");
assert.equal(resumeResult.recommendation.mode, "resume-existing");
assert.match(resumeResult.recommendation.suggested_prompt, /justify the handoff rule/i);
assert.equal(
  strategistResumeResult,
  "No participant continuity found for strategist.",
  "plan sidecar membership should not make strategist resumable without orchestration continuity"
);
assert.equal(strategistFollowupResult.recommendation.mode, "rehydrate-from-summary");
assert.equal(strategistFollowupResult.delegation.resume_task_id, null);
assert.equal(strategistFollowupResult.delegation.resume_session_id, null);
assert.equal(followupResult.delegation.subagent_type, "architect");
assert.equal(followupResult.delegation.resume_task_id, "task-architect-1");
assert.equal(followupResult.recommendation.mode, "resume-existing");
assert.equal(contextResult.coordinationGroups.length > 0, true);
assert.equal(contextResult.coordinationGroups[0].label, "impl-group");

console.log("e2e context passed");
