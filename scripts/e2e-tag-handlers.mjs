import assert from "node:assert/strict";

import { detectNexusTag, buildTagNotice } from "../dist/shared/tag-parser.js";
import { buildNexusSystemPrompt } from "../dist/plugin/system-prompt.js";
import { AGENT_META } from "../dist/agents/generated/index.js";
import { SKILL_META } from "../dist/skills/generated/index.js";
const NEXUS_AGENT_CATALOG = Object.values(AGENT_META);
const NEXUS_SKILL_CATALOG = Object.values(SKILL_META);

let passed = 0;

// Case 1: [m:gc] → memory_gc (with highest priority)
{
  const result = detectNexusTag("[m:gc] old memos");
  assert.equal(result, "memory_gc", `[1] "[m:gc] old memos" should return "memory_gc", got "${result}"`);
  passed++;
  console.log('PASS [1] detectNexusTag("[m:gc] old memos") === "memory_gc"');
}

// Case 2: [m] → memory
{
  const result = detectNexusTag("[m] save this");
  assert.equal(result, "memory", `[2] "[m] save this" should return "memory", got "${result}"`);
  passed++;
  console.log('PASS [2] detectNexusTag("[m] save this") === "memory"');
}

// Case 3: [sync] → sync
{
  const result = detectNexusTag("[sync]");
  assert.equal(result, "sync", `[3] "[sync]" should return "sync", got "${result}"`);
  passed++;
  console.log('PASS [3] detectNexusTag("[sync]") === "sync"');
}

// Case 4: [M:GC] upper-case → memory_gc (case-insensitive)
{
  const result = detectNexusTag("[M:GC] upper");
  assert.equal(result, "memory_gc", `[4] "[M:GC] upper" should return "memory_gc" (case-insensitive), got "${result}"`);
  passed++;
  console.log('PASS [4] detectNexusTag("[M:GC] upper") === "memory_gc" (case-insensitive)');
}

// Case 5: [M] upper-case → memory (case-insensitive)
{
  const result = detectNexusTag("[M] upper");
  assert.equal(result, "memory", `[5] "[M] upper" should return "memory" (case-insensitive), got "${result}"`);
  passed++;
  console.log('PASS [5] detectNexusTag("[M] upper") === "memory" (case-insensitive)');
}

// Case 6: ERROR context excludes [m] → null (false positive suppression)
{
  const result = detectNexusTag("error: [m] not found");
  assert.equal(result, null, `[6] "error: [m] not found" should return null (error context), got "${result}"`);
  passed++;
  console.log('PASS [6] detectNexusTag("error: [m] not found") === null (error context suppression)');
}

// Case 7: QUESTION context excludes [sync] → null (false positive suppression)
{
  const result = detectNexusTag("what is [sync] mode?");
  assert.equal(result, null, `[7] "what is [sync] mode?" should return null (question context), got "${result}"`);
  passed++;
  console.log('PASS [7] detectNexusTag("what is [sync] mode?") === null (question context suppression)');
}

// Case 8: [plan] still works (regression)
{
  const result = detectNexusTag("[plan] still works");
  assert.equal(result, "plan", `[8] "[plan] still works" should return "plan", got "${result}"`);
  passed++;
  console.log('PASS [8] detectNexusTag("[plan] still works") === "plan" (regression)');
}

// Case 9: [run] still works (regression)
{
  const result = detectNexusTag("[run] proceed");
  assert.equal(result, "run", `[9] "[run] proceed" should return "run", got "${result}"`);
  passed++;
  console.log('PASS [9] detectNexusTag("[run] proceed") === "run" (regression)');
}

// Case 10: [m:gc] takes priority over [m] when both appear (priority check)
{
  const result = detectNexusTag("[m:gc] and also [m] in same message");
  assert.equal(result, "memory_gc", `[10] "[m:gc] and [m]" should return "memory_gc" (m:gc has priority), got "${result}"`);
  passed++;
  console.log('PASS [10] [m:gc] takes priority over [m] in same message');
}

