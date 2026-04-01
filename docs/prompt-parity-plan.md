# Prompt Parity Plan

This document is the implementation inventory for migrating prompt assets and operational guidance from the original `claude-nexus` into `opencode-nexus`.

Use this file to prevent large prompt-level omissions during migration work.

## Migration Rule

- Preserve original behavioral intent unless it depends on Claude Code-only runtime features.
- Replace Claude Code-only runtime features with OpenCode-native equivalents.
- Do not collapse detailed operational prompts into summary stubs.

## Claude to OpenCode Mapping

| Claude Source Concept | OpenCode Target |
|---|---|
| `CLAUDE.md` runtime instructions | `AGENTS.md` + `opencode.json.instructions` |
| slash skills (`/claude-nexus:nx-*`) | `nx_*` tools plus tags and system injection |
| TeamCreate / TeamDelete | lead-coordinated `team_name` labels tracked in `.nexus/state/agent-tracker.json` |
| SendMessage between agents | lead-mediated delegation and reporting through subagent task output |
| AskUserQuestion wizard flow | OpenCode tool arguments and host-side config flow |
| Claude plugin format | OpenCode plugin hooks + custom tools |

## Agent Prompt Inventory

| Source | Required Sections | OpenCode Target | Status |
|---|---|---|---|
| `agents/architect.md` | role, constraints, read-only diagnostics, decision framework, review process, severity, escalation, response format, approval gate, evidence | `src/agents/prompts.ts` `architect` | Pending parity |
| `agents/designer.md` | role, constraints, UX review framework, collaboration rules, response format, evidence | `src/agents/prompts.ts` `designer` | Pending parity |
| `agents/postdoc.md` | role, epistemic rules, synthesis method, evidence grading, bias controls, artifact rules, approval gate | `src/agents/prompts.ts` `postdoc` | Pending parity |
| `agents/strategist.md` | role, strategic framework, evidence rules, collaboration rules, response format | `src/agents/prompts.ts` `strategist` | Pending parity |
| `agents/engineer.md` | role, implementation rules, debugging process, verification, escalation, bounded retry, completion report | `src/agents/prompts.ts` `engineer` | Pending parity |
| `agents/researcher.md` | role, citation rules, contradicting evidence, null results, search exit condition, artifact/reference recording | `src/agents/prompts.ts` `researcher` | Pending parity |
| `agents/writer.md` | role, source fidelity, audience rules, artifact writing, reviewer handoff, escalation | `src/agents/prompts.ts` `writer` | Pending parity |
| `agents/qa.md` | role, verification checklist, testing mode, security mode, severity, reporting, artifact rules | `src/agents/prompts.ts` `qa` | Pending parity |
| `agents/reviewer.md` | role, content review checklist, severity, reporting, escalation, artifact rules | `src/agents/prompts.ts` `reviewer` | Pending parity |

## Skill Prompt Inventory

| Source | Required Sections | OpenCode Target | Status |
|---|---|---|---|
| `skills/nx-meet/SKILL.md` | trigger, intent discovery, research, attendee setup, one-issue flow, discussion logging, decision recording, gap check, meet->run transition | `src/skills/prompts.ts` `nx-meet`, `src/plugin/hooks.ts`, `src/plugin/system-prompt.ts` | Partial |
| `skills/nx-run/SKILL.md` | branch guard, design gate, task registration, delegation rules, overlap rules, QA triggers, rollback routing, completion/shutdown | `src/skills/prompts.ts` `nx-run`, `src/plugin/system-prompt.ts`, `src/plugin/hooks.ts` | Partial |
| `skills/nx-init/SKILL.md` | mode detection, scan order, identity confirmation, codebase generation, optional rules, completion summary | `src/skills/prompts.ts` `nx-init`, `src/tools/workflow.ts` | Partial |
| `skills/nx-sync/SKILL.md` | source gathering, scope determination, targeted updates, evidence rules, per-layer behavior, reporting | `src/skills/prompts.ts` `nx-sync`, `src/tools/workflow.ts` | Partial |
| `skills/nx-setup/SKILL.md` | scope selection, instruction injection, config updates, conflict handling, optional init, completion summary | `src/skills/prompts.ts` `nx-setup`, `src/tools/setup.ts`, `templates/nexus-section.md` | Partial |

## System Injection Inventory

| Area | Required Content | OpenCode Target | Status |
|---|---|---|---|
| mode guidance | idle/meet/decide/run/rule behavior | `src/plugin/system-prompt.ts` | Partial |
| task pipeline | task registration, active task scope, verify/close order | `src/plugin/system-prompt.ts` | Partial |
| delegation rules | when to delegate, how to use `nx_briefing`, group label reuse | `src/plugin/system-prompt.ts` | Partial |
| completion rules | verify, `nx_sync`, `nx_task_close`, reporting | `src/plugin/system-prompt.ts` | Partial |
| legacy mapping | `AGENTS.md` primary, `CLAUDE.md` legacy only | `src/plugin/system-prompt.ts` | Missing |

## Hook Coaching Inventory

| Area | Required Content | OpenCode Target | Status |
|---|---|---|---|
| meet notices | one issue at a time, discussion before decision, current issue reminder | `src/plugin/hooks.ts` | Partial |
| decide notices | discussion support before `[d]`, active issue reminder | `src/plugin/hooks.ts` | Partial |
| run notices | decompose first, task add first, briefing before delegation, QA trigger hints | `src/plugin/hooks.ts` | Partial |
| completion notices | verify -> sync -> close | `src/plugin/hooks.ts` | Partial |
| no-tag state reminders | active meet, active tasks, completed-not-closed, blocked work | `src/plugin/hooks.ts` | Partial |

## Template Inventory

| Area | Required Content | OpenCode Target | Status |
|---|---|---|---|
| orchestration overview | agent routing, tags, skill list | `templates/nexus-section.md` | Present |
| operational rules | task pipeline, branch guard, meet/run expectations, group semantics | `templates/nexus-section.md` | Partial |
| platform mapping | OpenCode equivalents for Claude concepts | `templates/nexus-section.md` | Missing |

## Required Cross-Cutting Normalization

1. Evidence requirement for impossibility, infeasibility, and platform-limitation claims.
2. Shared escalation/reporting contracts for HOW/DO/CHECK categories.
3. Read-only diagnostics policy for advisory agents.
4. PASS/FAIL plus severity reporting for CHECK agents.
5. Citation, contradicting-evidence, and null-result rules for research-oriented roles.
6. Bounded retry / stop-and-escalate rules for repeated failures.
7. Artifact-writing rules where OpenCode tooling supports dedicated artifact outputs.

## Execution Order

1. Expand agent prompts.
2. Expand skill prompts.
3. Expand system injection.
4. Expand hook coaching.
5. Expand AGENTS template.
6. Add regression checks for prompt completeness.
