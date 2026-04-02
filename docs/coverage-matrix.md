# Nexus Coverage Matrix

This document tracks implementation coverage against `nexus-reference-for-opencode.md`.

Use this document and `docs/operations.md` as the source of truth for what `opencode-nexus` actually supports today.

## Phase Coverage

| Phase | Item | Status | Notes |
|---|---|---|---|
| 1 | State file pattern + transitions | Complete | `meet/tasks/history/run` with transition checks |
| 1 | Task pipeline guardrails | Complete | edit/write + close + stop guardrails enforced |
| 1 | 4-layer knowledge | Complete | core/rules/context/briefing tools implemented |
| 2 | How/Do/Check categories | Complete | 9-agent catalog + policy + team enforcement |
| 2 | Nexus primary orchestration lead | Complete | `nexus` is injected as the preferred primary agent and defaults are aligned around orchestration-first behavior |
| 2 | MATRIX briefing | Partial | role matrix + rules + latest decisions only; source asset parity still pending |
| 2 | Structured delegation | Complete | `nx_delegate_template` implemented |
| 2 | Init/setup/sync workflows | Partial | `nx_setup` now supports self-host capability detection and degraded profiles; broader slash-skill parity remains partial |
| 2 | CLAUDE.md migration handling | Partial | `nx_init` can ingest `CLAUDE.md` as legacy input, but OpenCode defaults to `AGENTS.md` |
| 2 | Claude-native slash skill runtime | Missing | Replaced with OpenCode tools and config/instruction flows |
| 3 | Tag system + detection | Partial | explicit tags + natural meet hints + stateful notices; full parity still pending |
| 3 | meet -> run pipeline | Partial | structured meet discussion records and meet->task linkage now exist; broader procedural parity still pending |
| 3 | history + memoryHint | Partial | archive now includes lifecycle signals, but deeper loop telemetry is still pending |
| 3 | Claude-native team messaging | Missing | No TeamCreate/SendMessage parity; lead coordinates subagents through OpenCode tasking |
| 3 | team_name semantics | Partial | supported only as a coordination label, not as a native team object |
| 4 | LSP integration | Partial | heuristic hover/definition/references/symbols/actions with preview-first rename |
| 4 | AST search/replace | Partial | regex-backed AST search plus preview-first replace |

## Final DoD

- Full 9-agent behavior prompts are active through system injection.
- 5 skill procedures are only partially represented through system injection.
- Run pipeline enforces intake/design/execute/verify/complete with rollback.
- Stop/nonstop equivalent behavior blocks exit with active tasks.
- Team/speaker validation behaves structurally (not advisory only).
- Structured delegation template is generated and used in agent tasking.
- MATRIX briefing + memoryHint flow are partial and still evolving toward parity.
- LSP/AST tools are registered but remain lightweight placeholders in several areas.
- `bun run check` and `bun run test:e2e` pass.
