import assert from "node:assert/strict";

import { AGENT_META } from "../dist/agents/generated/index.js";
import { SKILL_META } from "../dist/skills/generated/index.js";
const NEXUS_AGENT_CATALOG = Object.values(AGENT_META);
const NEXUS_SKILL_CATALOG = Object.values(SKILL_META);
import { buildNexusSystemPrompt } from "../dist/plugin/system-prompt.js";

let passed = 0;

// Case 1: mode "plan" includes nx-plan skill block + key body substring
{
  const result = buildNexusSystemPrompt({ mode: "plan", agents: NEXUS_AGENT_CATALOG, skills: NEXUS_SKILL_CATALOG });
  assert.ok(
    result.includes('<nexus-skill id="nx-plan">'),
    `[1] Expected <nexus-skill id="nx-plan"> in plan output. Got:\n${result.slice(0, 500)}`
  );
  assert.ok(
    result.includes("Facilitate structured multi-perspective analysis"),
    `[1] Expected "Facilitate structured multi-perspective analysis" in plan output`
  );
  passed++;
  console.log("PASS [1] mode=plan includes nexus-skill nx-plan block + body substring");
}

// Case 2: mode "run" includes nx-run skill block + key body substring
{
  const result = buildNexusSystemPrompt({ mode: "run", agents: NEXUS_AGENT_CATALOG, skills: NEXUS_SKILL_CATALOG });
  assert.ok(
    result.includes('<nexus-skill id="nx-run">'),
    `[2] Expected <nexus-skill id="nx-run"> in run output`
  );
  assert.ok(
    result.includes("Execution norm that Lead follows when the user invokes"),
    `[2] Expected "Execution norm that Lead follows" in run output`
  );
  passed++;
  console.log("PASS [2] mode=run includes nexus-skill nx-run block + body substring");
}

// Case 3: mode "sync" includes nx-sync skill block + body substring
{
  const result = buildNexusSystemPrompt({ mode: "sync", agents: NEXUS_AGENT_CATALOG, skills: NEXUS_SKILL_CATALOG });
  assert.ok(
    result.includes('<nexus-skill id="nx-sync">'),
    `[3] Expected <nexus-skill id="nx-sync"> in sync output`
  );
  // nx-sync body: "Scans the current project state and synchronizes .nexus/context/"
  assert.ok(
    result.includes(".nexus/context/"),
    `[3] Expected ".nexus/context/" in sync skill body`
  );
  passed++;
  console.log("PASS [3] mode=sync includes nexus-skill nx-sync block + body substring");
}

// Case 4: mode "memory" — no nexus-skill block, with memory-policy save guidance
{
  const result = buildNexusSystemPrompt({ mode: "memory", agents: NEXUS_AGENT_CATALOG, skills: NEXUS_SKILL_CATALOG });
  assert.ok(
    !result.includes("<nexus-skill"),
    `[4] Expected NO <nexus-skill> block in memory output`
  );
  assert.ok(
    result.includes(".nexus/memory"),
    `[4] Expected ".nexus/memory" in memory mode output (playbook)`
  );
  assert.ok(
    result.includes("empirical-") && result.includes("external-") && result.includes("pattern-"),
    `[4] Expected canonical category prefixes in memory mode output`
  );
  assert.ok(
    result.includes("Merge-before-create"),
    `[4] Expected merge-before-create guidance in memory mode output`
  );
  passed++;
  console.log("PASS [4] mode=memory has no nexus-skill block + policy save guidance");
}

// Case 5: mode "memory_gc" — no nexus-skill block + policy GC guidance
{
  const result = buildNexusSystemPrompt({ mode: "memory_gc", agents: NEXUS_AGENT_CATALOG, skills: NEXUS_SKILL_CATALOG });
  const lower = result.toLowerCase();
  assert.ok(
    !result.includes("<nexus-skill"),
    `[5] Expected NO <nexus-skill> block in memory_gc output`
  );
  assert.ok(
    result.includes("Manual GC") || result.includes("manual GC"),
    `[5] Expected manual GC guidance in memory_gc mode output`
  );
  assert.ok(
    lower.includes("merge") && (lower.includes("delete") || lower.includes("deletion")),
    `[5] Expected merge-before-delete guidance in memory_gc mode output`
  );
  assert.ok(
    result.includes("git-recoverable"),
    `[5] Expected git-recoverable deletion guidance in memory_gc mode output`
  );
  assert.ok(
    lower.includes("glob") && lower.includes(".nexus/memory"),
    `[5] Expected glob + .nexus/memory guidance in memory_gc mode output`
  );
  passed++;
  console.log("PASS [5] mode=memory_gc has no nexus-skill block + policy GC guidance");
}

// Case 6: mode "idle" — nudge substring present (manual/proactively/explicitly)
{
  const result = buildNexusSystemPrompt({ mode: "idle", agents: NEXUS_AGENT_CATALOG, skills: NEXUS_SKILL_CATALOG });
  const hasNudge =
    result.includes("manual") ||
    result.includes("proactively") ||
    result.includes("explicitly");
  assert.ok(
    hasNudge,
    `[6] Expected nudge keyword (manual/proactively/explicitly) in idle mode output`
  );
  passed++;
  console.log("PASS [6] mode=idle includes nudge substring");
}

// Case 7: system.transform body — mode "plan" reaches the nexus block with mode marker
{
  const result = buildNexusSystemPrompt({ mode: "plan", agents: NEXUS_AGENT_CATALOG, skills: NEXUS_SKILL_CATALOG });
  assert.ok(
    result.includes("Active mode: plan"),
    `[7] Expected "Active mode: plan" in plan output`
  );
  assert.ok(
    result.includes("<nexus>"),
    `[7] Expected <nexus> wrapper block`
  );
  assert.ok(
    result.includes("</nexus>"),
    `[7] Expected </nexus> closing tag`
  );
  passed++;
  console.log("PASS [7] system.transform body — nexus block wrapper + Active mode marker present");
}

console.log(`\n✓ e2e-system-transform-plan-skill.mjs: ${passed} cases passed`);
