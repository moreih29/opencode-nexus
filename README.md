# opencode-nexus

Nexus orchestration plugin for OpenCode.

This repository is a plugin package source. It is not a per-project `.opencode` preset.

## Install

Add the package to your OpenCode config plugin list.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-nexus"]
}
```

Minimal preset: `opencode.minimal.json`

Extended preset with agent and permission examples: `opencode.example.json`

`opencode-nexus` applies built-in Nexus presets through plugin hooks:

- 9-agent catalog (HOW/DO/CHECK) with tool policies
- skill-aware system prompt injection for `[meet]`, `[run]`, `[d]`, `[rule]`
- stateful meet/task reminders and stronger TASK PIPELINE guidance
- task pipeline guardrails for edit tools

## Development

This repository is Bun-first.

```bash
bun install
bun run check
bun run test:e2e
bun run generate:template
```

## Example Config

See `opencode.example.json` for a baseline setup with plugin registration, agent examples, and permissions.
For instruction delivery through OpenCode config, add `AGENTS.md` to `instructions` or run `nx_setup`.

## Operations Docs

- `docs/operations.md`: runtime workflow, tags, and guardrails
- `docs/reference-boundaries.md`: what remains as legacy or historical reference
- `docs/release-checklist.md`: release preparation checklist

## Structure

- `src/index.ts`: plugin entry (default export only)
- `src/agents/catalog.ts`: built-in 9-agent definitions
- `src/skills/catalog.ts`: built-in skill metadata
- `src/plugin/hooks.ts`: hook guardrails
- `src/tools/*`: Nexus custom tools (`nx_meet_*`, `nx_task_*`, `nx_core_*`, etc.)
- `src/tools/workflow.ts`: `nx_init` and `nx_sync` workflow tools
- `src/tools/setup.ts`: `nx_setup` for OpenCode config + `AGENTS.md` injection
- `src/shared/*`: paths, state, schemas, utilities

## Status

This plugin is an OpenCode-native migration of the original `claude-nexus` project, but it is not yet full parity.

- Strong today: hook guardrails, task/meet state tools, 9-agent catalog, system prompt injection
- Partial today: procedural skill behavior, setup/onboarding workflows, code intelligence depth
- Planned parity work remains for `nx-init`, `nx-sync`, `nx-setup`, richer meet/run workflows, and safer code-intel operations

## Reference Layers

- Current implementation truth: `docs/operations.md` and `docs/coverage-matrix.md`
- Historical/source analysis: `nexus-reference-for-opencode.md`
- Legacy migration notes and leftover source concepts: `docs/reference-boundaries.md`
- Team compatibility details: `docs/team-compatibility.md`
- OpenCode group coordination model: `docs/group-orchestration.md`

## Notes

- `.opencode/agents` and `.opencode/skills` are consumer-project resources.
- This plugin package focuses on runtime hooks and custom tools.
- `AGENTS.md` is the primary OpenCode instruction file. `CLAUDE.md` is treated only as a legacy migration input when scanning existing repositories.
