# opencode-nexus

[![npm version](https://img.shields.io/npm/v/opencode-nexus)](https://www.npmjs.com/package/opencode-nexus)

> [한국어](README.md)

Nexus orchestration plugin for OpenCode.

`opencode-nexus` and `claude-nexus` are sibling projects built on the same `@moreih29/nexus-core`. Instead of ad-hoc prompts, you get structured planning, task-driven execution, and persistent project knowledge in OpenCode.

## Why

OpenCode gives you agents, tools, and plugins. `opencode-nexus` adds operating discipline on top of that.

- Decide before implementation with `[plan]`
- Execute through explicit task state with `[run]`
- Keep project knowledge in `.nexus/`
- Use built-in Nexus tools instead of loose prompt rituals
- Add guardrails around editing, delegation, verification, and cycle closure

## Quick Start

Use `Entrypoint Commands` to get started, `Canonical Tools` as the stable backend contract, and `Coordination Tags` to control workflow mode.

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

Then run the setup entrypoint inside your project:

```text
Use nx-setup to configure this repository for opencode-nexus.
```

This entrypoint routes to the canonical `nx_setup` tool, which handles two key setup decisions:

**Scope** — choose project level (`./opencode.json`) or user level (`~/.config/opencode/opencode.json`).

**Model assignment** — Nexus has 9 subagents across three categories. Choose an approach that fits your budget and quality needs:

| Approach | nexus + HOW | DO + CHECK |
|---|---|---|
| `unified` | same model everywhere | same model everywhere |
| `tiered` | high-capability | standard |
| `budget` | high-capability | budget |
| `custom` | per-category or per-agent overrides | per-category or per-agent overrides |

After setup, you can initialize project knowledge with an optional follow-up:

```text
Use nx-init to scan this project and create initial Nexus knowledge.
```

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
Use nx-init to scan this project and create initial Nexus knowledge.
```

This entrypoint routes to the canonical `nx_init` tool.

## First Use

- Meeting: `[plan] How should we design the authentication flow?`
- Record a decision: `Let's go with that option [d]`
- Execution: `[run] Implement the agreed authentication flow`

## Entrypoint Commands

| Entrypoint | Canonical Tool | Purpose |
| --- | --- | --- |
| `nx-setup` | `nx_setup` | Configure `AGENTS.md`, `opencode.json`, and thin Nexus entrypoint skills |
| `nx-init` | `nx_init` | Project onboarding and initial knowledge generation |
| `nx-sync` | `nx_sync` | Synchronize `.nexus/context/` design documents with current project state |

## Tags

| Tag | Purpose | Example |
| --- | --- | --- |
| `[plan]` | Open decision mode before implementation | `[plan] discuss database migration strategy` |
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

## Canonical Tools and Tags

`nx_*` tools are the real execution contract. `nx-setup`, `nx-init`, and `nx-sync` are thin entrypoints that route into those tools. `[plan]`, `[run]`, `[d]`, and `[rule]` are Coordination Tags that change workflow mode rather than execute a tool directly.

## Built-in Skills

| Skill | Trigger | Purpose |
| --- | --- | --- |
| `nx-plan` | `[plan]` | Structured discussion and decision workflow |
| `nx-run` | `[run]` | Task-driven execution workflow |
| `nx-init` | `nx-init` | Onboarding entrypoint that routes to `nx_init` |
| `nx-sync` | `nx-sync` | Sync entrypoint that routes to `nx_sync` |
| `nx-setup` | `nx-setup` | Setup entrypoint that routes to `nx_setup` |

## What It Adds To OpenCode

- 9-agent Nexus catalog mapped to HOW / DO / CHECK roles
- Default `nexus` primary paired with specialist subagents
- Stateful plan and task workflow stored in `.nexus/state/`
- HOW-panel continuity derived from canonical `plan.json` + session-scoped `.nexus/state/opencode-nexus/agent-tracker.json`
- Resume hints per HOW participant via runtime `task_id` / `session_id` handles when OpenCode provides them (ephemeral, reset on session boundary)
- `nx_plan_resume` to inspect a HOW participant's current resume handle before follow-up delegation
- `nx_plan_followup` to produce delegation-ready HOW participant follow-up input
- Flat knowledge layout under `.nexus/context/` (design docs) and `.nexus/memory/` (lessons, references)
- Task pipeline guardrails for edit tools
- Meeting reminders, run notices, and stronger cycle-close discipline
- Nexus custom tools such as `nx_plan_*`, `nx_task_*`, `nx_context`, `nx_briefing`, `nx_init`, `nx_sync`, and `nx_setup`
- Structured plan discussion records and plan -> task linkage state

## Knowledge Layout

`opencode-nexus` stores project knowledge and workflow state in `.nexus/`.

- `context/` — static design documents (architecture, orchestration, principles, etc.)
- `memory/` — lessons learned, references, anti-patterns
- `rules/` — team conventions
- `config.json` — Nexus config
- `history.json` — archived cycles
- `state/` — active runtime state such as plan/task/run trackers

## Important Notes

- `AGENTS.md` is the primary OpenCode instruction file.
- `CLAUDE.md` is treated only as legacy migration input.
- This project is an OpenCode-native migration of `claude-nexus`, not full parity yet.
- Strong today: hooks, task/plan state tools, agent catalog, system guidance.
- Partial today: deeper code intelligence coverage and some workflow parity details.

## Docs

- `docs/operations.md` — runtime workflow and guardrails
- `docs/coverage-matrix.md` — implementation coverage snapshot
- `UPSTREAM.md` — relationship with claude-nexus and `@moreih29/nexus-core`
- `docs/reference-boundaries.md` — legacy vs current OpenCode behavior

## License

MIT
