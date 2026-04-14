// AUTO-GENERATED — do not edit by hand.
// Source: @moreih29/nexus-core@0.6.0 (bcde383b56308b86006babe73f87fed9222c0761)
// Regenerate: bun run generate:prompts

export const PROMPT = `# nx-setup

Interactive setup wizard for OpenCode Nexus. Walk through each step in order. The backend tool is \`nx_setup\` — do not invent a parallel workflow.

---

## Step 1: Scope Selection

Ask the user:

> "Configure Nexus at project level (\`./opencode.json\`) or user level (\`~/.config/opencode/opencode.json\`)? [project/user, default: project]"

- **project** — wires this repository only; recommended for most cases
- **user** — applies globally across all projects on this machine

Call \`nx_setup\` with the selected scope:

\`\`\`
nx_setup(scope="project")   # or scope="user"
\`\`\`

This creates or updates \`opencode.json\`, injects the Nexus orchestration block into \`AGENTS.md\`, and installs the \`nx-init\`, \`nx-sync\`, and \`nx-setup\` skill entrypoints.

Report the generated files and resolved profile from the tool response before continuing.

---

## Step 2: Model Configuration (Key Differentiator)

OpenCode assigns a model independently to each agent. Nexus has 9 subagents across three categories:

| Category | Agents | Role |
|----------|--------|------|
| HOW | architect, designer, postdoc, strategist | Advisory — analysis and design, no file edits |
| DO | engineer, researcher, writer | Execution — implementation and output |
| CHECK | tester, reviewer | Verification — testing and fact-checking |
| Lead | nexus (primary) | Orchestration — delegates and coordinates |

Ask the user to choose a model preset:

> "Which model configuration would you like?
>
> 1. **unified** — same model for all agents (simple, consistent cost)
> 2. **tiered** — high-capability model for HOW agents, standard for DO/CHECK (quality where it matters)
> 3. **budget** — high-capability model for nexus lead only, budget model for all subagents (cost-optimized)
> 4. **custom** — specify per-agent or per-category
>
> [1-4, default: 2]"

For each preset, ask which specific model(s) to use. Examples: \`anthropic/claude-sonnet-4-5\`, \`anthropic/claude-haiku-4-5\`, \`openai/gpt-4o\`, \`openai/gpt-4o-mini\`.

Call \`nx_setup\` with the resolved model configuration:

**unified** (user chose \`anthropic/claude-sonnet-4-5\`):
\`\`\`
nx_setup(scope=<from step 1>, model_preset="unified", lead_model="anthropic/claude-sonnet-4-5")
\`\`\`

**tiered** (HOW = \`claude-sonnet-4-5\`, DO/CHECK = \`claude-haiku-4-5\`):
\`\`\`
nx_setup(scope=<from step 1>, model_preset="tiered", lead_model="anthropic/claude-sonnet-4-5")
\`\`\`
The tool automatically assigns \`lead_model\` to HOW agents and nexus, and a standard-tier model to DO/CHECK.

**budget** (lead = high-capability, subagents = budget):
\`\`\`
nx_setup(scope=<from step 1>, model_preset="budget", lead_model="anthropic/claude-sonnet-4-5")
\`\`\`

**custom**: ask the user which model for each agent or category, then call with explicit overrides:
\`\`\`
nx_setup(scope=<from step 1>, model_preset="skip", agent_models={"architect": "model/a", "engineer": "model/b", ...})
\`\`\`

If the user skips or has no preference, use \`model_preset="skip"\` — the existing models in opencode.json remain unchanged. Note that they can adjust \`agent.{id}.model\` in \`opencode.json\` at any time.

---

## Step 3: Permission Preset

Ask the user:

> "Which permission level?
>
> 1. **permissive** — all operations auto-approved (fastest; use in trusted, sandboxed environments)
> 2. **standard** — prompt for edits and bash; auto-approve reads and tasks (recommended)
> 3. **restrictive** — prompt for everything (maximum safety)
>
> [1-3, default: 2]"

Call \`nx_setup\` with the chosen preset:

\`\`\`
nx_setup(scope=<from step 1>, permission_preset="standard")
\`\`\`

- \`permissive\` → all operations auto-approved
- \`standard\` → asks for edits/bash, auto-approves reads/tasks, allows common git commands
- \`restrictive\` → asks for everything

The tool writes the matching permission glob rules into \`opencode.json\`.

---

## Step 4: MCP Extensions

Check whether context7 is configured:

- Read \`opencode.json\` (or \`~/.config/opencode/opencode.json\` for user scope)
- Look for \`"context7"\` in the \`mcp\` block

If context7 is NOT configured, recommend it:

> "context7 provides real-time library documentation lookup — it resolves current API docs at query time rather than relying on training data. Recommended for all development projects. Add it? [y/n]"

If yes, add to \`opencode.json\`:

\`\`\`json
"mcp": {
  "context7": {
    "type": "npx",
    "command": "npx",
    "args": ["-y", "@upstash/context7-mcp"]
  }
}
\`\`\`

Then ask:

> "Any other MCP servers to configure? (e.g., playwright for browser automation, filesystem for extended file access) [describe or skip]"

Apply additional MCP entries based on user response.

---

## Step 5: Knowledge Initialization

Check whether \`.nexus/context/\` exists in the project root.

If it does NOT exist (or is empty), inform the user:

> "Project knowledge has not been initialized. Nexus works best with a project identity (mission, architecture, principles) stored in \`.nexus/\`. Initialize now? [y/n]"

If yes, call:

\`\`\`
nx_setup(scope=<from step 1>, init_after_setup=true)
\`\`\`

This triggers \`nx_init\` automatically after setup completes. If the init returns \`identityNeedsConfirmation: true\`, display the drafted \`mission\`, \`design\`, and \`roadmap\` values and ask the user to confirm or revise before they are finalized.

If the user prefers to initialize separately, suggest:

> "Run \`/opencode-nexus:nx-init\` when ready to initialize project knowledge."

If \`.nexus/context/\` already exists, skip this step and note that knowledge is already present.

---

## Summary

After all steps complete, display:

1. **Scope**: project or user
2. **Config file**: path to \`opencode.json\`
3. **Instructions file**: path to \`AGENTS.md\`
4. **Model preset**: which preset was chosen and which models were assigned
5. **Permission profile**: which profile is active
6. **MCP servers**: which servers are now configured
7. **Knowledge**: initialized or pending

Show the resulting \`agent\` block from \`opencode.json\` so the user can verify model assignments.

Then recommend next steps:

- Start a planning session: type \`[plan]\` with a description of what you want to build or investigate
- Run a task directly: type \`[run]\` followed by an instruction
- Adjust models anytime by editing \`agent.{id}.model\` in \`opencode.json\`
`;

export const META = {
  id: "nx-setup",
  name: "nx-setup",
  description: "Interactive OpenCode setup wizard for Nexus orchestration. Configures models, permissions, plugins, and project knowledge.",
  trigger_display: "/opencode-nexus:nx-setup",
  purpose: "Interactive OpenCode setup wizard for Nexus orchestration. Configures models, permissions, plugins, and project knowledge.",
} as const;
