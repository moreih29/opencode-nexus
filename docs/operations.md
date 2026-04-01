# opencode-nexus Operations Guide

This document describes how to run the Nexus workflow in OpenCode with this plugin.

This is a current-state runtime guide. For source-project analysis and historical Claude Code concepts, see `nexus-reference-for-opencode.md` and `docs/reference-boundaries.md`.

## Modes and Tags

- `[meet]`: discussion mode, define issues and decisions first
- `[d]`: decision marker inside active meet session
- `[run]`: execution mode, task cycle required
- `[rule]`: rule-writing intent for team conventions
- natural-language meet prompts are also detected for user guidance when the request clearly implies a meeting

## Workflow

1. Start meeting with `nx_meet_start`.
2. Discuss one issue at a time with `nx_meet_discuss`, including trade-offs and a recommendation.
3. Record decisions with `nx_meet_decide`.
4. Switch to run mode and create tasks with `nx_task_add`, linking `meet_issue` when the task comes from a decided issue.
5. Execute work and update task status via `nx_task_update`.
6. Verify, then close and archive the cycle using `nx_task_close`.

## Procedural Expectations

- `[meet]` is discussion-only. Research first, then start or resume a meeting.
- Present one issue at a time and capture significant reasoning in `nx_meet_discuss`.
- `[run]` follows intake -> design -> execute -> verify -> complete.
- Branch Guard applies in run mode: avoid substantial execution directly on `main` or `master`.

## Guardrails

- File edits (`edit`, `write`, `patch`, `multiedit`) are blocked when no active task cycle exists.
- If all tasks are completed, edits are blocked until you either:
  - close the cycle (`nx_task_close`), or
  - create new tasks (`nx_task_add`).
- `nx_meet_start` with non-lead attendees requires team existence tracked in `agent-tracker`.
- Speaker validation in `nx_meet_discuss` allows only `lead`, `user`, or registered attendees.
- Active `meet.json` or `tasks.json` state produces resume notices even without an explicit tag.
- `[run]` system injection includes a mandatory TASK PIPELINE reminder for file modifications.

## State Files

- `.nexus/state/meet.json`: active meet session
- `.nexus/state/tasks.json`: active task cycle
- `.nexus/state/run.json`: run pipeline phase state
- `.nexus/state/agent-tracker.json`: subagent lifecycle
- `.nexus/state/reopen-tracker.json`: reopen and blocked-transition signals for lifecycle summaries
- `.nexus/history.json`: archived meet/task cycles

## Useful Tools

- `nx_context`: current branch, active mode, and task summary
- `nx_briefing(role, hint?)`: role-scoped context assembly
- `nx_init`: repository scan + core knowledge bootstrap
- `nx_sync`: promote archived cycle history into core knowledge
- `nx_setup`: inject Nexus instructions into `AGENTS.md` and update `opencode.json`
- `nx_core_read/write`: project knowledge store
- `nx_rules_read/write`: team rules
- `nx_artifact_write`: save runtime artifacts

## Instruction Files

- OpenCode primary instruction path: `AGENTS.md` plus `opencode.json.instructions`
- Legacy migration input: `CLAUDE.md` may be scanned by `nx_init`, but it is not treated as the primary runtime instruction source
