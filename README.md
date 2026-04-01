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

## Development

This repository is Bun-first.

```bash
bun install
bun run check
bun run test:e2e
```

## Example Config

See `opencode.example.json` for a baseline setup with plugin registration, agent examples, and permissions.

## Operations Docs

- `docs/operations.md`: runtime workflow, tags, and guardrails
- `docs/release-checklist.md`: release preparation checklist

## Structure

- `src/index.ts`: plugin entry (default export only)
- `src/plugin/hooks.ts`: hook guardrails
- `src/tools/*`: Nexus custom tools (`nx_meet_*`, `nx_task_*`, `nx_core_*`, etc.)
- `src/shared/*`: paths, state, schemas, utilities

## Notes

- `.opencode/agents` and `.opencode/skills` are consumer-project resources.
- This plugin package focuses on runtime hooks and custom tools.
