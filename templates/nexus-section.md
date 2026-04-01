## Nexus Agent Orchestration

**Default: DELEGATE** - route code work, analysis, and multi-file changes to agents.

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
