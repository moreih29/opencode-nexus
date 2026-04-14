---
name: nx-setup
description: Interactive OpenCode setup wizard for Nexus orchestration. Configures models, permissions, plugins, and project knowledge.
---

# nx-setup

Interactive setup wizard for OpenCode Nexus. Walk through each step in order. The backend tool is `nx_setup` — do not invent a parallel workflow.

**Always respond in the user's language** — mirror their wording when asking questions, giving summaries, and making recommendations.

**Use OpenCode's interactive `question` tool for every user choice in this flow.** Do not ask setup questions in free-form chat when the user is choosing among known options. Present selectable options, keep `multiple: false` unless the step truly allows multiple selections, and rely on the tool's built-in custom answer path when the user needs to type a model name manually.

---

## Step 1: Scope Selection

Ask the user with the `question` tool:

> "Configure Nexus at user level (`~/.config/opencode/opencode.json`) or project level (`./opencode.json`)? [user/project, default: user]"

- **user** — applies globally across all projects on this machine (recommended)
- **project** — wires this repository only

Call `nx_setup` with the selected scope:

```
nx_setup(scope="project")   # or scope="user"
```

This creates or updates `opencode.json`, injects the Nexus orchestration block into `AGENTS.md`, and installs the `nx-init`, `nx-sync`, and `nx-setup` skill entrypoints.

Report the generated files and resolved profile from the tool response before continuing.

---

## Step 2: Model Assignment

OpenCode assigns a model independently to each agent. Nexus has 9 subagents across three categories:

| Category | Agents | Role |
|----------|--------|------|
| HOW | architect, designer, postdoc, strategist | Advisory — analysis and design, no file edits |
| DO | engineer, researcher, writer | Execution — implementation and output |
| CHECK | tester, reviewer | Verification — testing and fact-checking |
| Lead | nexus (primary) | Orchestration — delegates and coordinates |

Ask the user to choose a model configuration approach with the `question` tool:

> "How would you like to assign models?
>
> 1. **unified** — same model for all agents (simple, consistent cost)
> 2. **tiered** — high-capability for HOW + nexus, standard for DO + CHECK (quality where it matters)
> 3. **custom** — specify per category (nexus, HOW, DO, CHECK) or per individual agent
>
> [1-3, default: 2]"

For each approach, continue using the `question` tool for each follow-up choice. If you know a small candidate set of models, present them as selectable options and allow the tool's custom text path for manual entry. Recommend discovery-first: run `opencode providers list` to see connected providers, `opencode debug config` to inspect current setup, and `opencode models <provider>` to list available models. Point users to `/connect` to set up a provider first if none are connected. When a provider is connected, models follow the `provider/model-id` format (e.g., `anthropic/claude-sonnet-4-5`, `openai/gpt-4o`).

Call `nx_setup` with the resolved model configuration:

**unified** (same model everywhere):
```
nx_setup(scope=<from step 1>, model_preset="unified", lead_model="<model>")
```

**tiered** (HOW + nexus = high-capability, DO + CHECK = standard):
```
nx_setup(scope=<from step 1>, model_preset="tiered", lead_model="<high-capability model>")
```

**custom** (per-category or per-agent overrides):
```
nx_setup(scope=<from step 1>, models={
  "unified": "<fallback model>",
  "nexus": "<nexus model or skip>",
  "how": "<how model or skip>",
  "do": "<do model or skip>",
  "check": "<check model or skip>",
  "agents": {"<agent-id>": "<model>", ...}
})
```

If the user skips, use `model_preset="skip"` — existing models in `opencode.json` remain unchanged.

---

## Summary

After setup completes, display:

1. **Scope**: project or user
2. **Config file**: path to `opencode.json`
3. **Instructions file**: path to `AGENTS.md`
4. **Model configuration**: which approach was chosen and which models were assigned per category

Show the resulting `agent` block from `opencode.json` so the user can verify model assignments.

---

## Optional Follow-ups

After the main setup flow, optionally recommend:

**context7** (real-time library documentation):
Ask with the `question` tool.
> "context7 provides real-time API docs at query time. Add it? [y/n]"

If yes, add to `opencode.json`:
```json
"mcp": {
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp"
  }
}
```

**nx-init** (project knowledge initialization):
Ask with the `question` tool.
> "Initialize project knowledge (mission, architecture, principles) in `.nexus/`? [y/n]"

If yes:
```
nx_setup(scope=<from step 1>, init_after_setup=true)
```

Or run `/opencode-nexus:nx-init` separately when ready.

---

## Next Steps

- Start a planning session: type `[plan]` with a description
- Run a task directly: type `[run]` followed by an instruction
- Adjust models anytime by editing `agent.{id}.model` in `opencode.json`
