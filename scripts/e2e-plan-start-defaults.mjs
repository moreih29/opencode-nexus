import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxPlanStart } from "../dist/tools/plan.js";

async function makeRoot(suffix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `opencode-nexus-plan-defaults-${suffix}-`));
  await fs.mkdir(path.join(root, ".git"), { recursive: true });
  await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");
  return root;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

// Case 1: explicit attendees + issues arrays
{
  const root = await makeRoot("case1");
  const ctx = { directory: root, worktree: root };
  const paths = createNexusPaths(root);
  await ensureNexusStructure(paths);

  const result = JSON.parse(
    await nxPlanStart.execute(
      {
        topic: "Explicit arrays test",
        research_summary: "Testing explicit attendees and issues arrays.",
        attendees: [{ role: "architect", name: "Architect" }],
        issues: ["First issue", "Second issue"]
      },
      ctx
    )
  );
  assert.equal(result.created, true, "case1: created should be true");
  assert.equal(result.issueCount, 2, "case1: issueCount should be 2");

  const plan = await readJson(paths.PLAN_FILE);
  assert.equal(plan.attendees.length, 1, "case1: attendees length should be 1");
  assert.equal(plan.issues.length, 2, "case1: issues length should be 2");
}

// Case 2: empty arrays explicitly passed
{
  const root = await makeRoot("case2");
  const ctx = { directory: root, worktree: root };
  const paths = createNexusPaths(root);
  await ensureNexusStructure(paths);

  const result = JSON.parse(
    await nxPlanStart.execute(
      {
        topic: "Empty arrays test",
        research_summary: "Testing empty attendees and issues arrays.",
        attendees: [],
        issues: []
      },
      ctx
    )
  );
  assert.equal(result.created, true, "case2: created should be true");

  const plan = await readJson(paths.PLAN_FILE);
  assert.deepEqual(plan.attendees, [], "case2: attendees should be empty array");
  assert.deepEqual(plan.issues, [], "case2: issues should be empty array");
}

// Case 3: attendees and issues keys omitted entirely
{
  const root = await makeRoot("case3");
  const ctx = { directory: root, worktree: root };
  const paths = createNexusPaths(root);
  await ensureNexusStructure(paths);

  const result = JSON.parse(
    await nxPlanStart.execute(
      {
        topic: "Omitted keys test",
        research_summary: "Testing omitted attendees and issues keys."
      },
      ctx
    )
  );
  assert.equal(result.created, true, "case3: created should be true");

  const plan = await readJson(paths.PLAN_FILE);
  assert.deepEqual(plan.attendees, [], "case3: attendees should be empty array");
  assert.deepEqual(plan.issues, [], "case3: issues should be empty array");
}

// Case 4: attendees provided, issues omitted (and reverse)
{
  const root = await makeRoot("case4a");
  const ctx = { directory: root, worktree: root };
  const paths = createNexusPaths(root);
  await ensureNexusStructure(paths);

  const result = JSON.parse(
    await nxPlanStart.execute(
      {
        topic: "Attendees only test",
        research_summary: "Testing attendees provided but issues omitted.",
        attendees: [{ role: "engineer", name: "Engineer" }]
      },
      ctx
    )
  );
  assert.equal(result.created, true, "case4a: created should be true");

  const plan = await readJson(paths.PLAN_FILE);
  assert.equal(plan.attendees.length, 1, "case4a: attendees length should be 1");
  assert.deepEqual(plan.issues, [], "case4a: issues should be empty array");
}

{
  const root = await makeRoot("case4b");
  const ctx = { directory: root, worktree: root };
  const paths = createNexusPaths(root);
  await ensureNexusStructure(paths);

  const result = JSON.parse(
    await nxPlanStart.execute(
      {
        topic: "Issues only test",
        research_summary: "Testing issues provided but attendees omitted.",
        issues: ["Only issue"]
      },
      ctx
    )
  );
  assert.equal(result.created, true, "case4b: created should be true");

  const plan = await readJson(paths.PLAN_FILE);
  assert.deepEqual(plan.attendees, [], "case4b: attendees should be empty array");
  assert.equal(plan.issues.length, 1, "case4b: issues length should be 1");
}

console.log("e2e plan-start-defaults passed");
