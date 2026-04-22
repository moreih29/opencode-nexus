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
npm install -g opencode-nexus@0.13.0
opencode-nexus install
```

For a one-off run:

```bash
npx opencode-nexus@0.13.0 install
```

You can also install it with Bun.

```bash
bun install -g opencode-nexus@0.13.0
opencode-nexus install
```

## What `install` does

In an interactive terminal, `opencode-nexus install` walks through:

1. selecting the install scope
2. deciding whether to configure agent models now

It then applies the following:

- creates or merges `opencode.json`
- copies Nexus skills into `.opencode/skills/`
- pins the plugin to the exact currently running CLI version

For example, on `0.13.0` it writes:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-nexus@0.13.0"],
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

```bash
bun install
bun run sync
bun run check
bun run test:e2e
```
