import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNexusPaths } from "../dist/shared/paths.js";

const corePath = "../dist/orchestration/core.js";
const storePath = "../dist/orchestration/core-store.js";
const core = await import(new URL(corePath, import.meta.url).href);
const store = await import(new URL(storePath, import.meta.url).href);

assert.equal(typeof core.applyRegisterStart, "function", "core must export applyRegisterStart");
assert.equal(typeof core.applyRegisterEnd, "function", "core must export applyRegisterEnd");
assert.equal(typeof core.pickContinuityFromState, "function", "core must export pickContinuityFromState");

const writeState =
  store.writeOrchestrationCoreState ?? core.writeOrchestrationState ?? core.writeOrchestrationCoreState ?? null;
const readState = store.readOrchestrationCoreState ?? core.readOrchestrationState ?? core.readOrchestrationCoreState ?? null;
const createState = store.createEmptyOrchestrationCoreState ?? core.createEmptyOrchestrationCoreState ?? null;

assert.equal(typeof writeState, "function", "persistence write helper must be available");
assert.equal(typeof readState, "function", "persistence read helper must be available");
assert.equal(typeof createState, "function", "state factory helper must be available");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-orch-persist-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const nexusPaths = createNexusPaths(root);
assert.equal(
  nexusPaths.ORCHESTRATION_CORE_FILE,
  path.join(root, ".nexus", "state", "orchestration.opencode.json"),
  "canonical orchestration state path should be .nexus/state/orchestration.opencode.json"
);

let state = createState("2026-04-02T00:00:00.000Z");
state = core.applyRegisterStart(
  state,
  {
    invocation_id: "persist-invocation",
    agent_type: "architect",
    coordination_label: "persist-team",
    purpose: "persist-case"
  },
  "2026-04-02T00:00:01.000Z"
).nextState;
state = core.applyRegisterEnd(
  state,
  {
    invocation_id: "persist-invocation",
    status: "completed",
    runtime_metadata: {
      task_id: "task-persist",
      session_id: "ses-persist",
      resume_task_id: "resume-task-persist",
      resume_session_id: "resume-ses-persist",
      resume_handles: {
        ticket: "persist-ticket",
        cursor: "persist-cursor"
      }
    }
  },
  "2026-04-02T00:00:02.000Z"
).nextState;

const file = path.join(root, "orchestration-core-state.json");
await writeState(file, state);
const restored = await readState(file);

const selected = core.pickContinuityFromState(restored, {
  agent_type: "architect",
  coordination_label: "persist-team"
});

const taskID = selected?.continuity?.child_task_id ?? null;
const sessionID = selected?.continuity?.child_session_id ?? null;

assert.equal(taskID, "task-persist", "persisted state should retain resumable task handle");
assert.equal(sessionID, "ses-persist", "persisted state should retain resumable session handle");

assert.equal(
  selected?.continuity?.resume_task_id,
  "resume-task-persist",
  "persisted state should retain resume task handle"
);
assert.equal(
  selected?.continuity?.resume_session_id,
  "resume-ses-persist",
  "persisted state should retain resume session handle"
);
assert.deepEqual(
  selected?.continuity?.resume_handles,
  {
    ticket: "persist-ticket",
    cursor: "persist-cursor"
  },
  "persisted state should retain resume handles"
);

const plan = core.buildDelegationPlanFromState(restored, {
  agent_type: "architect",
  coordination_label: "persist-team",
  purpose: "resume persisted"
});
assert.deepEqual(
  plan.adapter_hints.resume_handles,
  {
    ticket: "persist-ticket",
    cursor: "persist-cursor"
  },
  "delegation plan should preserve persisted resume handles"
);

console.log(`e2e orchestration core persistence passed (${storePath})`);
