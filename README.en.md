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

### 1. Install via CLI

Install the `opencode-nexus` package globally and register the plugin in your OpenCode config.

```bash
# Install globally
npm install -g opencode-nexus

# Show the installed CLI version
opencode-nexus --version

# Run the interactive installer in a terminal
opencode-nexus install

# Install to user scope (~/.config/opencode/opencode.json)
opencode-nexus install --scope user

# Or install to project scope (./opencode.json)
opencode-nexus install --scope project
```

When you run `opencode-nexus install` or `opencode-nexus update` without flags in a terminal, the CLI prompts for scope and pinning choices interactively. For scripts and automation, keep passing explicit flags for deterministic non-interactive behavior.

**Scope** determines the location of the OpenCode config file:
- `user` — `~/.config/opencode/opencode.json` (shared across all projects)
- `project` — `./opencode.json` (project-specific)

> **Note**: Scope here refers to the target location of the OpenCode config file, not npm installation scope.

### 2. Update Plugin

After installing a new version, update the plugin version in your config.

```bash
# Run the interactive updater in a terminal
opencode-nexus update

# Update to latest version
opencode-nexus update --scope user

# Pin to a specific version
opencode-nexus update --scope user --version 0.7.0
```

> **Important**: OpenCode does not automatically refresh cached npm plugin versions on startup. Run the CLI update command above explicitly to apply new versions.

### 3. Project Onboarding (nx-init)

After installation, initialize project knowledge.

```text
Use nx-init to scan this project and create initial Nexus knowledge.
```

This entrypoint routes to the canonical `nx_init` tool, which analyzes project structure and creates initial knowledge files in `.nexus/`.

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
4. confirm Nexus tools such as nx_context or nx_init are available
```

Important:

- Do not add `"plugin": ["opencode-nexus"]` back into this repo's `opencode.json` while developing locally. That can load both the npm plugin and the local plugin and make validation ambiguous.
- Use the CLI installation flow from the Quick Start section only in other projects that consume the published package.

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
| `nx-init` | `nx_init` | Project onboarding and initial knowledge generation |
| `nx-sync` | `nx_sync` | Synchronize `.nexus/context/` design documents with current project state |

## Tags

| Tag | Purpose | Example |
| --- | --- | --- |
| `[plan]` | Open decision mode before implementation | `[plan] discuss database migration strategy` |
| `[run]` | Execute work through Nexus task pipeline | `[run] implement the migration plan` |
| `[sync]` | Sync `.nexus/context/` docs with current code state | `[sync] refresh context docs after recent code changes` |
| `[m]` | Save non-recoverable knowledge into `.nexus/memory/` under memory policy | `[m] save the incident takeaway` |
| `[m:gc]` | Policy-based manual GC (merge first, git-recoverable deletion) | `[m:gc] clean up overlapping memory notes` |
| `[d]` | Record the current meeting decision | `Use option 2 [d]` |
| `[rule]` | Save durable team conventions | `[rule:testing] always run typecheck before publish` |

### Memory Policy (`[m]`, `[m:gc]`)

- `[m]` stores only **non-recoverable working knowledge**.
- Use lowercase kebab-case `.md` filenames with descriptive topics; avoid dates/versions in filenames.
- Prefer canonical category prefixes: `empirical-`, `external-`, `pattern-`.
- Follow **merge-before-create**: update an existing related memory file before creating a new one.
- `[m:gc]` is **manual by default**. Merge before delete, and keep deletions git-recoverable.
- Successful `read` operations on real `.nexus/memory/*.md` files upsert access records in `.nexus/state/opencode-nexus/memory-access.jsonl`.

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
| CHECK | Tester | Tests, verification, and risk review |
| CHECK | Reviewer | Content and factual review |

## Canonical Tools and Tags

`nx_*` tools are the real execution contract. `nx-init` and `nx-sync` are thin entrypoints that route into those tools. `[plan]`, `[run]`, `[d]`, and `[rule]` are Coordination Tags that change workflow mode rather than execute a tool directly.

## Built-in Skills

| Skill | Trigger | Purpose |
| --- | --- | --- |
| `nx-plan` | `[plan]` | Structured discussion and decision workflow |
| `nx-run` | `[run]` | Task-driven execution workflow |
| `nx-init` | `nx-init` | Onboarding entrypoint that routes to `nx_init` |
| `nx-sync` | `nx-sync` | Sync entrypoint that routes to `nx_sync` |

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
- Nexus custom tools such as `nx_plan_*`, `nx_task_*`, `nx_context`, `nx_history_search`, `nx_init`, and `nx_sync`
- Structured plan discussion records and plan -> task linkage state

## Knowledge Layout

`opencode-nexus` stores project knowledge and workflow state in `.nexus/`.

- `context/` — static design documents (architecture, orchestration, principles, etc.)
- `memory/` — lessons learned, references, anti-patterns
- `rules/` — team conventions
- `history.json` — archived cycles
- `state/` — active runtime state such as plan/task/run trackers

## Important Notes

- `AGENTS.md` is the primary OpenCode instruction file.
- `CLAUDE.md` is treated only as legacy migration input.
- This project is an OpenCode sibling runtime that consumes the same shared spec as `claude-nexus`; it does not aim for strict one-to-one parity.
- Strong today: hooks, task/plan state tools, agent catalog, system guidance.
- Partial today: deeper code intelligence coverage and some workflow parity details.

## Docs

- `docs/operations.md` — runtime workflow and guardrails
- `docs/coverage-matrix.md` — implementation coverage snapshot
- `UPSTREAM.md` — relationship with claude-nexus and `@moreih29/nexus-core`
- `docs/reference-boundaries.md` — legacy vs current OpenCode behavior

## License

MIT
