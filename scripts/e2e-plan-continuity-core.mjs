import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxPlanDecide, nxPlanFollowup, nxPlanResume, nxPlanStart } from "../dist/tools/plan.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-plan-core-first-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const ctx = { directory: root, worktree: root };
const paths = createNexusPaths(root);
await ensureNexusStructure(paths);

const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });

const started = await nxPlanStart.execute(
  {
    topic: "Core continuity precedence",
    research_summary: "Validate continuity source ordering.",
    issues: ["Continuity source precedence"]
  },
  ctx
);
const startedParsed = JSON.parse(started);
assert.equal(startedParsed.created, true);

// Register architect as HOW panel participant via how_agent_ids
await nxPlanDecide.execute(
  {
    issue_id: 1,
    decision: "Continuity source ordering confirmed.",
    how_agent_ids: { architect: "ses_arch_pre_hook" }
  },
  ctx
);

const delegationArgs = {
  subagent_type: "architect",
  team_name: "plan-panel",
  description: "Validate continuity precedence"
};

const coreHandles = {
  task_id: "core-task-architect-1",
  session_id: "ses_core_architect_1",
  resume_task_id: "core-resume-task-architect-1",
  resume_session_id: "ses_core_resume_architect_1"
};

await hooks["tool.execute.before"]({ tool: "task" }, { args: delegationArgs });
await hooks["tool.execute.after"](
  { tool: "task", args: delegationArgs },
  {
    title: "ok",
    output: "Architect completed continuity review.",
    metadata: {
      task: { id: coreHandles.task_id },
      session: { session_id: coreHandles.session_id },
      resume_task_id: coreHandles.resume_task_id,
      resume_session_id: coreHandles.resume_session_id
    }
  }
);

await logState("after hook completion", paths);

const resumeArchitect = parseToolJson(
  await nxPlanResume.execute(
    { role: "architect", question: "What continuity should we use now?" },
    ctx
  )
);
assert.equal(
  resumeArchitect.task_id,
  coreHandles.task_id,
  "nxPlanResume should prefer orchestration core task continuity over stale participant hints"
);
assert.equal(
  resumeArchitect.session_id,
  coreHandles.session_id,
  "nxPlanResume should prefer orchestration core session continuity over stale participant hints"
);
assert.equal(
  resumeArchitect.opencode_task_tool_resume_handle,
  coreHandles.session_id,
  "nxPlanResume should expose the OpenCode task-tool resume handle explicitly"
);

const followupArchitect = parseToolJson(
  await nxPlanFollowup.execute(
    {
      role: "architect",
      question: "Continue continuity validation",
      issue_id: 1
    },
    ctx
  )
);
assert.equal(
  followupArchitect.delegation.resume_task_id,
  coreHandles.task_id,
  "nxPlanFollowup should emit core task continuity for delegation"
);
assert.equal(
  followupArchitect.delegation.resume_session_id,
  coreHandles.session_id,
  "nxPlanFollowup should emit core session continuity for delegation"
);
assert.equal(
  followupArchitect.delegation.opencode_task_tool_resume_handle,
  coreHandles.session_id,
  "nxPlanFollowup should expose an explicit OpenCode task-tool resume handle"
);

// Register strategist as HOW panel participant via how_agent_ids on the issue
await nxPlanDecide.execute(
  {
    issue_id: 1,
    decision: "Continuity source ordering confirmed.",
    how_agent_ids: { strategist: "ses_strategist_init" }
  },
  ctx
);

await hooks["tool.execute.before"](
  { tool: "task" },
  { args: { subagent_type: "strategist", team_name: "plan-panel", description: "Review continuity summary" } }
);
await hooks["tool.execute.after"](
  { tool: "task", args: { subagent_type: "strategist", team_name: "plan-panel" } },
  { title: "ok", output: "Strategist reviewed the continuity trade-offs.", metadata: null }
);

await logState("after strategist summary-only setup", paths);

const resumeStrategist = await nxPlanResume.execute(
  { role: "strategist", question: "Continue strategist thread" },
  ctx
);
assert.equal(
  resumeStrategist,
  "No participant continuity found for strategist.",
  "nxPlanResume should not resume when tracker has no continuity handles"
);

const followupStrategist = parseToolJson(
  await nxPlanFollowup.execute(
    {
      role: "strategist",
      question: "Continue strategist thread",
      issue_id: 1
    },
    ctx
  )
);
assert.equal(
  followupStrategist.recommendation.mode,
  "rehydrate-from-summary",
  "nxPlanFollowup should avoid resume-existing when only summary context exists"
);
assert.equal(
  followupStrategist.delegation.resume_task_id,
  null,
  "nxPlanFollowup should not emit resume_task_id without continuity handles"
);
assert.equal(
  followupStrategist.delegation.resume_session_id,
  null,
  "nxPlanFollowup should not emit resume_session_id without continuity handles"
);

console.log("e2e plan continuity core-first passed");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function logState(label, paths) {
  const core = await readJson(paths.AGENT_TRACKER_FILE);
  console.log(`[inspect:${label}] orchestration-core`);
  console.log(JSON.stringify(core, null, 2));
}

function parseToolJson(value) {
  assert.equal(typeof value, "string", "tool result should be a JSON string");
  return JSON.parse(value);
}
