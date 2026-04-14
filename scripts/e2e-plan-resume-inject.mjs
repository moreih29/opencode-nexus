/**
 * e2e-plan-resume-inject.mjs — Unit regression for plan-mode resume injection chain.
 *
 * Verifies the chain that auto-injects opencode native `task_id` into task tool args:
 *
 *   opencode-nexus/agent-tracker.json fixture
 *     → readPlanParticipantContinuityFromCore (plan-continuity-adapter)
 *     → buildPlanContinuityAdapterHints (with child_session_id fallback)
 *     → injectMissingPlanResumeArgs (preserves LLM-set task_id; uses opencode native naming)
 *
 * No LLM calls; CI-safe. See harness-docs/resume_invocation.md for the routing contract.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildPlanContinuityAdapterHints,
  injectMissingPlanResumeArgs,
  readPlanParticipantContinuityFromCore
} from "../src/orchestration/plan-continuity-adapter.ts";

let pass = 0;
let fail = 0;

function p(desc) {
  console.log(`  PASS: ${desc}`);
  pass++;
}

function f(desc) {
  console.log(`  FAIL: ${desc}`);
  fail++;
}

console.log("[e2e-plan-resume-inject] unit regression");

// 1. hints fallback to session_id when task_id is null
{
  const hints = buildPlanContinuityAdapterHints({
    role: "architect",
    task_id: null,
    session_id: "ses_FALLBACK",
    last_summary: null,
    updated_at: null,
    source: "orchestration-core"
  });
  if (hints.resume_task_id === "ses_FALLBACK") {
    p("hints fallback: session_id used when task_id is null");
  } else {
    f(`hints fallback: expected ses_FALLBACK, got ${hints.resume_task_id}`);
  }
}

// 2. hints uses explicit task_id when present
{
  const hints = buildPlanContinuityAdapterHints({
    role: "architect",
    task_id: "ses_TASK",
    session_id: "ses_SESSION",
    last_summary: null,
    updated_at: null,
    source: "orchestration-core"
  });
  if (hints.resume_task_id === "ses_TASK") {
    p("hints prefer task_id when present");
  } else {
    f(`hints: expected ses_TASK, got ${hints.resume_task_id}`);
  }
}

// 3. hints undefined when continuity is null
{
  const hints = buildPlanContinuityAdapterHints(null);
  if (hints.resume_task_id === undefined) {
    p("hints undefined when continuity is null");
  } else {
    f(`hints: expected undefined, got ${hints.resume_task_id}`);
  }
}

// 4. inject task_id when args lack it
{
  const args = { subagent_type: "architect", description: "follow-up" };
  const out = injectMissingPlanResumeArgs(args, { resume_task_id: "ses_INJECT" });
  if (out.task_id === "ses_INJECT") {
    p("inject: task_id added when args missing it");
  } else {
    f(`inject: expected ses_INJECT, got ${JSON.stringify(out)}`);
  }
}

// 5. preserve user-provided task_id
{
  const args = { subagent_type: "architect", task_id: "ses_USER" };
  const out = injectMissingPlanResumeArgs(args, { resume_task_id: "ses_PLUGIN" });
  if (out.task_id === "ses_USER") {
    p("inject: preserves user task_id (no override)");
  } else {
    f(`inject: expected ses_USER, got ${JSON.stringify(out)}`);
  }
}

// 6. preserve user-provided taskId (camelCase)
{
  const args = { subagent_type: "architect", taskId: "ses_USER_CAMEL" };
  const out = injectMissingPlanResumeArgs(args, { resume_task_id: "ses_PLUGIN" });
  if (out.task_id === undefined && out.taskId === "ses_USER_CAMEL") {
    p("inject: preserves user taskId (camelCase, no override)");
  } else {
    f(`inject: unexpected: ${JSON.stringify(out)}`);
  }
}

// 7. no-op when hint is undefined
{
  const args = { subagent_type: "architect" };
  const out = injectMissingPlanResumeArgs(args, { resume_task_id: undefined });
  if (out === args) {
    p("inject: no-op (returns same reference) when hint is undefined");
  } else {
    f(`inject: expected same reference, got new object`);
  }
}

// 8. full chain on on-disk opencode-nexus/agent-tracker.json fixture
{
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-resume-test-"));
  const filePath = path.join(tmpDir, "agent-tracker.json");
  const fixture = {
    harness_id: "opencode-nexus",
    started_at: "2026-04-13T00:00:00.000Z",
    invocations: [
      {
        invocation_id: "test-1",
        agent_type: "architect",
        status: "completed",
        purpose: "fixture",
        continuity: { resume_handles: {}, child_session_id: "ses_FIXTURE" },
        started_at: "2026-04-13T00:00:00.000Z",
        updated_at: "2026-04-13T00:00:00.000Z",
        ended_at: "2026-04-13T00:00:00.000Z",
        last_message: "stub"
      }
    ]
  };
  await fs.writeFile(filePath, JSON.stringify(fixture));
  try {
    const continuity = await readPlanParticipantContinuityFromCore(filePath, "architect");
    const hints = buildPlanContinuityAdapterHints(continuity);
    const out = injectMissingPlanResumeArgs(
      { subagent_type: "architect", description: "follow-up" },
      { resume_task_id: hints.resume_task_id }
    );
    if (out.task_id === "ses_FIXTURE") {
      p("full chain: opencode-nexus/agent-tracker.json → continuity → hints → inject");
    } else {
      f(`full chain: expected ses_FIXTURE, got ${JSON.stringify(out)}`);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

// 9. absent agent returns null continuity
{
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-resume-test-"));
  const filePath = path.join(tmpDir, "agent-tracker.json");
  await fs.writeFile(
    filePath,
    JSON.stringify({ harness_id: "opencode-nexus", started_at: "2026-04-13T00:00:00.000Z", invocations: [] })
  );
  try {
    const continuity = await readPlanParticipantContinuityFromCore(filePath, "architect");
    if (continuity === null) {
      p("absent agent: returns null continuity");
    } else {
      f(`absent agent: expected null, got ${JSON.stringify(continuity)}`);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

console.log(`\n✓ e2e-plan-resume-inject.mjs: ${pass}/${pass + fail} cases passed`);
process.exit(fail > 0 ? 1 : 0);
