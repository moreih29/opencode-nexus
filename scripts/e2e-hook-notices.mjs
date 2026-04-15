import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHooks } from "../dist/plugin/hooks.js";
import { createPluginState } from "../dist/plugin-state.js";
import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-notices-"));
await fs.mkdir(path.join(root, ".git"), { recursive: true });
await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");

const hooks = createHooks({ directory: root, worktree: root, state: createPluginState() });
const paths = createNexusPaths(root);
await ensureNexusStructure(paths);

async function systemMessagesFor(sessionID, text) {
  await hooks["chat.message"]({ sessionID }, { parts: [{ type: "text", text }] });
  const output = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID }, output);
  return output.system;
}

function includesLine(messages, pattern) {
  return messages.some((line) => pattern.test(line));
}

await fs.writeFile(
  paths.PLAN_FILE,
  JSON.stringify(
    {
      id: 1,
      topic: "Hook test",
      attendees: [{ role: "lead", name: "Lead", joined_at: new Date().toISOString() }],
      issues: [{ id: 1, title: "Decide API shape", status: "pending", discussion: [] }],
      created_at: new Date().toISOString()
    },
    null,
    2
  ),
  "utf8"
);

const planReminder = await systemMessagesFor("s2", "계속 진행하자");
assert.ok(includesLine(planReminder, /Plan .*active/i), "plan-state notice should be injected for active plan");

const attendeePrompt = await systemMessagesFor("s3", "아키텍트 참석시켜");
assert.ok(includesLine(attendeePrompt, /Attendee request detected/i), "attendee notice should be injected");

const decidePrompt = await systemMessagesFor("s3b", "[d] 이걸로 결정하자");
assert.ok(includesLine(decidePrompt, /Decision tag detected/i), "decision notice should be injected in decide mode");

await fs.unlink(paths.PLAN_FILE);
await fs.writeFile(
  paths.TASKS_FILE,
  JSON.stringify(
    {
      tasks: [
        {
          id: 1,
          title: "Implement hook parity",
          status: "blocked",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
    },
    null,
    2
  ),
  "utf8"
);

const taskReminder = await systemMessagesFor("s4", "다음 작업 이어서 하자");
assert.ok(includesLine(taskReminder, /Active task cycle detected/i), "task-cycle notice should be injected in idle mode");

const runPrompt = await systemMessagesFor("s5", "[run] 구현 계속해");
assert.ok(includesLine(runPrompt, /Active tasks:/i), "run-mode active-cycle notice should be injected");

await fs.writeFile(
  paths.TASKS_FILE,
  JSON.stringify(
    {
      tasks: [
        {
          id: 2,
          title: "Done",
          status: "completed",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
    },
    null,
    2
  ),
  "utf8"
);
const runCompleted = await systemMessagesFor("s6", "[run] 마무리하자");
assert.ok(includesLine(runCompleted, /All tasks completed/i), "completed-open run notice should be injected");

await fs.unlink(paths.TASKS_FILE);
await fs.writeFile(
  paths.PLAN_FILE,
  JSON.stringify(
    {
      id: 2,
      topic: "All complete plan",
      attendees: [{ role: "lead", name: "Lead", joined_at: new Date().toISOString() }],
      issues: [{ id: 1, title: "Finalized", status: "decided", discussion: [] }],
      created_at: new Date().toISOString()
    },
    null,
    2
  ),
  "utf8"
);
const allCompletePlan = await systemMessagesFor("s7", "계획 다 끝났어");
assert.ok(includesLine(allCompletePlan, /allComplete/i), "allComplete plan notice should be injected");
assert.ok(includesLine(allCompletePlan, /Step 7/i), "allComplete notice should hand off to Step 7");
assert.ok(includesLine(allCompletePlan, /nx_task_add/i), "allComplete notice should require nx_task_add");

console.log("e2e hook notices passed");
