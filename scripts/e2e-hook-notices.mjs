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

const naturalMeet = { parts: [{ type: "text", text: "회의로 먼저 방향을 정하자" }] };
await hooks["chat.message"]({ sessionID: "s1" }, naturalMeet);
assert.match(naturalMeet.parts.at(-1).text, /Meet mode detected/i);

await fs.writeFile(
  paths.MEET_FILE,
  JSON.stringify(
    {
      id: 1,
      topic: "Hook test",
      attendees: [{ role: "lead", name: "Lead", joined_at: new Date().toISOString() }],
      issues: [{ id: "issue-1", title: "Decide API shape", status: "pending", discussion: [] }],
      created_at: new Date().toISOString()
    },
    null,
    2
  ),
  "utf8"
);

const meetReminder = { parts: [{ type: "text", text: "계속 진행하자" }] };
await hooks["chat.message"]({ sessionID: "s2" }, meetReminder);
assert.match(meetReminder.parts.at(-1).text, /Meet session/i);
assert.match(meetReminder.parts.at(-1).text, /one-issue-at-a-time/i);
assert.match(meetReminder.parts.at(-1).text, /Do not open the next issue/i);

const attendeePrompt = { parts: [{ type: "text", text: "아키텍트 참석시켜" }] };
await hooks["chat.message"]({ sessionID: "s3" }, attendeePrompt);
assert.match(attendeePrompt.parts.at(-1).text, /nx_meet_join/);

const decidePrompt = { parts: [{ type: "text", text: "[d] 이걸로 결정하자" }] };
await hooks["chat.message"]({ sessionID: "s3b" }, decidePrompt);
assert.match(decidePrompt.parts.at(-1).text, /nx_meet_discuss/);

await fs.unlink(paths.MEET_FILE);
await fs.writeFile(
  paths.TASKS_FILE,
  JSON.stringify(
    {
      tasks: [
        {
          id: "task-1",
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

const taskReminder = { parts: [{ type: "text", text: "다음 작업 이어서 하자" }] };
await hooks["chat.message"]({ sessionID: "s4" }, taskReminder);
assert.match(taskReminder.parts.at(-1).text, /Active task cycle/i);
assert.match(taskReminder.parts.at(-1).text, /Resolve blocked tasks/i);

const runPrompt = { parts: [{ type: "text", text: "[run] 구현 계속해" }] };
await hooks["chat.message"]({ sessionID: "s5" }, runPrompt);
assert.match(runPrompt.parts.at(-1).text, /nx_briefing/);
assert.match(runPrompt.parts.at(-1).text, /Lead solo/i);

console.log("e2e hook notices passed");
