## Nexus Agent Orchestration

**Default: DELEGATE** - route code work, analysis, and multi-file changes to agents.
**OpenCode model** - lead-mediated orchestration with task state, hook guardrails, and coordination labels instead of Claude team objects.

### Agent Routing

Use agents when parallel work or a second specialized perspective is helpful.

| Name | Category | Task | Agent |
|---|---|---|---|
| architect | HOW | Technical design — evaluates How, reviews architecture, advises on implementation approach | architect |
| engineer | DO | Implementation — writes code, debugs issues, follows specifications from Lead and architect | engineer |
| designer | HOW | UX/UI design — evaluates user experience, interaction patterns, and how users will experience the product | designer |
| strategist | HOW | Business strategy — evaluates market positioning, competitive landscape, and business viability of decisions | strategist |
| researcher | DO | Independent investigation — conducts web searches, gathers evidence, and reports findings with citations | researcher |
| postdoc | HOW | Research methodology and synthesis — designs investigation approach, evaluates evidence quality, writes synthesis documents | postdoc |
| reviewer | CHECK | Content verification — validates accuracy, checks facts, confirms grammar and format of non-code deliverables | reviewer |
| tester | CHECK | Testing and verification — tests, verifies, validates stability and security of implementations | tester |
| writer | DO | Technical writing — transforms research findings, code, and analysis into clear documents and presentations for the intended audience | writer |

Small single-file tasks can stay with the lead agent.
Reuse an existing `team_name` label before inventing a new one; it is a grouping label, not a platform-native team object.

### Skills

| Skill | Trigger | Purpose |
|---|---|---|
| nx-run | [run] | Execution — user-directed agent composition |
| nx-plan | [plan] | Structured planning — subagent-based analysis, deliberate decisions, produce execution plan |
| nx-sync | [sync] | Context knowledge synchronization |
| nx-init | /opencode-nexus:nx-init | Project onboarding — scan, mission, essentials, context generation |
| nx-setup | /opencode-nexus:nx-setup | Interactive OpenCode setup wizard for Nexus orchestration. Configures models, permissions, plugins, and project knowledge. |

### Tags

| Tag | Purpose |
|---|---|
| [plan] | 리서치, 다관점 분석, 결정, 계획서 생성 |
| [d] | Record a plan decision with nx_plan_decide |
| [run] | Execute the task pipeline |
| [rule] | Persist a stable team convention |

### Operational Rules

- Use `[plan]` before major implementation decisions.
- In planning sessions, research first and discuss one issue at a time.
- Use `[d]` only inside an active plan and only after supporting discussion is recorded.
- Use `[run]` when execution should follow the task pipeline.
- Register each execution unit with `nx_task_add` before file edits.
- Keep edits scoped to active tasks and update status with `nx_task_update`.
- Verify before closure; run `nx_sync` when useful, then archive with `nx_task_close`.
- Apply Branch Guard on `main` or `master` before substantial execution.

### Coordination Model

- Lead owns task state, delegation, and final reporting.
- HOW agents advise on approach and do not own implementation state.
- DO agents execute scoped work against active tasks only.
- CHECK agents report PASS/FAIL plus findings by severity.
- `team_name` is a shared coordination label used to group related subagent work.
- All grouped execution is lead-mediated; subagents do not directly coordinate each other.

### Platform Mapping

- Primary instruction path: `AGENTS.md` plus `opencode.json.instructions`.
- `CLAUDE.md` is legacy migration input only.
- Claude slash skills map to `nx_*` tools plus tags and hook injection.
- Claude team APIs map to lead-coordinated OpenCode delegation with `team_name` labels.
- Exit/edit guardrails replace Claude nonstop behavior.
