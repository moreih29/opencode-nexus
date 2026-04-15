// AUTO-GENERATED — do not edit by hand.
// Source: @moreih29/nexus-core@0.8.0 (254efc7d8f4f52e45b548706dd42389fdb9801b2)
// Regenerate: bun run generate:prompts

export const PROMPT = `# nx-setup

Interactive setup wizard for OpenCode Nexus. Walk through each step in order. The backend tool is \`nx_setup\` — do not invent a parallel workflow.

**Always respond in the user's language** — mirror their wording when asking questions, giving summaries, and making recommendations.

**Use OpenCode's interactive \`question\` tool for every user choice in this flow.** Do not ask setup questions in free-form chat when the user is choosing among known options. Present selectable options, keep \`multiple: false\` unless the step truly allows multiple selections, and rely on the tool's built-in custom answer path when the user needs to type a model name manually.

---

## Step 1: Scope Selection

Ask the user with the \`question\` tool:

> "Configure Nexus at user level (\`~/.config/opencode/opencode.json\`) or project level (\`./opencode.json\`)? [user/project, default: user]"

- **user** — applies globally across all projects on this machine (recommended)
- **project** — wires this repository only

Call \`nx_setup\` with the selected scope:

\`\`\`
nx_setup(scope="project")   # or scope="user"
\`\`\`

This creates or updates \`opencode.json\`, injects the Nexus orchestration block into \`AGENTS.md\`, and installs the \`nx-init\`, \`nx-sync\`, and \`nx-setup\` skill entrypoints.

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

Ask the user to choose a model configuration approach with the \`question\` tool:

> "How would you like to assign models?
>
> 1. **unified** — same model for all agents (simple, consistent cost)
> 2. **tiered** — high-capability for \`nexus\` + HOW, standard for DO + CHECK + built-in defaults (quality where it matters)
>
> [1-2, default: 2]"

For each approach, continue using the \`question\` tool for each follow-up choice. When the user needs to pick a model, always ask for the provider first, then ask for the model from that provider.

For \`tiered\`, run that provider-first pipeline twice:

1. select the high-capability provider and model for \`nexus\` + HOW
2. select the standard provider and model for DO + CHECK

Then explain built-in defaults clearly:

- default built-in setup surface: \`general\` and \`explore\` only
- default behavior: both inherit the standard tier model
- optional override: ask whether the user wants different models for \`general\` and/or \`explore\`

Use a provider-first flow:

1. Run \`opencode providers list\` to identify connected providers.
2. If none are connected, ask which provider the user plans to use and point them to \`/connect\` if needed.
3. Ask the user to choose one provider with the \`question\` tool.
4. Run \`opencode models <provider>\` for the chosen provider.
5. Show as many models from that provider as practical in the \`question\` tool options. If the list is too long, trim from the top of the returned list rather than collapsing to a tiny hand-picked subset.
6. Keep the tool's custom text entry path available so the user can type a model manually.

When a provider is connected, models should be shown in \`provider/model-id\` format (e.g., \`anthropic/claude-sonnet-4-5\`, \`openai/gpt-4o\`). Do not jump straight to arbitrary model suggestions when the provider has not been chosen yet.

Call \`nx_setup\` with the resolved model configuration. Use \`models\` as the canonical shape.

**unified** (same model everywhere):
\`\`\`
nx_setup(scope=<from step 1>, model_preset="unified", models={ unified: "<model>" })
\`\`\`

**tiered** (\`nexus\` + HOW = high-capability, DO + CHECK = standard):
\`\`\`
nx_setup(
  scope=<from step 1>,
  model_preset="tiered",
  models={
    nexus: "<high-capability model>",
    how: "<high-capability model>",
    do: "<standard model>",
    check: "<standard model>"
  }
)
\`\`\`

If the user wants optional built-in overrides, include:

\`\`\`
models={
  ...,
  agents: {
    general: "<optional override>",
    explore: "<optional override>"
  }
}
\`\`\`

Do not include hidden/system built-ins (\`compaction\`, \`title\`, \`summary\`) in the default model flow. Do not surface disabled \`build\`/\`plan\` in this step.

\`lead_model\` remains a backward-compatibility fallback only. Do not present it as the primary setup path.

If the user skips, use \`model_preset="skip"\` — existing models in \`opencode.json\` remain unchanged.

---

## Summary

After setup completes, display:

1. **Scope**: project or user
2. **Config file**: path to \`opencode.json\`
3. **Instructions file**: path to \`AGENTS.md\`
4. **Model configuration**: which approach was chosen and which models were assigned per category

Show the resulting \`agent\` block from \`opencode.json\` so the user can verify model assignments.

---

## Optional Follow-ups

After the main setup flow, optionally recommend:

**context7** (real-time library documentation):
Ask with the \`question\` tool.
> "context7 provides real-time API docs at query time. Add it? [y/n]"

If yes, add to \`opencode.json\`:
\`\`\`json
"mcp": {
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp"
  }
}
\`\`\`

**nx-init** (project knowledge initialization):
Ask with \`question({ questions: [...] })\`, for example:
> \`question({ questions: [{ question: "Initialize project knowledge (mission, architecture, principles) in .nexus/?", header: "Project knowledge", options: [{ label: "Initialize", description: "Run nx-init after setup" }, { label: "Skip", description: "Leave project knowledge unchanged" }], multiple: false }] })\`

If yes:
\`\`\`
nx_setup(scope=<from step 1>, init_after_setup=true)
\`\`\`

Or load \`skill({ name: "nx-init" })\` separately when ready.

---

## Next Steps

- Start a planning session: type \`[plan]\` with a description
- Run a task directly: type \`[run]\` followed by an instruction
- Adjust models anytime by editing \`agent.{id}.model\` in \`opencode.json\`
`;

export const META = {
  id: "nx-setup",
  name: "nx-setup",
  description: "Interactive OpenCode setup wizard for Nexus orchestration. Configures models, permissions, plugins, and project knowledge.",
  trigger_display: "skill({ name: \"nx-setup\" })",
  purpose: "Interactive OpenCode setup wizard for Nexus orchestration. Configures models, permissions, plugins, and project knowledge.",
} as const;
