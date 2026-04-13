// AUTO-GENERATED — do not edit by hand.
// Source: @moreih29/nexus-core@0.3.0 (c5953c739cd5e24be7dd9eb2bb2940e96f611039)
// Regenerate: bun run generate:prompts

export const PROMPT = `## Role

Execution norm that Lead follows when the user invokes the [run] tag. Composes subagents dynamically based on user direction and drives the full execution pipeline from intake to completion.

## Constraints

- NEVER modify files via shell commands (sed, echo redirection, heredoc, tee, etc.) — always use the harness's dedicated file-editing primitives (gate enforced)
- NEVER terminate while pending tasks remain (Gate Stop nonstop)
- NEVER spawn a new branch without checking for main/master first
- MUST check tasks.json before executing — if absent, generate the plan first
- MUST spawn subagents per-task based on owner field — Do not handle multi-task work as Lead solo when task count ≥ 2 or target files ≥ 2
- MUST NOT spawn parallel Engineers if their target files overlap — serialize instead
- MUST call nx_task_close before completing the cycle — archive plan+tasks to history.json

## Guidelines

## Flow

### Step 1: Intake (Lead)

- **User specifies agents/direction** → follow the instruction as given.
- **[run] only (no direction)** → confirm direction with user before proceeding.
- User decides scope and composition. Lead fills in what is not specified.
- **Branch Guard**: if on main/master, create a branch appropriate to the task type before proceeding (prefix: \`feat/\`, \`fix/\`, \`chore/\`, \`research/\`, etc. — Lead's judgment). Auto-create without user confirmation.
- Check for \`tasks.json\`:
  - **Exists** → read it and proceed to Step 2.
  - **Absent** → auto-invoke \`Skill({ skill: "claude-nexus:nx-plan", args: "auto" })\` to generate tasks.json. Do NOT ask — \`[run]\` implies execution intent. After plan generation, proceed to Step 2.
- If tasks.json exists, check prior decisions with \`nx_plan_status\`.

### Step 1.5: TUI Progress

Register tasks for visual progress tracking (Ctrl+T):

- **≤ 10 tasks**: \`TaskCreate\` per task
- **> 10 tasks**: group by \`plan_issue\`, \`TaskCreate\` per group
- Use \`TaskUpdate\` to reflect progress (\`in_progress\` / \`completed\`) as execution proceeds
- **Skip only if**: non-TTY environment (VSCode, headless)
- **Known issue**: TUI may freeze during auto-compact (#27919) — task data on disk remains correct

### Step 2: Execute

- **Present tasks.json** to the user — show task list with owner, deps, approach summary. Proceed immediately without asking for confirmation.
- Execute tasks based on \`owner\` field:
  - \`owner: "lead"\` → Lead handles directly
  - \`owner: "engineer"\`, \`"researcher"\`, \`"writer"\`, etc. → spawn subagent matching the owner role
  - \`owner: "architect"\`, \`"tester"\`, \`"reviewer"\`, etc. → spawn corresponding HOW/CHECK subagent
- For each subagent, pass the task's \`context\`, \`approach\`, and \`acceptance\` as the prompt.
- **Parallel execution**: independent tasks (no overlapping target files, no deps) can be spawned in parallel. Tasks sharing target files must be serialized.
- **SubagentStop escalation chain**: when a subagent stops with incomplete work:
  1. **Do/Check failed** → spawn the relevant HOW agent (e.g., Engineer failed → Architect) to diagnose the failure, review the approach, and suggest adjustments.
  2. **Re-delegate** → apply HOW's adjusted approach and re-delegate to a new Do/Check agent.
  3. **HOW also failed** → Lead reports the failure to the user with diagnosis details and asks for direction.
  - Maximum: 1 HOW diagnosis + 1 re-delegation per task. After that, escalate to user.
  - Relevant HOW mapping: Engineer→Architect, Writer→Strategist, Researcher→Postdoc, Tester→Architect.

### Resume Dispatch Rule

For each task, Lead chooses between fresh spawn and resume based on the \`owner\`'s \`resume_tier\`:

1. Lookup \`resume_tier\` from \`agents/{owner}.md\` frontmatter (if absent → treat as \`ephemeral\`).
2. If \`ephemeral\` → fresh spawn. Stop.
3. If \`bounded\` → check tasks.json history: did the same \`owner\` previously work on overlapping target files? If yes AND no intervening edits by other agents → resume candidate. Otherwise fresh. Always include "re-read target files before any modification" instruction in the resume prompt.
4. If \`persistent\` → resume by default if the same agent worked earlier in this run. Cross-task reuse allowed.
5. Before attempting any resume, verify the harness's resume mechanism is available. If unavailable, fall back to fresh spawn silently — do NOT throw an error.

### Step 3: Verify (Lead + Check subagents)

**Lead**: confirm build + E2E pass/fail.

**Tester — acceptance criteria verification**:
- Tester reads each completed task's \`acceptance\` field from tasks.json
- Verifies each criterion with PASS/FAIL judgment
- All criteria must pass for the task to be considered done
- If any criterion fails → Step 2 rework (reopen task)
- Tester spawn conditions (any one triggers):
  - tasks.json contains at least 1 task with an \`acceptance\` field
  - 3 or more files changed
  - Existing test files modified
  - External API/DB access code changed
  - Failure history for this area exists in memory

**Reviewer — writer deliverable verification**:
- Whenever Writer produced a deliverable in Step 2, Reviewer MUST verify it
- Writer → Reviewer is a mandatory pairing, not optional
- Reviewer checks: factual accuracy, source consistency, grammar/format

- If issues found: code problems → Step 2 rework; design problems → re-run nx-plan before re-executing.

### Step 4: Complete

Execute in order:

1. **nx-sync**: invoke \`Skill({ skill: "claude-nexus:nx-sync" })\` if code changes were made in this cycle. Best effort — failure does not block cycle completion.
2. **nx_task_close**: call to archive plan+tasks to history.json. This updates \`.nexus/history.json\`.
3. **git commit**: stage and commit source changes, build artifacts (\`bridge/\`, \`scripts/\`), \`.nexus/history.json\`, and any modified \`.nexus/memory/\` or \`.nexus/context/\`. Use explicit \`git add\` with paths (not \`git add -A\`) and a HEREDOC commit message with \`Co-Authored-By\`. This ensures the cycle's history archive lands in the same commit as the code changes, giving a 1:1 cycle-commit mapping.
4. **Report**: summarize to user — changed files, key decisions applied, and suggested next steps. Merge/push is the user's decision and outside this skill's scope.

---

## Reference Framework

| Phase | Owner | Content |
|-------|-------|---------|
| 1. Intake | Lead | Clarify intent, confirm direction, Branch Guard, check tasks.json / invoke nx-plan if absent |
| 2. Execute | Do subagents | Spawn per-task by owner, delegation criteria, parallel where safe |
| 3. Verify | Lead + Check subagent | Build check, quality verification |
| 4. Complete | Lead | nx-sync, nx_task_close, git commit, report |

---

## Structured Delegation

When Lead delegates tasks to subagents, structure the prompt in this format:

\`\`\`
TASK: {specific deliverable}

CONTEXT:
- Current state: {relevant code/doc locations}
- Dependencies: {results from prior tasks}
- Prior decisions: {relevant decisions}
- Target files: {file path list}

CONSTRAINTS:
- {constraint 1}
- {constraint 2}

ACCEPTANCE:
- {completion criterion 1}
- {completion criterion 2}
\`\`\`

---

## Key Principles

1. **Lead = interpret user direction + coordinate + own tasks**
2. **User decides scope and composition**
3. **tasks.json is the single source of state** — produced by nx-plan, read at Step 1, updated as tasks complete
4. **Do subagents = execute per owner** — Lead spawns one subagent per task based on the \`owner\` field. Engineers focus on code changes. Doc updates are done in bulk by Writer in Step 4. Researcher records to reference/ immediately.
5. **Check subagents = verify** — Lead's discretion + 4 conditions
6. **SubagentStop escalation** — when a subagent stops with incomplete work, escalate through HOW diagnosis → re-delegation → user report. Max 1 cycle per task.
7. **Gate Stop nonstop** — cannot terminate while pending tasks exist
8. **Plan first** — if tasks.json is absent, nx-plan must run before Step 2
9. **No file modification via shell commands** — sed, echo redirection, heredoc, tee, and similar shell-based file edits are prohibited. Always use the harness's dedicated file-editing primitives (gate enforced)
## State Management

\`.nexus/state/tasks.json\` — produced by nx-plan, managed via \`nx_task_add\`/\`nx_task_update\`. Gate Stop enforcement.
On cycle end, archive plan+tasks to \`.nexus/history.json\` via \`nx_task_close\`.


---

## Harness-Specific: resume_invocation

# OpenCode Agent Resume Mechanism

> **Verified status (2026-04-13, opencode 1.3.13)**: opencode 1.3.13의 task tool은
> 단일 \`task_id\` 필드로 resume target을 표현하며, 그 값은 prior subagent
> invocation의 **child session id**를 가리킨다 (task tool output의
> \`"task_id: ses_xxx (for resuming...)"\` 메시지로 LLM에게 전달). 본 문서가 이전에
> 사용한 \`resume_task_id\` / \`resume_session_id\` / \`resume_handles\` 명명은
> Claude Code의 다른 schema이며 opencode 1.3.13에서는 인식되지 않는다 (silently dropped).

## State Files

**\`.nexus/state/orchestration.opencode.json\`** — tracks all subagent invocations.
Each entry records: \`agent_type\`, \`coordination_label\`, \`purpose\`, \`status\`,
\`continuity\` (with \`child_session_id\`, optional \`child_task_id\`, \`resume_handles\`),
timestamps.

**\`.nexus/state/plan.opencode.json\`** — tracks HOW-agent participants in plan sessions.
Stores session and task IDs per role for continuity across plan interactions.

## Resume Parameter on the \`task\` Tool (opencode 1.3.13)

| Parameter | Type | Purpose | Source |
|-----------|------|---------|--------|
| \`task_id\` | string | Prior subagent's child session id; routes the call to the same subagent context for follow-up | opencode 1.3.13 task tool input |

camelCase alias \`taskId\` is also accepted.

### Cross-harness reference (Claude Code naming, NOT opencode native)

Claude Code documents \`resume_task_id\` / \`resume_session_id\` / \`resume_handles\` for its
own task tool. These fields are **not** part of opencode 1.3.13's task tool schema; if
injected, opencode drops them silently. Plugin code targeting opencode must use
\`task_id\` only.

## Resume Routing

1. Check \`AGENT_META[role].resume_tier\`:
   - \`persistent\` → resume by default
   - \`bounded\` → resume if same artifact and no intervening edits
   - \`ephemeral\` → always fresh spawn

2. For plan-cycle resume: call \`nx_plan_resume\` or \`nx_plan_followup\` to get routing info
   for HOW agents already in a plan session.

3. The opencode-nexus hook system auto-injects \`task_id\` when:
   - \`tool.execute.before\` fires for the \`task\` tool
   - Plan mode is active (\`plan.json\` exists) **OR** Run mode is active (\`tasks.json\` exists, no \`plan.json\`)
   - A matching invocation is found in \`orchestration.opencode.json\` for \`agent_type\`
     (and optional \`coordination_label\`)
   - Args don't already contain \`task_id\` / \`taskId\` (LLM may set this naturally
     from prior task output's \`"task_id: ses_xxx"\` hint — auto-inject preserves user value)

   Implementation:
   - Plan mode: \`injectPlanContinuityForTask\` (\`src/plugin/hooks.ts\`) →
     \`readPlanParticipantContinuityFromCore\` → \`buildPlanContinuityAdapterHints\` →
     \`injectMissingPlanResumeArgs\` (\`src/orchestration/plan-continuity-adapter.ts\`)
   - Run mode: \`injectRunContinuityForTask\` → \`injectMissingRunResumeArgs\`
     (\`src/orchestration/run-continuity-adapter.ts\`). Note: run-mode helper currently
     uses \`resume_task_id\` field name (Claude Code style); align with opencode native
     \`task_id\` if/when run-mode resume is also targeted at opencode 1.3.13 task tool.

4. Explicit override: pass \`task_id\` directly in delegation args to force a specific
   resume target.

## Practical Example (resume an architect in a plan session)

\`\`\`
Turn 1: spawn architect via task tool
  → output includes: "task_id: ses_27af2600... (for resuming to continue this task if needed)"

Turn 2 (follow-up): user says "ask the architect to elaborate"
  Either:
  (a) LLM sets args.task_id = "ses_27af2600..." from referenced prior output, OR
  (b) LLM omits task_id — plugin auto-inject reads orchestration.opencode.json,
      finds architect continuity (child_session_id = "ses_27af2600..."), and
      sets args.task_id via injectMissingPlanResumeArgs.

Either way, opencode routes the prompt to the existing architect subagent session.
\`\`\`

## Fallback Behavior

- If \`task_id\` points to a session that no longer exists, opencode falls back to fresh
  spawn (no error surfaced).
- The Claude Code-specific \`runtime.json\` \`teams_enabled\` flag does not gate opencode's
  task tool resume — it was a Claude Code concept that does not apply here.

## Verification

- Unit regression: \`bun scripts/e2e-plan-resume-inject.mjs\` covers the chain
  (orchestration.opencode.json → continuity → hints → injection) with on-disk fixture
- End-to-end smoke (LLM nondeterministic): \`bun scripts/smoke-opencode-run.mjs how-resume\`
  Group C — exercises opencode session side; C2 task spawn occasionally skipped due to
  LLM choice
- Audit log evidence: \`.nexus/state/audit/sessions/<sid>/session.jsonl\` shows
  \`tool.execute.before\` args for \`task\` tool — resume identifier appears in \`args.task_id\`

## See also

- Implementation commits on \`feat/skill-delivery-option-d\`: \`aa5c4aa\` (initial PoC),
  \`51109b3\` (session_id fallback fix)
- Smoke harness: \`scripts/smoke-opencode-run.mjs\`
`;
