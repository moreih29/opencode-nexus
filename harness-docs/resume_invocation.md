# OpenCode Agent Resume Mechanism

> **Verified status (2026-04-13, opencode 1.3.13)**: opencode 1.3.13의 task tool은
> 단일 `task_id` 필드로 resume target을 표현하며, 그 값은 prior subagent
> invocation의 **child session id**를 가리킨다 (task tool output의
> `"task_id: ses_xxx (for resuming...)"` 메시지로 LLM에게 전달). 본 문서가 이전에
> 사용한 `resume_task_id` / `resume_session_id` / `resume_handles` 명명은
> Claude Code의 다른 schema이며 opencode 1.3.13에서는 인식되지 않는다 (silently dropped).

## State Files

**`.nexus/state/orchestration.opencode.json`** — tracks all subagent invocations.
Each entry records: `agent_type`, `coordination_label`, `purpose`, `status`,
`continuity` (with `child_session_id`, optional `child_task_id`, `resume_handles`),
timestamps.

**`.nexus/state/plan.opencode.json`** — tracks HOW-agent participants in plan sessions.
Stores session and task IDs per role for continuity across plan interactions.

## Resume Parameter on the `task` Tool (opencode 1.3.13)

| Parameter | Type | Purpose | Source |
|-----------|------|---------|--------|
| `task_id` | string | Prior subagent's child session id; routes the call to the same subagent context for follow-up | opencode 1.3.13 task tool input |

camelCase alias `taskId` is also accepted.

### Cross-harness reference (Claude Code naming, NOT opencode native)

Claude Code documents `resume_task_id` / `resume_session_id` / `resume_handles` for its
own task tool. These fields are **not** part of opencode 1.3.13's task tool schema; if
injected, opencode drops them silently. Plugin code targeting opencode must use
`task_id` only.

## Resume Routing

1. Check `AGENT_META[role].resume_tier`:
   - `persistent` → resume by default
   - `bounded` → resume if same artifact and no intervening edits
   - `ephemeral` → always fresh spawn

2. For plan-cycle resume: call `nx_plan_resume` or `nx_plan_followup` to get routing info
   for HOW agents already in a plan session.

3. The opencode-nexus hook system auto-injects `task_id` when:
   - `tool.execute.before` fires for the `task` tool
   - Plan mode is active (`plan.json` exists) **OR** Run mode is active (`tasks.json` exists, no `plan.json`)
   - A matching invocation is found in `orchestration.opencode.json` for `agent_type`
     (and optional `coordination_label`)
   - Args don't already contain `task_id` / `taskId` (LLM may set this naturally
     from prior task output's `"task_id: ses_xxx"` hint — auto-inject preserves user value)

   Implementation:
   - Plan mode: `injectPlanContinuityForTask` (`src/plugin/hooks.ts`) →
     `readPlanParticipantContinuityFromCore` → `buildPlanContinuityAdapterHints` →
     `injectMissingPlanResumeArgs` (`src/orchestration/plan-continuity-adapter.ts`)
   - Run mode: `injectRunContinuityForTask` → `injectMissingRunResumeArgs`
     (`src/orchestration/run-continuity-adapter.ts`). Note: run-mode helper currently
     uses `resume_task_id` field name (Claude Code style); align with opencode native
     `task_id` if/when run-mode resume is also targeted at opencode 1.3.13 task tool.

4. Explicit override: pass `task_id` directly in delegation args to force a specific
   resume target.

## Practical Example (resume an architect in a plan session)

```
Turn 1: spawn architect via task tool
  → output includes: "task_id: ses_27af2600... (for resuming to continue this task if needed)"

Turn 2 (follow-up): user says "ask the architect to elaborate"
  Either:
  (a) LLM sets args.task_id = "ses_27af2600..." from referenced prior output, OR
  (b) LLM omits task_id — plugin auto-inject reads orchestration.opencode.json,
      finds architect continuity (child_session_id = "ses_27af2600..."), and
      sets args.task_id via injectMissingPlanResumeArgs.

Either way, opencode routes the prompt to the existing architect subagent session.
```

## Fallback Behavior

- If `task_id` points to a session that no longer exists, opencode falls back to fresh
  spawn (no error surfaced).
- The Claude Code-specific `runtime.json` `teams_enabled` flag does not gate opencode's
  task tool resume — it was a Claude Code concept that does not apply here.

## Verification

- Unit regression: `bun scripts/e2e-plan-resume-inject.mjs` covers the chain
  (orchestration.opencode.json → continuity → hints → injection) with on-disk fixture
- End-to-end smoke (LLM nondeterministic): `bun scripts/smoke-opencode-run.mjs how-resume`
  Group C — exercises opencode session side; C2 task spawn occasionally skipped due to
  LLM choice
- Audit log evidence: `.nexus/state/audit/sessions/<sid>/session.jsonl` shows
  `tool.execute.before` args for `task` tool — resume identifier appears in `args.task_id`

## See also

- Implementation commits on `feat/skill-delivery-option-d`: `aa5c4aa` (initial PoC),
  `51109b3` (session_id fallback fix)
- Smoke harness: `scripts/smoke-opencode-run.mjs`
