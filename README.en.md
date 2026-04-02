# opencode-nexus

[![npm version](https://img.shields.io/npm/v/opencode-nexus)](https://www.npmjs.com/package/opencode-nexus)

> [한국어](README.md)

Nexus orchestration plugin for OpenCode.

`opencode-nexus` ports the core workflow of `claude-nexus` into OpenCode so you can run structured decision meetings, task-driven execution, and persistent project knowledge without rebuilding the workflow by hand.

## Why

OpenCode gives you agents, tools, and plugins. `opencode-nexus` adds operating discipline on top of that.

- Decide before implementation with `[meet]`
- Execute through explicit task state with `[run]`
- Keep project knowledge in `.nexus/`
- Use built-in Nexus tools instead of loose prompt rituals
- Add guardrails around editing, delegation, verification, and cycle closure

## Quick Start

Install the plugin in your project config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-nexus"],
  "instructions": ["AGENTS.md"]
}
```

Or start from the included presets:

- Minimal: `opencode.minimal.json`
- Extended example: `opencode.example.json`

Then run setup inside your project:

```text
Use nx_setup to configure this repository for opencode-nexus.
```

`nx_setup` now supports setup profiles.

- `auto` default: adds the package plugin in normal projects, but prefers the local plugin shim and skips package plugin registration in self-hosting repositories.
- `full`: merge package plugin and instructions
- `minimal`: instruction-focused minimal setup
- `legacy-compat`: keep legacy package plugin registration behavior

When the plugin injects config, the preferred default primary is `nexus` instead of `build`. `nexus` is the Nexus-aware orchestration lead that prioritizes state, task discipline, and delegation.

## Developing Inside This Repository

Inside this repository, use the local plugin shim in `.opencode/plugins/opencode-nexus.js` instead of the npm package entry.

- The repo `opencode.json` keeps only `instructions`; plugin loading is handled by `.opencode/plugins/`.
- The local shim points to `../../dist/index.js`, so `bun run build` must succeed first.
- After changing source files, run `bun run build` again before checking behavior in OpenCode.

Recommended self-hosting flow:

```text
1. bun install
2. bun run build
3. launch OpenCode from this repository root
4. confirm Nexus tools such as nx_context or nx_setup are available
```

Important:

- Do not add `"plugin": ["opencode-nexus"]` back into this repo's `opencode.json` while developing locally. That can load both the npm plugin and the local plugin and make validation ambiguous.
- Use the npm plugin config from the Quick Start section only in other projects that consume the published package.
- In this repository, `nx_setup(profile="auto")` detects that conflict and avoids writing the package plugin entry back into `opencode.json`.

Recommended first run:

```text
Use nx_init to scan this project and create initial Nexus knowledge.
```

## First Use

- Meeting: `[meet] How should we design the authentication flow?`
- Record a decision: `Let's go with that option [d]`
- Execution: `[run] Implement the agreed authentication flow`

## Tags

| Tag | Purpose | Example |
| --- | --- | --- |
| `[meet]` | Open decision mode before implementation | `[meet] discuss database migration strategy` |
| `[run]` | Execute work through Nexus task pipeline | `[run] implement the migration plan` |
| `[d]` | Record the current meeting decision | `Use option 2 [d]` |
| `[rule]` | Save durable team conventions | `[rule:testing] always run typecheck before publish` |

## Built-in Agents

| Category | Agent | Role |
| --- | --- | --- |
| HOW | Architect | Architecture and technical design review |
| HOW | Designer | UI/UX and interaction design |
| HOW | Postdoc | Methodology and evidence synthesis |
| HOW | Strategist | Product and direction framing |
| DO | Engineer | Implementation and debugging |
| DO | Researcher | Independent investigation |
| DO | Writer | Documentation and written deliverables |
| CHECK | QA | Tests, verification, and risk review |
| CHECK | Reviewer | Content and factual review |

## Built-in Skills

| Skill | Trigger | Purpose |
| --- | --- | --- |
| `nx-meet` | `[meet]` | Structured discussion and decision workflow |
| `nx-run` | `[run]` | Task-driven execution workflow |
| `nx-init` | tool | Project onboarding and initial knowledge generation |
| `nx-sync` | tool | Sync archived execution knowledge back into `.nexus/core/` |
| `nx-setup` | tool | Configure `AGENTS.md` and `opencode.json` for OpenCode |

## What It Adds To OpenCode

- 9-agent Nexus catalog mapped to HOW / DO / CHECK roles
- Default `nexus` primary paired with specialist subagents
- Stateful meet and task workflow stored in `.nexus/state/`
- HOW-panel continuity through OpenCode sidecar state (`meet.opencode.json`) separate from canonical `.nexus`
- Resume hints per HOW participant via stored `task_id` / `session_id` handles when OpenCode provides them
- `nx_meet_resume` to inspect a HOW participant's current resume handle before follow-up delegation
- `nx_meet_followup` to produce delegation-ready HOW participant follow-up input
- `.nexus/core/` knowledge layers for identity, codebase, reference, and memory
- Task pipeline guardrails for edit tools
- Meeting reminders, run notices, and stronger cycle-close discipline
- Nexus custom tools such as `nx_meet_*`, `nx_task_*`, `nx_context`, `nx_briefing`, `nx_init`, `nx_sync`, and `nx_setup`
- Structured meet discussion records and meet -> task linkage state

## Knowledge Layout

`opencode-nexus` stores project knowledge and workflow state in `.nexus/`.

- `core/` — durable project knowledge
- `rules/` — team conventions
- `config.json` — Nexus config
- `history.json` — archived cycles
- `state/` — active runtime state such as meet/task/run trackers

## Important Notes

- `AGENTS.md` is the primary OpenCode instruction file.
- `CLAUDE.md` is treated only as legacy migration input.
- This project is an OpenCode-native migration of `claude-nexus`, not full parity yet.
- Strong today: hooks, task/meet state tools, agent catalog, system guidance.
- Partial today: deeper code intelligence coverage and some workflow parity details.

## Docs

- `docs/operations.md` — runtime workflow and guardrails
- `docs/coverage-matrix.md` — implementation coverage snapshot
- `docs/prompt-parity-plan.md` — parity tracking against `claude-nexus`
- `docs/reference-boundaries.md` — legacy vs current OpenCode behavior

## License

MIT
