import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxPlanFollowup, nxPlanJoin, nxPlanResume, nxPlanStart } from "../dist/tools/plan.js";

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
    attendees: [{ role: "architect", name: "Architect" }],
    issues: ["Continuity source precedence"]
  },
  ctx
);
const startedParsed = JSON.parse(started);
assert.equal(startedParsed.created, true);

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

const sidecar = await readJson(paths.PLAN_SIDECAR_FILE);
const architect = sidecar.panel.participants.find((item) => item.role.toLowerCase() === "architect");
assert.ok(architect, "architect participant must exist in sidecar after plan start");
architect.task_id = "sidecar-task-architect-desync";
architect.session_id = "sidecar-session-architect-desync";
architect.updated_at = new Date().toISOString();
await fs.writeFile(paths.PLAN_SIDECAR_FILE, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");

await logState("after intentional sidecar desync", paths);

const resumeArchitect = parseToolJson(
  await nxPlanResume.execute(
    { role: "architect", question: "What continuity should we use now?" },
    ctx
  )
);
assert.equal(
  resumeArchitect.task_id,
  coreHandles.task_id,
  "nxPlanResume should prefer orchestration core task continuity over sidecar"
);
assert.equal(
  resumeArchitect.session_id,
  coreHandles.session_id,
  "nxPlanResume should prefer orchestration core session continuity over sidecar"
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

await nxPlanJoin.execute({ role: "strategist", name: "Strategist" }, ctx);
const sidecarWithStrategist = await readJson(paths.PLAN_SIDECAR_FILE);
const strategist = sidecarWithStrategist.panel.participants.find((item) => item.role.toLowerCase() === "strategist");
assert.ok(strategist, "strategist participant must exist in sidecar after joining plan");
strategist.task_id = "sidecar-task-strategist-only";
strategist.session_id = "sidecar-session-strategist-only";
strategist.updated_at = new Date().toISOString();
await fs.writeFile(paths.PLAN_SIDECAR_FILE, `${JSON.stringify(sidecarWithStrategist, null, 2)}\n`, "utf8");

await logState("after fallback sidecar continuity setup", paths);

const resumeStrategist = await nxPlanResume.execute(
  { role: "strategist", question: "Continue strategist thread" },
  ctx
);
assert.equal(
  resumeStrategist,
  "No participant continuity found for strategist.",
  "nxPlanResume should not resume from plan sidecar when orchestration has no continuity"
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
  "nxPlanFollowup should avoid resume-existing when continuity only exists in plan sidecar"
);
assert.equal(
  followupStrategist.delegation.resume_task_id,
  null,
  "nxPlanFollowup should not emit resume_task_id from sidecar-only continuity"
);
assert.equal(
  followupStrategist.delegation.resume_session_id,
  null,
  "nxPlanFollowup should not emit resume_session_id from sidecar-only continuity"
);

const sidecarProjection = await readJson(paths.PLAN_SIDECAR_FILE);
assert.ok(
  sidecarProjection.panel.participants.some((item) => item.role.toLowerCase() === "strategist"),
  "plan sidecar should still retain panel membership independently of resumability"
);

console.log("e2e plan continuity core-first passed");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function logState(label, paths) {
  const core = await readJson(paths.ORCHESTRATION_CORE_FILE);
  const sidecar = await readJson(paths.PLAN_SIDECAR_FILE);
  console.log(`[inspect:${label}] orchestration-core`);
  console.log(JSON.stringify(core, null, 2));
  console.log(`[inspect:${label}] plan-sidecar`);
  console.log(JSON.stringify(sidecar, null, 2));
}

function parseToolJson(value) {
  assert.equal(typeof value, "string", "tool result should be a JSON string");
  return JSON.parse(value);
}