// Case 11: buildTagNotice includes memory-policy guidance for memory modes
{
  const syncNotice = buildTagNotice("sync");
  assert.ok(
    typeof syncNotice === "string" && syncNotice.length > 0,
    `[11] buildTagNotice("sync") should return non-empty string, got "${syncNotice}"`
  );

  const memoryNotice = buildTagNotice("memory");
  assert.ok(
    typeof memoryNotice === "string" && memoryNotice.length > 0,
    `[11] buildTagNotice("memory") should return non-empty string, got "${memoryNotice}"`
  );
  assert.ok(memoryNotice.includes("empirical-") && memoryNotice.includes("external-") && memoryNotice.includes("pattern-"),
    `[11] memory notice should include canonical category prefixes`);
  assert.ok(memoryNotice.includes("lowercase kebab-case") || memoryNotice.includes("kebab-case"),
    `[11] memory notice should mention lowercase kebab-case naming`);
  assert.ok(memoryNotice.includes("Merge-before-create"),
    `[11] memory notice should mention merge-before-create preference`);

  const memoryGcNotice = buildTagNotice("memory_gc");
  assert.ok(
    typeof memoryGcNotice === "string" && memoryGcNotice.length > 0,
    `[11] buildTagNotice("memory_gc") should return non-empty string, got "${memoryGcNotice}"`
  );
  assert.ok(memoryGcNotice.includes("Manual GC") || memoryGcNotice.includes("manual GC"),
    `[11] memory_gc notice should mention manual GC default`);
  assert.ok(memoryGcNotice.includes("git-recoverable"),
    `[11] memory_gc notice should mention git-recoverable deletion`);
  assert.ok(memoryGcNotice.includes("Glob") || memoryGcNotice.includes("glob"),
    `[11] memory_gc notice should mention Glob usage`);
  assert.ok(memoryGcNotice.includes("merge") || memoryGcNotice.includes("Merge"),
    `[11] memory_gc notice should mention merge-before-delete guidance`);
  passed++;
  console.log('PASS [11] buildTagNotice memory modes include memory-policy guidance');
}

// Case 12: buildNexusSystemPrompt mode=sync includes MODE PLAYBOOK (sync) section
{
  const result = buildNexusSystemPrompt({ mode: "sync", agents: NEXUS_AGENT_CATALOG, skills: NEXUS_SKILL_CATALOG });
  assert.ok(
    result.includes("MODE PLAYBOOK (sync)"),
    `[12] buildNexusSystemPrompt mode=sync should contain "MODE PLAYBOOK (sync)"`
  );
  passed++;
  console.log('PASS [12] buildNexusSystemPrompt(mode="sync") contains "MODE PLAYBOOK (sync)"');
}

// Case 13: buildNexusSystemPrompt mode=memory includes policy-specific save guidance
{
  const result = buildNexusSystemPrompt({ mode: "memory", agents: NEXUS_AGENT_CATALOG, skills: NEXUS_SKILL_CATALOG });
  assert.ok(
    result.includes(".nexus/memory"),
    `[13] buildNexusSystemPrompt mode=memory should contain ".nexus/memory"`
  );
  assert.ok(result.includes("empirical-") && result.includes("external-") && result.includes("pattern-"),
    `[13] memory mode should include canonical category prefixes`);
  assert.ok(result.includes("Merge-before-create"),
    `[13] memory mode should include merge-before-create guidance`);
  passed++;
  console.log('PASS [13] buildNexusSystemPrompt(mode="memory") includes policy-specific save guidance');
}

// Case 14: buildNexusSystemPrompt mode=memory_gc includes policy-specific GC guidance
{
  const result = buildNexusSystemPrompt({ mode: "memory_gc", agents: NEXUS_AGENT_CATALOG, skills: NEXUS_SKILL_CATALOG });
  const lower = result.toLowerCase();
  assert.ok(result.includes("Manual GC") || result.includes("manual GC"),
    `[14] memory_gc mode should mention manual GC default`);
  assert.ok(lower.includes("merge") && (lower.includes("delete") || lower.includes("deletion")),
    `[14] memory_gc mode should include merge-before-delete guidance`);
  assert.ok(result.includes("git-recoverable"),
    `[14] memory_gc mode should mention git-recoverable deletion`);
  assert.ok(result.includes("Glob") || result.includes("glob"),
    `[14] memory_gc mode should mention Glob usage`);
  assert.ok(result.includes("merge") || result.includes("Merge"),
    `[14] memory_gc mode should mention merge-before-delete guidance`);
  passed++;
  console.log('PASS [14] buildNexusSystemPrompt(mode="memory_gc") includes policy-specific GC guidance');
}

console.log(`\n✓ e2e-tag-handlers.mjs: ${passed} cases passed`);
