import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxPlanStart } from "../dist/tools/plan.js";
import { nxTaskClose } from "../dist/tools/task.js";

async function makeRoot(suffix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `opencode-nexus-plan-defaults-${suffix}-`));
  await fs.mkdir(path.join(root, ".git"), { recursive: true });
  await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");
  return root;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

let passCount = 0;
function pass(label) {
  console.log(`  PASS: ${label}`);
  passCount += 1;
}

// Case 1: canonical fields present — {id, topic, issues, research_summary, created_at}
{
  const root = await makeRoot("case1");
  const ctx = { directory: root, worktree: root };
  const paths = createNexusPaths(root);
  await ensureNexusStructure(paths);

  const result = JSON.parse(
    await nxPlanStart.execute(
      {
        topic: "Canonical fields test",
        research_summary: "Verifying all canonical fields are present.",
        issues: ["First issue", "Second issue"]
      },
      ctx
    )
  );
  assert.equal(result.created, true, "case1: created should be true");
  assert.equal(result.issueCount, 2, "case1: issueCount should be 2");
  assert.equal(typeof result.plan_id, "number", "case1: plan_id should be a number");
  assert.equal(result.topic, "Canonical fields test", "case1: topic in result");
  pass("case1: nxPlanStart result has created, issueCount, plan_id, topic");

  const plan = await readJson(paths.PLAN_FILE);
  assert.equal(typeof plan.id, "number", "case1: plan.id is a number");
  assert.equal(plan.topic, "Canonical fields test", "case1: plan.topic");
  assert.equal(plan.research_summary, "Verifying all canonical fields are present.", "case1: plan.research_summary");
  assert.equal(typeof plan.created_at, "string", "case1: plan.created_at is a string");
  assert.equal(Array.isArray(plan.issues), true, "case1: plan.issues is array");
  assert.equal(plan.issues.length, 2, "case1: issues length is 2");
  assert.equal(Object.hasOwn(plan, "attendees"), false, "case1: no attendees field in new write");
  pass("case1: plan.json has all canonical fields, no attendees");
}

// Case 2: issues default status is 'pending'
{
  const root = await makeRoot("case2");
  const ctx = { directory: root, worktree: root };
  const paths = createNexusPaths(root);
  await ensureNexusStructure(paths);

  await nxPlanStart.execute(
    {
      topic: "Issue status test",
      research_summary: "Verifying default issue status.",
      issues: ["Alpha", "Beta", "Gamma"]
    },
    ctx
  );

  const plan = await readJson(paths.PLAN_FILE);
  assert.equal(plan.issues.length, 3, "case2: 3 issues written");
  for (const issue of plan.issues) {
    assert.equal(issue.status, "pending", `case2: issue ${issue.id} status should be pending`);
    assert.equal(typeof issue.id, "number", `case2: issue ${issue.id} has numeric id`);
    assert.equal(typeof issue.title, "string", `case2: issue ${issue.id} has string title`);
  }
  assert.equal(plan.issues[0].id, 1, "case2: first issue id is 1");
  assert.equal(plan.issues[1].id, 2, "case2: second issue id is 2");
  assert.equal(plan.issues[2].id, 3, "case2: third issue id is 3");
  pass("case2: all issues default to status='pending' with sequential ids");
}

// Case 3: issues omitted → empty array; issueCount is 0
{
  const root = await makeRoot("case3");
  const ctx = { directory: root, worktree: root };
  const paths = createNexusPaths(root);
  await ensureNexusStructure(paths);

  const result = JSON.parse(
    await nxPlanStart.execute(
      {
        topic: "No issues test",
        research_summary: "Verifying empty issues default."
      },
      ctx
    )
  );
  assert.equal(result.created, true, "case3: created should be true");
  assert.equal(result.issueCount, 0, "case3: issueCount should be 0 when issues omitted");

  const plan = await readJson(paths.PLAN_FILE);
  assert.deepEqual(plan.issues, [], "case3: issues should be empty array when omitted");
  assert.equal(Object.hasOwn(plan, "attendees"), false, "case3: no attendees field");
  pass("case3: omitting issues produces empty array and issueCount=0");
}

// Case 4: plan_id increments — second plan after archive gets id 2
{
  const root = await makeRoot("case4");
  const ctx = { directory: root, worktree: root };
  const paths = createNexusPaths(root);
  await ensureNexusStructure(paths);

  const first = JSON.parse(
    await nxPlanStart.execute(
      { topic: "First plan", research_summary: "First." },
      ctx
    )
  );
  assert.equal(first.plan_id, 1, "case4: first plan_id is 1");
  pass("case4: first nxPlanStart gets plan_id=1");

  // Archive the first plan cycle so history records plan id=1
  await nxTaskClose.execute({}, { ...ctx, agent: "nexus" });

  const second = JSON.parse(
    await nxPlanStart.execute(
      { topic: "Second plan", research_summary: "Second." },
      ctx
    )
  );
  assert.equal(second.plan_id, 2, "case4: second plan_id increments to 2");
  pass("case4: second nxPlanStart after archive gets plan_id=2 (increment)");

  const plan2 = await readJson(paths.PLAN_FILE);
  assert.equal(plan2.id, 2, "case4: plan.json id is 2 for second plan");
  assert.equal(plan2.topic, "Second plan", "case4: plan.json topic is updated");
  pass("case4: plan.json reflects second plan after start-over");
}

// Case 5: legacy plan.extension.json sidecar is not created on nxPlanStart
{
  const root = await makeRoot("case5");
  const ctx = { directory: root, worktree: root };
  const paths = createNexusPaths(root);
  await ensureNexusStructure(paths);

  await nxPlanStart.execute(
    {
      topic: "Sidecar init test",
      research_summary: "Verifying no legacy sidecar file is created.",
      issues: ["Check legacy sidecar removal"]
    },
    ctx
  );

  const legacySidecarPath = path.join(root, ".nexus", "state", "opencode-nexus", "plan.extension.json");
  await assert.rejects(
    fs.access(legacySidecarPath),
    { code: "ENOENT" },
    "case5: legacy plan.extension.json sidecar must not be written"
  );
  pass("case5: nxPlanStart does not create legacy plan.extension.json sidecar");
}

console.log(`e2e plan-start-defaults passed (${passCount} assertions)`);
