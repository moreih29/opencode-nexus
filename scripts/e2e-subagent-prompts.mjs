import assert from "node:assert/strict";

import { AGENT_PROMPTS } from "../dist/agents/prompts.js";
import { AGENT_META } from "../dist/agents/generated/index.js";
const NEXUS_AGENT_CATALOG = Object.values(AGENT_META);
import { NEXUS_PRIMARY_AGENT_ID, NEXUS_PRIMARY_PROMPT } from "../dist/agents/primary.js";
import { createConfigHook } from "../dist/create-config.js";

const EXPECTED_SUBAGENT_IDS = [
  "architect",
  "designer",
  "postdoc",
  "strategist",
  "engineer",
  "researcher",
  "writer",
  "tester",
  "reviewer"
];

let passed = 0;

// Case 1: createConfigHook runs without error and populates config.agent
{
  const hook = createConfigHook();
  const config = {};
  await hook(config);

  assert.ok(
    config.agent && typeof config.agent === "object",
    "[1] config.agent should be a non-null object after hook"
  );
  passed++;
  console.log("PASS [1] createConfigHook populates config.agent");
}

// Case 2-3: Each of 9 subagent IDs has agent entry + non-empty prompt matching AGENT_PROMPTS
{
  const hook = createConfigHook();
  const config = {};
  await hook(config);

  for (const id of EXPECTED_SUBAGENT_IDS) {
    const entry = config.agent[id];
    assert.ok(
      entry !== undefined && entry !== null,
      `[2] config.agent["${id}"] should exist`
    );
    assert.equal(
      typeof entry.prompt,
      "string",
      `[2] config.agent["${id}"].prompt should be a string`
    );
    assert.ok(
      entry.prompt.length > 0,
      `[2] config.agent["${id}"].prompt should not be empty`
    );
    assert.equal(
      entry.prompt,
      AGENT_PROMPTS[id],
      `[3] config.agent["${id}"].prompt should byte-match AGENT_PROMPTS["${id}"]`
    );
  }
  passed++;
  console.log(`PASS [2] all ${EXPECTED_SUBAGENT_IDS.length} subagents have non-empty prompt field`);
  passed++;
  console.log(`PASS [3] all ${EXPECTED_SUBAGENT_IDS.length} subagent prompts byte-match AGENT_PROMPTS`);
}

// Case 4: Primary "nexus" agent registered with NEXUS_PRIMARY_PROMPT
{
  const hook = createConfigHook();
  const config = {};
  await hook(config);

  const primaryEntry = config.agent[NEXUS_PRIMARY_AGENT_ID];
  assert.ok(
    primaryEntry !== undefined && primaryEntry !== null,
    `[4] config.agent["${NEXUS_PRIMARY_AGENT_ID}"] should exist`
  );
  assert.equal(
    primaryEntry.prompt,
    NEXUS_PRIMARY_PROMPT,
    `[4] Primary nexus agent prompt should match NEXUS_PRIMARY_PROMPT`
  );
  passed++;
  console.log(`PASS [4] primary "${NEXUS_PRIMARY_AGENT_ID}" agent registered with correct NEXUS_PRIMARY_PROMPT`);
}

// Case 5: User-predefined agent is preserved (not overwritten)
{
  const hook = createConfigHook();
  const userCustomPrompt = "custom-user-prompt";
  const config = {
    agent: {
      engineer: {
        prompt: userCustomPrompt,
        mode: "subagent"
      }
    }
  };
  await hook(config);

  assert.equal(
    config.agent.engineer.prompt,
    userCustomPrompt,
    `[5] User-predefined engineer prompt should be preserved, not overwritten`
  );
  // mode should also be preserved
  assert.equal(
    config.agent.engineer.mode,
    "subagent",
    `[5] User-predefined engineer mode should be preserved`
  );
  passed++;
  console.log("PASS [5] user-predefined agent config is preserved by createConfigHook");
}

// Sanity: total agent count = 9 subagents + 1 primary
{
  const hook = createConfigHook();
  const config = {};
  await hook(config);

  const totalAgents = Object.keys(config.agent).length;
  const expectedTotal = EXPECTED_SUBAGENT_IDS.length + 1; // +1 for nexus primary
  assert.equal(
    totalAgents,
    expectedTotal,
    `[sanity] Expected ${expectedTotal} agents total, got ${totalAgents}`
  );
}

// Case 6: task and nx_task_close must be hidden from all subagents
{
  const hook = createConfigHook();
  const config = {};
  await hook(config);

  for (const id of EXPECTED_SUBAGENT_IDS) {
    const entry = config.agent[id];
    assert.equal(
      entry?.tools?.task,
      false,
      `[6] config.agent["${id}"].tools.task should be false`
    );
    assert.equal(
      entry?.tools?.nx_task_close,
      false,
      `[6] config.agent["${id}"].tools.nx_task_close should be false`
    );
  }

  passed++;
  console.log(`PASS [6] all ${EXPECTED_SUBAGENT_IDS.length} subagents disallow task and nx_task_close`);
}

// Case 7: Partial subagent override receives additive defaults and merged tools
{
  const hook = createConfigHook();
  const config = {
    agent: {
      engineer: {
        mode: "custom-subagent-mode",
        model: "custom-model",
        tools: {
          bash: true,
          task: true,
          nx_task_close: true
        }
      }
    }
  };
  await hook(config);

  const engineer = config.agent.engineer;
  assert.equal(engineer.mode, "custom-subagent-mode", `[7] engineer.mode should preserve user value`);
  assert.equal(engineer.model, "custom-model", `[7] engineer.model should preserve user value`);
  assert.equal(engineer.prompt, AGENT_PROMPTS.engineer, `[7] engineer.prompt should be backfilled from defaults`);
  assert.equal(typeof engineer.description, "string", `[7] engineer.description should be backfilled`);
  assert.ok(engineer.description.length > 0, `[7] engineer.description should not be empty`);
  assert.equal(engineer.tools.bash, true, `[7] engineer.tools should preserve user-specified keys`);
  assert.equal(engineer.tools.task, false, `[7] engineer.tools.task should be enforced to false`);
  assert.equal(engineer.tools.nx_task_close, false, `[7] engineer.tools.nx_task_close should be enforced to false`);

  passed++;
  console.log("PASS [7] partial subagent override is additive-merged with enforced task guards");
}

console.log(`\n✓ e2e-subagent-prompts.mjs: ${passed} cases passed`);
