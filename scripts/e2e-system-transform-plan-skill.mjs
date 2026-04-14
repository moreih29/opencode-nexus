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

// Case 4: mode "memory" — no nexus-skill block, but .nexus/memory playbook present
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
  passed++;
  console.log("PASS [4] mode=memory has no nexus-skill block + .nexus/memory playbook present");
}

// Case 5: mode "memory_gc" — no nexus-skill block + gc/merge/Glob substring
{
  const result = buildNexusSystemPrompt({ mode: "memory_gc", agents: NEXUS_AGENT_CATALOG, skills: NEXUS_SKILL_CATALOG });
  assert.ok(
    !result.includes("<nexus-skill"),
    `[5] Expected NO <nexus-skill> block in memory_gc output`
  );
  const hasGcSubstring = result.includes("Glob") || result.includes("gc") || result.includes("merge");
  assert.ok(
    hasGcSubstring,
    `[5] Expected "Glob", "gc", or "merge" in memory_gc mode output`
  );
  passed++;
  console.log("PASS [5] mode=memory_gc has no nexus-skill block + gc/merge/Glob in playbook");
}

// Case 6: mode "idle" — nudge substring present (nx-setup, manual, proactively)
{
  const result = buildNexusSystemPrompt({ mode: "idle", agents: NEXUS_AGENT_CATALOG, skills: NEXUS_SKILL_CATALOG });
  const hasNudge =
    result.includes("nx-setup") ||
    result.includes("manual") ||
    result.includes("proactively") ||
    result.includes("explicitly");
  assert.ok(
    hasNudge,
    `[6] Expected nudge keyword (nx-setup/manual/proactively/explicitly) in idle mode output`
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
