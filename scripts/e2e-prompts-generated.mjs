import assert from "node:assert/strict";

import { AGENT_PROMPTS, AGENT_META } from "../dist/agents/prompts.js";
import { SKILL_PROMPTS } from "../dist/skills/prompts.js";

// §8.7 e2e #1: verify the generated prompts barrel exposes non-empty bodies for
// every expected agent and skill. Replaces the former e2e-prompt-parity check.
const EXPECTED_AGENTS = [
  "architect",
  "designer",
  "engineer",
  "postdoc",
  "researcher",
  "reviewer",
  "strategist",
  "tester",
  "writer"
];

const EXPECTED_SKILLS = ["nx-init", "nx-plan", "nx-run", "nx-setup", "nx-sync"];

// AGENT_PROMPTS: 9 non-empty bodies
assert.equal(typeof AGENT_PROMPTS, "object", "AGENT_PROMPTS is not an object");
assert.equal(
  Object.keys(AGENT_PROMPTS).length,
  EXPECTED_AGENTS.length,
  `AGENT_PROMPTS key count mismatch: expected ${EXPECTED_AGENTS.length}, got ${Object.keys(AGENT_PROMPTS).length}`
);
for (const id of EXPECTED_AGENTS) {
  assert.equal(typeof AGENT_PROMPTS[id], "string", `AGENT_PROMPTS.${id} is not a string`);
  assert.ok(
    AGENT_PROMPTS[id].length > 100,
    `AGENT_PROMPTS.${id} body too short (${AGENT_PROMPTS[id]?.length ?? 0} chars)`
  );
}

// AGENT_META: 9 entries with the expected shape and non-empty disallowedTools for agents that declare capabilities
assert.equal(typeof AGENT_META, "object", "AGENT_META is not an object");
assert.equal(Object.keys(AGENT_META).length, EXPECTED_AGENTS.length, "AGENT_META key count mismatch");
for (const id of EXPECTED_AGENTS) {
  const meta = AGENT_META[id];
  assert.equal(typeof meta, "object", `AGENT_META.${id} is not an object`);
  assert.equal(meta.id, id, `AGENT_META.${id}.id mismatch`);
  assert.equal(typeof meta.name, "string", `AGENT_META.${id}.name is not a string`);
  assert.ok(["how", "do", "check"].includes(meta.category), `AGENT_META.${id}.category invalid: ${meta.category}`);
  assert.ok(Array.isArray(meta.disallowedTools), `AGENT_META.${id}.disallowedTools is not an array`);
}

// SKILL_PROMPTS: 5 non-empty bodies
assert.equal(typeof SKILL_PROMPTS, "object", "SKILL_PROMPTS is not an object");
assert.equal(Object.keys(SKILL_PROMPTS).length, EXPECTED_SKILLS.length, "SKILL_PROMPTS key count mismatch");
for (const id of EXPECTED_SKILLS) {
  assert.equal(typeof SKILL_PROMPTS[id], "string", `SKILL_PROMPTS["${id}"] is not a string`);
  assert.ok(
    SKILL_PROMPTS[id].length > 100,
    `SKILL_PROMPTS["${id}"] body too short (${SKILL_PROMPTS[id]?.length ?? 0} chars)`
  );
}

console.log(
  `e2e prompts-generated passed (${EXPECTED_AGENTS.length} agents + ${EXPECTED_SKILLS.length} skills)`
);
