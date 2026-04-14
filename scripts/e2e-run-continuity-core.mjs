import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-run-continuity-core-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const paths = createNexusPaths(root);
await ensureNexusStructure(paths);
await fs.writeFile(
  paths.TASKS_FILE,
  JSON.stringify(
    {
      tasks: [
        {
          id: "task-run-1",
          title: "Run continuity",
          status: "in_progress",
          owner: "engineer",
          plan_issue: 1,
          deps: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
    },
    null,
    2
  ) + "\n",
  "utf8"
);

const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });

const initialArgs = {
  subagent_type: "engineer",
  team_name: "impl-team",
  description: "Run continuity baseline"
};

const beforeNoCore = { args: { ...initialArgs } };
await hooks["tool.execute.before"]({ tool: "task" }, beforeNoCore);
assert.equal(beforeNoCore.args.resume_task_id, undefined, "no core continuity should not inject resume task");
assert.equal(beforeNoCore.args.resume_session_id, undefined, "no core continuity should not inject resume session");

await hooks["tool.execute.after"](
  { tool: "task", args: beforeNoCore.args },
  {
    title: "ok",
    output: "Engineer completed baseline run continuity",
    metadata: {
      task: { id: "core-task-old" },
      session: { session_id: "core-session-old" },
      resume_task_id: "core-resume-task-old",
      resume_session_id: "core-resume-session-old",
      resume_handles: {
        thread: "thread-old",
        cursor: "cursor-old"
      }
    }
  }
);

const beforeInjected = { args: { ...initialArgs } };
await hooks["tool.execute.before"]({ tool: "task" }, beforeInjected);
assert.equal(beforeInjected.args.resume_task_id, "core-task-old", "before hook should inject task handle from core");
assert.equal(
  beforeInjected.args.resume_session_id,
  "core-session-old",
  "before hook should inject session handle from core"
);
assert.deepEqual(
  beforeInjected.args.resume_handles,
  {
    thread: "thread-old",
    cursor: "cursor-old"
  },
  "before hook should forward resume handles from core when absent"
);

const explicitArgs = {
  ...initialArgs,
  resume_task_id: "explicit-task",
  resume_session_id: "explicit-session",
  resume_handles: {
    thread: "explicit-thread"
  }
};
const beforeExplicit = { args: { ...explicitArgs } };
await hooks["tool.execute.before"]({ tool: "task" }, beforeExplicit);
assert.equal(beforeExplicit.args.resume_task_id, "explicit-task", "explicit resume task arg should be preserved");
assert.equal(
  beforeExplicit.args.resume_session_id,
  "explicit-session",
  "explicit resume session arg should be preserved"
);
assert.deepEqual(
  beforeExplicit.args.resume_handles,
  {
    thread: "explicit-thread"
  },
  "explicit resume handles should be preserved"
);

const explicitAliasArgs = {
  ...initialArgs,
  resumeTaskId: "alias-task",
  resumeSessionId: "alias-session",
  resumeHandles: {
    thread: "alias-thread"
  }
};
const beforeExplicitAlias = { args: { ...explicitAliasArgs } };
await hooks["tool.execute.before"]({ tool: "task" }, beforeExplicitAlias);
assert.equal(beforeExplicitAlias.args.resumeTaskId, "alias-task", "camelCase task alias should be preserved");
assert.equal(beforeExplicitAlias.args.resumeSessionId, "alias-session", "camelCase session alias should be preserved");
assert.deepEqual(
  beforeExplicitAlias.args.resumeHandles,
  {
    thread: "alias-thread"
  },
  "camelCase resume handles alias should be preserved"
);
assert.equal(
  beforeExplicitAlias.args.resume_task_id,
  undefined,
  "snake_case task injection should not be added when camelCase alias is already present"
);
assert.equal(
  beforeExplicitAlias.args.resume_session_id,
  undefined,
  "snake_case session injection should not be added when camelCase alias is already present"
);
assert.equal(
  beforeExplicitAlias.args.resume_handles,
  undefined,
  "snake_case handles injection should not be added when camelCase alias is already present"
);

const beforeDifferentTeam = {
  args: {
    subagent_type: "engineer",
    team_name: "impl-team-2",
    description: "Run continuity fallback by agent"
  }
};
await hooks["tool.execute.before"]({ tool: "task" }, beforeDifferentTeam);
assert.equal(
  beforeDifferentTeam.args.resume_task_id,
  "core-task-old",
  "team label should remain grouping policy; continuity falls back by agent"
);
assert.equal(beforeDifferentTeam.args.resume_session_id, "core-session-old");

const beforeOtherAgent = {
  args: {
    subagent_type: "tester",
    team_name: "impl-team",
    description: "No continuity for tester yet"
  }
};
await hooks["tool.execute.before"]({ tool: "task" }, beforeOtherAgent);
assert.equal(beforeOtherAgent.args.resume_task_id, undefined, "continuity should not cross agent identity");
assert.equal(beforeOtherAgent.args.resume_session_id, undefined, "continuity should not cross agent identity");

await inspectState(paths, "core");

console.log("e2e run continuity core passed");

async function inspectState(paths, label) {
  const toolLog = await fs.readFile(paths.TOOL_LOG_FILE, "utf8");
  const tracker = JSON.parse(await fs.readFile(paths.AGENT_TRACKER_FILE, "utf8"));

  assert.equal(Array.isArray(tracker.invocations), true, "agent tracker should be inspectable");
  assert.equal(typeof toolLog, "string", "tool-log file should exist and be readable");

  const injectedInvocation = tracker.invocations.find(
    (inv) =>
      inv.agent_type === "engineer" &&
      inv.continuity?.child_task_id === "core-task-old" &&
      inv.continuity?.child_session_id === "core-session-old" &&
      inv.continuity?.resume_handles?.thread === "thread-old"
  );
  assert.ok(injectedInvocation, "agent tracker should have invocation with injected continuity args");

  console.log(`[inspect:${label}] agent-tracker`);
  console.log(JSON.stringify(tracker, null, 2));
  console.log(`[inspect:${label}] tool-log`);
  console.log(toolLog);
}

