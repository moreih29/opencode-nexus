# opencode-nexus

`opencode-nexus` is an OpenCode plugin that installs and maintains a Nexus Core-based agent, skill, and MCP setup.

- npm: https://www.npmjs.com/package/opencode-nexus
- License: https://github.com/moreih29/opencode-nexus/blob/main/LICENSE
- 한국어 README: https://github.com/moreih29/opencode-nexus/blob/main/README.md

## What does it do?

`opencode-nexus` aligns an OpenCode project with the Nexus wrapper defaults below.

- pins `plugin: ["opencode-nexus@<current-version>"]`
- registers `mcp.nx` (`nexus-mcp`)
- sets `default_agent: "lead"`
- hides the built-in OpenCode primary agents `build` and `plan`
- copies the Nexus Core skills:
  - `nx-auto-plan`
  - `nx-plan`
  - `nx-run`
- provides a model configuration flow for `lead`, `general`, `explore`, and the Nexus subagents

## Requirements

- `Node.js >= 22`
- OpenCode installed and usable in your environment

The CLI runs with `node`. You may install the package with `bun`, but the `opencode-nexus` command itself still executes with Node.

## Install

The recommended path is a global install.

```bash
npm install -g opencode-nexus@latest
opencode-nexus install
```

For a one-off run:

```bash
npx opencode-nexus@latest install
```

You can also install it with Bun.

```bash
bun install -g opencode-nexus@latest
opencode-nexus install
```

To pin to a specific version, replace `@latest` with `@x.y.z` (e.g. `npm install -g opencode-nexus@0.16.1`).

Check the installed CLI version with `opencode-nexus --version` or `opencode-nexus version`.

## What `install` does

In an interactive terminal, `opencode-nexus install` walks through:

1. selecting the install scope
2. deciding whether to configure agent models now

It then applies the following:

- creates or merges `opencode.json`
- copies Nexus skills into `.opencode/skills/`
- pins the plugin to the exact currently running CLI version

`install` always pins the plugin entry to the **currently running CLI version**. For example, if the installed CLI is `0.16.1`, it writes:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-nexus@0.16.1"],
  "mcp": {
    "nx": {
      "type": "local",
      "command": ["nexus-mcp"]
    }
  },
  "default_agent": "lead"
}
```

It also normalizes these defaults:

- `agent.build.disable: true`
- `agent.plan.disable: true`

## Scope

- `project`: writes to `./opencode.json`
- `user`: writes to `~/.config/opencode/opencode.json`
- `both`: splits writes across user and project scope

To set the scope directly:

```bash
opencode-nexus install --scope=project
```

To skip the model wizard:

```bash
opencode-nexus install --scope=project --skip-models
```

## Agent Models

You can reopen the model picker at any time.

```bash
opencode-nexus models
```

Supported targets:

- `lead`
- OpenCode built-ins: `general`, `explore`
- Nexus subagents:
  - `architect`
  - `designer`
  - `postdoc`
  - `strategist`
  - `engineer`
  - `researcher`
  - `writer`
  - `reviewer`
  - `tester`

The interactive flow lets you:

- select multiple agents at once
- choose a provider
- choose a model
- return to the main screen and repeat

For automation or scripting, direct mode is available.

```bash
opencode-nexus models --scope=project --agents=lead,general,explore --model=openai/gpt-5.4
```

## Uninstall

To revert the Nexus configuration that was installed, use the `uninstall` command.

```bash
opencode-nexus uninstall --scope=project
```

Supported scopes are `project`, `user`, and `both`. The description in the `Scope` section applies to uninstall as well.

In an interactive terminal, omitting `--scope` shows the same scope picker as install. Without `--force`, a confirmation prompt appears: `Remove opencode-nexus config from <scope>?`, defaulting to "Cancel" (no).

In non-TTY environments (CI or scripts), `--force` is required. Without it the command exits with the error `Use --force for non-interactive removal`.

```bash
opencode-nexus uninstall --scope=project --force
```

Pass `--dry-run` to print the removal plan without making any actual changes (mirrors install's `--dry-run`).

```bash
opencode-nexus uninstall --scope=project --dry-run
```

### What is reverted

Uninstall removes only the following items:

- The `opencode-nexus@*` entry from the `plugin` array (pin)
- The `mcp.nx` server registration
- `default_agent` when it is `"lead"`
- `agent.build.disable` and `agent.plan.disable` when they are `true`
- Copied Nexus skill directories under `.opencode/skills/`
  - `nx-auto-plan`
  - `nx-plan`
  - `nx-run`

### What is preserved

Other `plugin` entries you added manually, other `mcp` server registrations, other `agent` properties (such as model overrides), and `$schema` are kept intact in the default mode.

### Drift handling

If you changed `mcp.nx.command` or `default_agent` after installation (drift), the default mode prints a warning and preserves the drifted value. With `--force`, drifted values are also removed.

### Idempotency

Uninstall is safe to run twice. When there is nothing left to remove, it exits successfully (exit 0) with the message `nothing to remove for scope: ... (no opencode-nexus markers found)`.

### Empty-container cleanup

After leaf removal, if the `plugin` array becomes empty or the `mcp` object becomes empty, the key itself is removed. If `agent.build` or `agent.plan` becomes empty, the parent `agent` key is cleaned up as well. If `opencode.json` becomes a completely empty object, the file itself is deleted. Parent skill directories (`.opencode/skills/`, `.opencode/`) are also removed when empty.

## cmux integration (desktop notifications)

If you run OpenCode inside the [cmux](https://github.com/coder/mux) desktop app, the Nexus plugin automatically posts native OS notifications at two lifecycle points:

- **Response ready**: Lead finishes a turn and the session returns to idle waiting for your input.
- **Waiting for your input**: Lead or any subagent invokes the `question` tool.

The integration activates only when cmux's `CMUX_WORKSPACE_ID` env var is present (cmux injects it automatically in its terminals). Outside cmux the notification code is a no-op, so other environments are unaffected.

To disable, export the following in your shell:

```bash
export OPENCODE_NEXUS_CMUX=0
```

When cmux is not installed, or when the env var is absent, all notify calls fall back silently and the rest of the plugin continues to work.

### Sidebar status

The cmux sidebar displays a status pill alongside the notifications.

- `Running` — `bolt` icon, blue (`#007AFF`). When the agent is actively working.
- `Needs Input` — `bell` icon, blue. Whenever the agent is waiting for user input (both the `question` tool and permission requests).

