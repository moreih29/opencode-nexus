import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNexusPaths } from "../dist/shared/paths.js";

const trackerPath = "../dist/shared/agent-tracker.js";
const core = await import(new URL(trackerPath, import.meta.url).href);

assert.equal(typeof core.applyInvocationStart, "function", "core must export applyInvocationStart");
assert.equal(typeof core.applyInvocationEnd, "function", "core must export applyInvocationEnd");
assert.equal(typeof core.pickContinuityFromTrackerState, "function", "core must export pickContinuityFromTrackerState");

const writeState = core.writeAgentTracker ?? null;
const readState = core.readAgentTracker ?? null;
const createState = core.createEmptyAgentTracker ?? null;

assert.equal(typeof writeState, "function", "persistence write helper must be available");
assert.equal(typeof readState, "function", "persistence read helper must be available");
assert.equal(typeof createState, "function", "state factory helper must be available");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-orch-persist-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const nexusPaths = createNexusPaths(root);
assert.equal(
  nexusPaths.AGENT_TRACKER_FILE,
  path.join(root, ".nexus", "state", "opencode-nexus", "agent-tracker.json"),
  "canonical agent tracker state path should be .nexus/state/opencode-nexus/agent-tracker.json"
);

let state = createState("2026-04-02T00:00:00.000Z");
state = core.applyInvocationStart(
  state,
  {
    invocation_id: "persist-invocation",
    agent_type: "architect",
    coordination_label: "persist-team",
    purpose: "persist-case"
  },
  "2026-04-02T00:00:01.000Z"
);
state = core.applyInvocationEnd(
  state,
  "persist-invocation",
  {
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
);

const file = path.join(root, "agent-tracker.json");
await writeState(file, state);
const restored = await readState(file);

const selected = core.pickContinuityFromTrackerState(restored, {
  agent_type: "architect",
  coordination_label: "persist-team"
});

const taskID = selected?.child_task_id ?? null;
const sessionID = selected?.child_session_id ?? null;

assert.equal(taskID, "task-persist", "persisted state should retain resumable task handle");
assert.equal(sessionID, "ses-persist", "persisted state should retain resumable session handle");

assert.equal(
  selected?.resume_task_id,
  "resume-task-persist",
  "persisted state should retain resume task handle"
);
assert.equal(
  selected?.resume_session_id,
  "resume-ses-persist",
  "persisted state should retain resume session handle"
);
assert.deepEqual(
  selected?.resume_handles,
  {
    ticket: "persist-ticket",
    cursor: "persist-cursor"
  },
  "persisted state should retain resume handles"
);

const plan = core.buildDelegationPlanFromTracker(restored, {
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

console.log(`e2e orchestration core persistence passed (${trackerPath})`);
