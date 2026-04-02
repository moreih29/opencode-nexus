---
name: nx-init
description: Thin entrypoint for Nexus project onboarding. Use this when you want to explicitly initialize Nexus knowledge for the current repository.
---

# nx-init

This is a thin entrypoint command for Nexus onboarding.

Use the canonical `nx_init` tool to perform the work. Do not invent a parallel workflow.

## Default action

- Call `nx_init(reset=false, setup_rules=false)` unless the user explicitly asks for reset, cleanup, or rule scaffolding.
- Report the returned mode, generated files, any `confirmationQuestions`, and the suggested next step.
- If `identityNeedsConfirmation` is true, ask the user to confirm `mission`, `design`, and `roadmap`, then rerun `nx_init` with those explicit values.

## When to use

- First-time onboarding for a repository
- Rebuilding Nexus core knowledge after setup
- Explicit user request to initialize or reinitialize Nexus knowledge

## Notes

- `nx_init` remains the canonical backend.
- Generated identity drafts are not final until the user explicitly confirms them.
- If the user needs project wiring first, recommend `nx-setup` before continuing.