Status is tracked for the root session only (subagent states are excluded, same as the existing `session.idle` policy).

### Permission notification

When the agent requests permission, a `"Permission requested"` toast is shown and the sidebar pill switches to `Needs Input`.

### Error log · notification

When `session.error` occurs, the sidebar logs it at the `error` level (`cmux log --level error --source nexus`) and shows a `"Session error"` toast.

Retries (`session.status: retry`) are logged to the sidebar at the `warning` level without a toast (minimizing noise).

The new status indicators and notifications are also disabled by the same `OPENCODE_NEXUS_CMUX` flag.

## Upgrade

To upgrade, install the new CLI version first and then rerun `install`.

```bash
npm install -g opencode-nexus@latest
opencode-nexus install --scope=project
```

`install` always pins the version of the currently running CLI. If you want a different plugin version, first install that CLI version and then rerun `install`.

## What this package ships

This repository provides a thin OpenCode wrapper on top of `@moreih29/nexus-core`.

- runtime plugin entry
- install / models CLI
- generated OpenCode agents
- bundled OpenCode skills

The canonical orchestration rules and specifications still come from `@moreih29/nexus-core`.

## Development

This repo dogfoods itself by installing `opencode-nexus` into its own `.opencode/`. All install outputs — `opencode.json`, `.opencode/skills/`, and the supporting files under `.opencode/` — are gitignored, so you need to bootstrap once after cloning. Per-agent model picks are provider-specific personal preferences and are **not** tracked; configure them yourself with `opencode-nexus models`.

```bash
bun install
bun run bootstrap       # sync + write baseline opencode.json + install into .opencode/
opencode-nexus models   # (optional) pick per-agent models for your providers
bun run check
bun run test:e2e
```

When bumping `@moreih29/nexus-core`, run `bun run sync` to regenerate `skills/` and `src/agents/`, and re-run `bun run bootstrap` whenever you want the local `.opencode/` and the plugin pin in `opencode.json` to catch up. `bootstrap` does not overwrite per-agent model overrides you have already set.
