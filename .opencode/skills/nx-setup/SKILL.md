---
name: nx-setup
description: Thin entrypoint for Nexus setup. Use this when you want to explicitly configure OpenCode for opencode-nexus.
---

# nx-setup

This is a thin entrypoint command for Nexus setup.

Use the canonical `nx_setup` tool to perform the work. Do not invent a parallel workflow.

## Default action

- Call `nx_setup(scope="project", profile="auto", statusline_preset="minimal", install_plugin=true, init_after_setup=false)` unless the user explicitly requests different setup behavior.
- Report generated files, selected scope/profile, and the next recommended action.

## When to use

- First-time OpenCode setup for a project
- Reapplying Nexus instructions or config after drift
- Explicit user request to configure opencode-nexus

## Notes

- `nx_setup` remains the canonical backend.
- Recommend `nx-init` after setup when project knowledge has not been initialized yet.
