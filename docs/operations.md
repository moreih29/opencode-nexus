# opencode-nexus Operations Guide

This document describes how to run the Nexus workflow in OpenCode with this plugin.

This is a current-state runtime guide. For source-project analysis and historical Claude Code concepts, see `nexus-reference-for-opencode.md` and `docs/reference-boundaries.md`.

When available, the preferred primary agent is `nexus`. It acts as the orchestration lead and delegates non-trivial specialist work to HOW / DO / CHECK subagents.

## Modes and Tags

- `[plan]`: discussion mode, define issues and decisions first
- `[d]`: decision marker inside active plan session
- `[run]`: execution mode, task cycle required
- `[rule]`: rule-writing intent for team conventions
- natural-language plan prompts are also detected for user guidance when the request clearly implies a meeting

## Workflow

1. Start meeting with `nx_plan_start`.
2. Discuss one issue at a time with `nx_plan_discuss`, including trade-offs and a recommendation.
3. Record decisions with `nx_plan_decide`.
4. Switch to run mode and create tasks with `nx_task_add`, linking `plan_issue` when the task comes from a decided issue. Linked tasks are written back onto the originating plan issue.
5. Execute work and update task status via `nx_task_update`.
6. Verify, then close and archive the cycle using `nx_task_close`.

## Procedural Expectations

- `[plan]` is discussion-only. Research first, then start or resume a meeting.
- Present one issue at a time and capture significant reasoning in `nx_plan_discuss`.
- `[run]` is task-driven. Treat `tasks.json` as the execution source of truth rather than relying on a separate phase file.
- Branch Guard applies in run mode: avoid substantial execution directly on `main` or `master`.

## Guardrails

- File edits (`edit`, `write`, `patch`, `multiedit`) are blocked when no active task cycle exists.
- If all tasks are completed, edits are blocked until you either:
  - close the cycle (`nx_task_close`), or
  - create new tasks (`nx_task_add`).
- `nx_plan_start` with non-lead attendees requires team existence tracked in `agent-tracker`.
- `team_name` is a shared coordination label for lead-managed subagent work, not a platform-native team object.
- Speaker validation in `nx_plan_discuss` allows only `lead`, `user`, or registered attendees.
- `nx_plan_discuss` stores structured discussion entries with speaker, kind, and timestamp; older string entries are normalized on read.
- Active `plan.json` or `tasks.json` state produces resume notices even without an explicit tag.
- `[run]` system injection includes a mandatory TASK PIPELINE reminder for file modifications.

## State Files

- `.nexus/state/plan.json`: active plan session
- `.nexus/state/plan.opencode.json`: OpenCode-only plan sidecar for canonical-first handoff and HOW panel continuity
- plan issues track richer statuses such as `researching`, `deferred`, and `tasked`
- `.nexus/state/tasks.json`: active task cycle and execution source of truth
- `.nexus/state/agent-tracker.json`: subagent lifecycle
- `.nexus/state/agent-tracker.json` records coordination labels and subagent lifecycle state; it is not a full team registry
- `.nexus/state/reopen-tracker.json`: reopen and blocked-transition signals for lifecycle summaries
- `.nexus/history.json`: archived plan/task cycles

## Useful Tools

- `nx_context`: current branch, active mode, and task summary
- `nx_briefing(role, hint?)`: role-scoped context assembly
- `nx_init`: repository scan + core knowledge bootstrap
- `nx_sync`: promote archived cycle history into core knowledge
- `nx_setup`: inject Nexus instructions into `AGENTS.md` and update `opencode.json`
- `nx_core_read/write`: project knowledge store
- `nx_rules_read/write`: team rules
- `nx_artifact_write`: save runtime artifacts

See `docs/team-compatibility.md` for supported, partial, and unsupported team-related behaviors.
See `docs/group-orchestration.md` for the OpenCode-native lead-coordinated group model.

## Instruction Files

- OpenCode primary instruction path: `AGENTS.md` plus `opencode.json.instructions`
- Legacy migration input: `CLAUDE.md` may be scanned by `nx_init`, but it is not treated as the primary runtime instruction source

## Compatibility Notes

- `plan.json` remains canonical and platform-neutral. OpenCode-specific continuity data is stored in `plan.opencode.json`.
- `plan.opencode.json` is best-effort only. If it is missing or ignored, OpenCode must still continue correctly from canonical `.nexus` files alone.
- Claude/OpenCode switching is treated as canonical-first handoff, not concurrent co-authoring of runtime state.
- When HOW subagents are actually invoked during a plan, OpenCode stores any available `task_id` / `session_id` handles in the sidecar so follow-up questions can preferentially resume the same participant session.
- Use `nx_plan_resume` to inspect the current resume handle and last summary for a HOW participant before issuing a follow-up delegation. Its `recommendation` payload tells the lead whether to resume the existing participant or rehydrate from summary.
- Prefer `nx_plan_followup` when you want delegation-ready follow-up guidance. It packages the same continuity data into a concrete prompt plus suggested resume handle fields.
- `nx_context` and `nx_plan_status` now surface follow-up-ready HOW roles so the lead can see when participant continuity is available before asking a follow-up.

## Self-Hosting This Repository

- This repository uses the local plugin file `.opencode/plugins/opencode-nexus.js` for self-hosting during development.
- The local shim re-exports `../../dist/index.js`, so `bun run build` is required before OpenCode can load the current plugin code.
- The checked-in repo `opencode.json` intentionally omits `plugin: ["opencode-nexus"]` to avoid loading the published npm package alongside the local plugin.
- When validating local changes, rebuild first and then confirm Nexus tools such as `nx_context` are available in the session.
