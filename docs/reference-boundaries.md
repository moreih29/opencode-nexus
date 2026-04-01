# Reference Boundaries

This document separates current OpenCode runtime behavior from historical or legacy `claude-nexus` source concepts.

## Categories

| Category | Meaning | Current Examples |
|---|---|---|
| runtime | Active `opencode-nexus` behavior in this repository | `AGENTS.md`, `opencode.json`, plugin hooks, custom tools |
| legacy compatibility | Input or concepts still read to help migration | `CLAUDE.md` as a migration source during `nx_init` |
| historical reference | Original source concepts kept for design comparison | `.claude-plugin`, Claude Code hook format, TeamCreate/SendMessage |
| docs debt | Wording that can still mislead users if left unclarified | Team semantics that sound like full Claude parity |

## Current Guidance

- Treat `docs/operations.md` and `docs/coverage-matrix.md` as the implementation truth.
- Treat `nexus-reference-for-opencode.md` as historical/source analysis, not a statement of current runtime support.
- Treat Claude-specific files or APIs as migration context only unless they are explicitly documented as active in OpenCode.

## Known Non-Parity Areas

- Claude slash-skill runtime is not present; `nx_init`, `nx_setup`, and `nx_sync` are exposed as OpenCode tools instead.
- Claude team APIs such as TeamCreate and SendMessage are not present; OpenCode uses lead-driven subagent coordination.
- `CLAUDE.md` is not the default instruction file in OpenCode; `AGENTS.md` and `opencode.json.instructions` are the primary path.
