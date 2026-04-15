# OpenCode Skill Invocation

OpenCode's official docs distinguish between skills and slash commands.

- Skills live under `.opencode/skills/<name>/SKILL.md`.
- Agents load them with the native `skill` tool, for example `skill({ name: "nx-init" })`.
- Custom slash commands live under `.opencode/commands/*.md` and are a separate feature.

For Nexus on OpenCode, treat the following as the canonical skill loads:

- `skill({ name: "nx-init" })` — project onboarding
- `skill({ name: "nx-setup" })` — setup workflow
- `skill({ name: "nx-plan" })` — planning skill
- `skill({ name: "nx-run" })` — execution skill
- `skill({ name: "nx-sync" })` — context sync skill

Plugin-specific tag triggers may also route to some skills:

- `[plan]` / `[plan:auto]` — nx-plan
- `[run]` — nx-run
- `[sync]` — nx-sync

These tags are Nexus consumer behavior, not the generic OpenCode skill syntax.
