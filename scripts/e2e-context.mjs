import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxMeetFollowup, nxMeetJoin, nxMeetResume } from "../dist/tools/meet.js";
import { nxContext } from "../dist/tools/context.js";
import { nxTaskAdd } from "../dist/tools/task.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-context-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");

const paths = createNexusPaths(root);
await ensureNexusStructure(paths);
const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });
await fs.writeFile(
  paths.MEET_FILE,
  JSON.stringify(
    {
      id: 1,
      topic: "Procedural parity",
      attendees: [{ role: "lead", name: "Lead", joined_at: new Date().toISOString() }],
      issues: [{ id: "issue-1", title: "Plan run workflow", status: "pending", discussion: [] }],
      created_at: new Date().toISOString()
    },
    null,
    2
  ),
  "utf8"
);

const ctx = { directory: root, worktree: root };
await nxMeetJoin.execute({ role: "architect", name: "Architect" }, ctx);
const addResult = await nxTaskAdd.execute({ title: "Implement workflow" }, ctx);
assert.match(addResult, /Link this task to its meet issue/);

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
  { args: { subagent_type: "architect", team_name: "meet-panel", description: "review compatibility" } }
);
await hooks["tool.execute.after"](
  { tool: "task", args: { subagent_type: "architect", team_name: "meet-panel" } },
  { title: "ok", output: "Prefer canonical-first handoff.", metadata: { task_id: "task-architect-1", session_id: "session-architect-1" } }
);

const contextResult = JSON.parse(await nxContext.execute({}, ctx));
const resumeResult = JSON.parse(await nxMeetResume.execute({ role: "architect", question: "Can you justify the handoff rule?" }, ctx));
const followupResult = JSON.parse(await nxMeetFollowup.execute({ role: "architect", question: "Can you justify the handoff rule?" }, ctx));
assert.equal(contextResult.branchGuard, true);
assert.equal(contextResult.meetTopic, "Procedural parity");
assert.equal(contextResult.currentIssue.id, "issue-1");
assert.equal(contextResult.handoff.policy, "canonical-first");
assert.equal(contextResult.handoff.howPanelRoles.includes("architect"), true);
assert.equal(contextResult.handoff.followupReady, true);
assert.equal(contextResult.handoff.suggestedFollowupRoles.includes("architect"), true);
assert.equal(contextResult.handoff.resumableParticipants[0].role, "architect");
assert.equal(contextResult.handoff.resumableParticipants[0].task_id, "task-architect-1");
assert.equal(resumeResult.role, "architect");
assert.equal(resumeResult.task_id, "task-architect-1");
assert.equal(resumeResult.session_id, "session-architect-1");
assert.equal(resumeResult.recommendation.mode, "resume-existing");
assert.match(resumeResult.recommendation.suggested_prompt, /justify the handoff rule/i);
assert.equal(followupResult.delegation.subagent_type, "architect");
assert.equal(followupResult.delegation.resume_task_id, "task-architect-1");
assert.equal(followupResult.recommendation.mode, "resume-existing");
assert.equal(contextResult.coordinationGroups.length > 0, true);
assert.equal(contextResult.coordinationGroups[0].label, "impl-group");

console.log("e2e context passed");
