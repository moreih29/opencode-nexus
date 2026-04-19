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

### 1. Install via CLI and Migrate

Install the `opencode-nexus` package globally and register the plugin in your OpenCode config. If you have existing Nexus agent settings in `opencode.json`, consider migrating them to isolated config.

```bash
# Install globally
npm install -g opencode-nexus

# Show the installed CLI version
opencode-nexus --version

# Register the plugin (interactive)
opencode-nexus install

# Install to user scope (~/.config/opencode/opencode.json)
opencode-nexus install --scope user

# (Optional) Preview migration first
opencode-nexus migrate --scope user --dry-run

# Run actual migration (auto-creates .bak backup)
opencode-nexus migrate --scope user

# Or migrate project scope
opencode-nexus migrate --scope project --dry-run
opencode-nexus migrate --scope project
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
opencode-nexus update --scope user --version 0.8.0
```

> **Important**: OpenCode does not automatically refresh cached npm plugin versions on startup. Run the CLI update command above explicitly to apply new versions.

## Configuration

Nexus agent settings are managed in separate isolated config files. This is a plugin-specific configuration space separate from OpenCode's `opencode.json`.

### Config File Locations

| Scope | Path | Description |
|-------|------|-------------|
| global | `~/.config/opencode/opencode-nexus.jsonc` | Shared across all projects |
| project | `./.opencode/opencode-nexus.jsonc` | Project-specific |

Both files use JSONC format (comments allowed) and are auto-created if missing.

### Base Schema (v1)

```jsonc
{
  "version": 1,
  "agents": {
    "architect": {
      "model": "openai/gpt-5.4",
      "tools": {
        "write": true
      }
    },
    "engineer": {
      "model": "openai/gpt-5.3-codex"
    }
  }
}
```

### Allowed Fields

- `version`: Config schema version (currently 1)
- `agents.<id>.model`: Model for the agent (e.g., `openai/gpt-5.4`)
- `agents.<id>.tools`: Per-tool enablement (`true`/`false`)

### Allowed agentIds

You can configure 12 agents:

- **nexus** — Default primary agent
- **HOW**: architect, designer, postdoc, strategist
- **DO**: engineer, researcher, writer
- **CHECK**: tester, reviewer
- **Additional**: general, explore

### Restrictions

The following fields cannot be set in isolated config (protected by nexus-core canonical):

- `prompt`, `description` — Agent prompts are managed by nexus-core
- `mode`, `permission` — Execution mode and permissions cannot be overridden

Additionally, `task` and `nx_task_close` tools can never be enabled by any setting (hard-locked).

## Configuration Priority (Merge Chain)

Final agent settings are determined through a 5-step merge chain:

| Order | Source | Rule | Example |
|-------|--------|------|---------|
| 1 | nexus-core canonical defaults | baseline | `engineer.model = "openai/gpt-5.3-codex"` |
| 2 | isolated config global (`~/.config/opencode/opencode-nexus.jsonc`) | deep merge | Global common baseline |
| 3 | isolated config project (`./.opencode/opencode-nexus.jsonc`) | deep merge, project-specific override | Stronger model for specific projects |
| 4 | `opencode.json` user (`agent.<id>.model`, `agent.<id>.tools`) | deep merge, **final priority** | OpenCode native escape hatch |
| 5 | `TASK_DELEGATION_DISABLED_TOOLS` | forced overwrite | `task`, `nx_task_close` always disabled |

### Key Principles

- **isolated config = plugin baseline**: Safe configuration space managed by the plugin
- **opencode.json = escape hatch**: Final user control override
- **Missing isolated file → silent fallback**: Uses canonical defaults when file is absent
- **Parse error → log + empty fallback**: Plugin continues loading even on parse errors

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

## Model and Tool Customization

You can customize agent models and tool usage.

### Configure via CLI

```bash
# Batch set by HOW/DO/CHECK categories
opencode-nexus setup --scope user \
  --how-model openai/gpt-5.4 \
  --do-model openai/gpt-5.3-codex \
  --check-model openai/gpt-5.3-codex

# Set primary / builtin agents individually
opencode-nexus setup --scope user \
  --nexus-model openai/gpt-5.4 \
  --general-model openai/gpt-5.3-codex \
  --explore-model openai/gpt-5.3-codex

# Set all agents at once
opencode-nexus setup --scope user --all-model openai/gpt-5.3-codex
```

> 💡 To adjust a single subagent (e.g. only `architect`) or override tool policies, use [direct file editing](#edit-files-directly) instead. `setup` is designed for category-level batch configuration.

### Edit Files Directly

You can also edit config files directly:

```bash
# Edit global config
code ~/.config/opencode/opencode-nexus.jsonc

# Edit project config
code ./.opencode/opencode-nexus.jsonc
```

### Tool Override Example

By default, HOW agents (architect, etc.) cannot use file editing tools. You can enable them in isolated config for special cases:

```jsonc
{
  "version": 1,
  "agents": {
    "architect": {
      "model": "openai/gpt-5.4",
      "tools": {
        "write": true,
        "edit": true
      }
    }
  }
}
```

> ⚠️ Note: Tool overrides bypass the default permission policies of HOW/DO/CHECK categories. Use with caution.

## Migration

If you previously had Nexus agent model/tool settings in `opencode.json`, consider migrating to isolated config.

### Migration Commands

```bash
# Preview (no file changes)
opencode-nexus migrate --scope user --dry-run

# Run migration (auto-creates backup: opencode.json.pre-migrate-<timestamp>)
opencode-nexus migrate --scope user

# Skip backup
opencode-nexus migrate --scope user --no-backup

# On conflict, opencode.json values overwrite isolated config
# (default behavior: keep existing values in isolated config)
opencode-nexus migrate --scope user --overwrite
```

### Backward Compatibility

Migration is optional. Existing `opencode.json` Nexus agent settings will continue to work (Step 4 escape hatch). However, using isolated config separates plugin settings from OpenCode config for easier management.

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
