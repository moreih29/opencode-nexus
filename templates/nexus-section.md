## Nexus Agent Orchestration

**Default: DELEGATE** - route code work, analysis, and multi-file changes to agents.
**OpenCode model** - lead-mediated orchestration with task state, hook guardrails, and coordination labels instead of Claude team objects.

### Agent Routing

Use agents when parallel work or a second specialized perspective is helpful.

| Name | Category | Task | Agent |
|---|---|---|---|
| Architect | HOW | Architecture and technical design review | architect |
| Designer | HOW | UI/UX and interaction design decisions | designer |
| Postdoc | HOW | Research methodology and evidence synthesis | postdoc |
| Strategist | HOW | Business and product strategy review | strategist |
| Engineer | DO | Implementation and debugging | engineer |
| Researcher | DO | Independent web and document research | researcher |
| Writer | DO | Technical writing and documentation | writer |
| QA | CHECK | Verification, testing, and quality checks | qa |
| Reviewer | CHECK | Fact-checking and content validation | reviewer |

Small single-file tasks can stay with the lead agent.
Reuse an existing `team_name` label before inventing a new one; it is a grouping label, not a platform-native team object.

### Skills

| Skill | Trigger | Purpose |
|---|---|---|
| nx-meet | [meet] | Team discussion and decision recording |
| nx-run | [run] | Execution pipeline |
| nx-init | nx-init | Onboarding |
| nx-sync | nx-sync | Core sync |
| nx-setup | nx-setup | Setup wizard |

### Tags

| Tag | Purpose |
|---|---|
| [meet] | Team discussion before implementation |
| [d] | Record a meet decision with nx_meet_decide |
| [run] | Execute the task pipeline |
| [rule] | Persist a stable team convention |

### Operational Rules

- Use `[meet]` before major implementation decisions.
- In meetings, research first and discuss one issue at a time.
- Use `[d]` only inside an active meet and only after supporting discussion is recorded.
- Use `[run]` when execution should follow the task pipeline.
- Register each execution unit with `nx_task_add` before file edits.
- Keep edits scoped to active tasks and update status with `nx_task_update`.
- Verify before closure; run `nx_sync` when useful, then archive with `nx_task_close`.
- Apply Branch Guard on `main` or `master` before substantial execution.
- Use `nx_briefing(role, hint?)` before specialist delegation when context matters.

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
