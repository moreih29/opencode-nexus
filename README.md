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

## Operations Docs

- `docs/operations.md`: runtime workflow, tags, and guardrails
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

This plugin is a parity-focused migration of `claude-nexus`, but it is not yet full parity.

- Strong today: hook guardrails, task/meet state tools, 9-agent catalog, system prompt injection
- Partial today: procedural skill behavior, setup/onboarding workflows, code intelligence depth
- Planned parity work remains for `nx-init`, `nx-sync`, `nx-setup`, richer meet/run workflows, and safer code-intel operations

## Notes

- `.opencode/agents` and `.opencode/skills` are consumer-project resources.
- This plugin package focuses on runtime hooks and custom tools.
