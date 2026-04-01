# Nexus Coverage Matrix

This document tracks implementation coverage against `nexus-reference-for-opencode.md`.

## Phase Coverage

| Phase | Item | Status | Notes |
|---|---|---|---|
| 1 | State file pattern + transitions | In progress | `meet/tasks/history` done, run-phase hardening ongoing |
| 1 | Task pipeline guardrails | In progress | edit/write guard exists, stop parity hardening pending |
| 1 | 4-layer knowledge | Complete | core/rules/context/briefing tools implemented |
| 2 | How/Do/Check categories | In progress | catalog + config injection done, runtime enforcement partial |
| 2 | MATRIX briefing | In progress | baseline matrix done, decisions/rules precision pending |
| 2 | Structured delegation | Not started | template not enforced yet |
| 3 | Tag system + detection | In progress | tags + false positives done, guidance hardening pending |
| 3 | meet -> run pipeline | In progress | basic transitions done, strict 5-phase rules pending |
| 3 | history + memoryHint | In progress | history + memoryHint done, memory ingestion pending |
| 4 | LSP integration | Not started | pending |
| 4 | AST search/replace | Not started | pending |

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
