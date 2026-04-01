# Nexus Coverage Matrix

This document tracks implementation coverage against `nexus-reference-for-opencode.md`.

## Phase Coverage

| Phase | Item | Status | Notes |
|---|---|---|---|
| 1 | State file pattern + transitions | Complete | `meet/tasks/history/run` with transition checks |
| 1 | Task pipeline guardrails | Complete | edit/write + close + stop guardrails enforced |
| 1 | 4-layer knowledge | Complete | core/rules/context/briefing tools implemented |
| 2 | How/Do/Check categories | Complete | 9-agent catalog + policy + team enforcement |
| 2 | MATRIX briefing | Complete | role matrix + rules + latest decisions |
| 2 | Structured delegation | Complete | `nx_delegate_template` implemented |
| 3 | Tag system + detection | Complete | tags, false positives, stateful notices, system injection |
| 3 | meet -> run pipeline | Complete | run phase tracking + strict transitions + guardrails |
| 3 | history + memoryHint | Complete | archive + memory cycle notes |
| 4 | LSP integration | Complete (lightweight) | symbol/refs/diagnostics/rename tools |
| 4 | AST search/replace | Complete (lightweight) | regex-backed AST-style search/replace |

## Final DoD

- Full 9-agent behavior prompts are active through system injection.
- 5 skill procedures are active through system injection.
- Run pipeline enforces intake/design/execute/verify/complete with rollback.
- Stop/nonstop equivalent behavior blocks exit with active tasks.
- Team/speaker validation behaves structurally (not advisory only).
- Structured delegation template is generated and used in agent tasking.
- MATRIX briefing + memoryHint flow are complete.
- LSP/AST tools are registered and operational.
- `bun run check` and `bun run test:e2e` pass.
