import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { applyRegisterEnd, applyRegisterStart, createEmptyOrchestrationCoreState } from "../dist/orchestration/core.js";
import { writeOrchestrationCoreState } from "../dist/orchestration/core-store.js";
import { readPlanParticipantContinuityFromCore } from "../dist/orchestration/plan-continuity-adapter.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-orch-filename-migrate-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");
await fs.mkdir(path.join(root, ".nexus", "state"), { recursive: true });

const canonicalPath = path.join(root, ".nexus", "state", "orchestration.opencode.json");
const legacyPath = path.join(root, ".nexus", "state", "orchestration-core.v1.json");

let state = createEmptyOrchestrationCoreState("2026-04-02T00:00:00.000Z");
state = applyRegisterStart(
  state,
  {
    invocation_id: "legacy-only",
    agent_type: "architect",
    coordination_label: "plan-panel",
    purpose: "legacy-compat"
  },
  "2026-04-02T00:00:01.000Z"
).nextState;
state = applyRegisterEnd(
  state,
  {
    invocation_id: "legacy-only",
    status: "completed",
    runtime_metadata: {
      task_id: "legacy-task-1",
      session_id: "legacy-session-1"
    }
  },
  "2026-04-02T00:00:02.000Z"
).nextState;

await writeOrchestrationCoreState(legacyPath, state);
await fs.rm(canonicalPath, { force: true });

const architect = await readPlanParticipantContinuityFromCore(canonicalPath, "architect");
assert.equal(
  architect,
  null,
  "legacy orchestration filename should no longer provide continuity when canonical path is missing"
);

console.log("e2e orchestration filename migration passed");
