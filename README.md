# opencode-nexus

`opencode-nexus` is a thin OpenCode wrapper around `@moreih29/nexus-core`.

It only wires the surfaces that `nexus-core` expects an OpenCode consumer to provide:

- pinned npm plugin entry: `plugin: ["opencode-nexus@0.13.0"]`
- local MCP server: `mcp.nx -> ["nexus-mcp"]`
- runtime agent registration for `lead` plus the Nexus subagents
- core skills only: `nx-auto-plan`, `nx-plan`, `nx-run`

It does not add extra skills, extra runtime behavior, or OpenCode-only orchestration outside the Nexus Core contract.

## Install

The CLI runs with `node`, so `Node.js >= 22` is required.

`bun` is supported for package installation, but the `opencode-nexus` command itself still executes with Node.

Global CLI install via npm is the recommended path.

```bash
npm install -g opencode-nexus@0.13.0
opencode-nexus install
```

This writes a pinned plugin entry for the exact installed package version. For `0.13.0`, the generated config contains:

```json
{
  "plugin": ["opencode-nexus@0.13.0"]
}
```

When `install` runs in an interactive terminal, it walks through:

1. scope selection (`project` or `user`)
2. whether to configure agent models now

`install` always pins the exact version of the currently running CLI. If you want a different plugin version, first install that CLI version, then run `opencode-nexus install` again.

Install also sets the OpenCode defaults expected by Nexus:

- `default_agent: "lead"`
- `agent.build.disable: true`
- `agent.plan.disable: true`

If you prefer a one-off install without a global CLI:

```bash
npx opencode-nexus@0.13.0 install
```

If you prefer Bun for installation, that is also supported:

```bash
bun install -g opencode-nexus@0.13.0
opencode-nexus install
```

Skip the model wizard when needed:

```bash
opencode-nexus install --scope=project --skip-models
```

Supported scopes:

- `project`: writes `./opencode.json`, sets `default_agent`, and copies skills to `./.opencode/skills/`
- `user`: writes `~/.config/opencode/opencode.json`, sets `default_agent`, and copies skills to `~/.config/opencode/skills/`
- `both`: writes `plugin` and `mcp.nx` to user config, `default_agent` to project config, and copies skills to project scope

Useful flags:

- `--dry-run`: print what would be written
- `--force`: overwrite `mcp.nx` or `default_agent` if they already exist with different values

## Upgrade

Upgrade the global CLI to the version you want, then rerun `install` so the pinned plugin entry and copied skills are refreshed.

```bash
npm install -g opencode-nexus@latest
opencode-nexus install --scope=project
```

With Bun:

```bash
bun install -g opencode-nexus@latest
opencode-nexus install --scope=project
```

If the global install resolves to `0.14.0`, rerunning `install` rewrites the plugin entry to `opencode-nexus@0.14.0`.

## Agent Models

You can reopen the agent model picker at any time:

```bash
opencode-nexus models
```

When `models` runs without `--scope`, it asks whether to write to project or user config first.

The picker supports:

- `lead`
- OpenCode built-ins: `general`, `explore`
- Nexus subagents: `architect`, `designer`, `postdoc`, `strategist`, `engineer`, `researcher`, `writer`, `reviewer`, `tester`

The interactive screen keeps the agent checkboxes and the `Next` / `Done` / `Cancel` actions on the same TTY view. Use `Space` to toggle agents, move to `Next`, then press `Enter` to choose a provider and model.

For automation or scripting, you can also set agent models directly:

```bash
opencode-nexus models --scope=project --agents=lead,architect --model=openai/gpt-5.4
```

## Generated From Nexus Core

These paths are synced from `nexus-core` and should be treated as generated outputs:

- `src/agents/*.ts`
- `skills/*/SKILL.md`

`src/plugin.ts` is the OpenCode-specific consumer layer. It injects generated agent definitions into OpenCode config at runtime and wires the Nexus hook behavior that `nexus-core` leaves to the consumer.

## Development

```bash
bun install
bun run sync
bun run check
bun run test:e2e
```

The legacy implementation history remains archived in `./.legacy/` for reference only.
