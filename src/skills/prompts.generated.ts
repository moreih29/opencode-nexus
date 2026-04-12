// AUTO-GENERATED — do not edit by hand.
// Source: @moreih29/nexus-core@0.1.2 (93d8d74493b8897a80e9de1342c0da5f0d04f6e2)
// Regenerate: bun run generate:prompts

export const SKILL_PROMPTS: Record<string, string> = {
  "nx-run": `## Role

Execution norm that Lead follows when the user invokes the [run] tag. Composes subagents dynamically based on user direction and drives the full execution pipeline from intake to completion.

## Constraints

- NEVER modify files via Bash (sed, echo >, cat <<EOF, tee, etc.) — always use Edit/Write tools (Gate enforced)
- NEVER terminate while pending tasks remain (Gate Stop nonstop)
- NEVER spawn a new branch without checking for main/master first
- MUST check tasks.json before executing — if absent, write the plan first
- MUST spawn subagents per-task based on owner field — Do not handle multi-task work as Lead solo when task count ≥ 2 or target files ≥ 2
- MUST NOT spawn parallel Engineers if their target files overlap — serialize instead
- MUST call nx_task_close before completing the cycle — archive plan+tasks to history.json

## Guidelines

## Flow

### Step 1: Intake (Lead)

- **User specifies agents/direction** → follow the instruction as given.
- **[run] only (no direction)** → confirm direction with user before proceeding.
- User decides scope and composition. Lead fills in what is not specified.
- **Branch Guard**: if on main/master, create a branch appropriate to the task type before proceeding (prefix: \`feat/\`, \`fix/\`, \`chore/\`, \`research/\`, etc. — Lead's judgment). Auto-create without user confirmation.
- Check for \`tasks.json\`:
  - **Exists** → read it and proceed to Step 2.
  - **Absent** → auto-invoke \`Skill({ skill: "claude-nexus:nx-plan", args: "auto" })\` to generate tasks.json. Do NOT ask — \`[run]\` implies execution intent. After plan generation, proceed to Step 2.
- If tasks.json exists, check prior decisions with \`nx_plan_status\`.

### Step 1.5: TUI Progress

Register tasks for visual progress tracking (Ctrl+T):

- **≤ 10 tasks**: \`TaskCreate\` per task
- **> 10 tasks**: group by \`plan_issue\`, \`TaskCreate\` per group
- Use \`TaskUpdate\` to reflect progress (\`in_progress\` / \`completed\`) as execution proceeds
- **Skip only if**: non-TTY environment (VSCode, headless)
- **Known issue**: TUI may freeze during auto-compact (#27919) — task data on disk remains correct

### Step 2: Execute

- **Present tasks.json** to the user — show task list with owner, deps, approach summary. Proceed immediately without asking for confirmation.
- Execute tasks based on \`owner\` field:
  - \`owner: "lead"\` → Lead handles directly
  - \`owner: "engineer"\`, \`"researcher"\`, \`"writer"\`, etc. → spawn subagent matching the owner role
  - \`owner: "architect"\`, \`"tester"\`, \`"reviewer"\`, etc. → spawn corresponding HOW/CHECK subagent
- For each subagent, pass the task's \`context\`, \`approach\`, and \`acceptance\` as the prompt.
- **Parallel execution**: independent tasks (no overlapping target files, no deps) can be spawned in parallel. Tasks sharing target files must be serialized.
- **SubagentStop escalation chain**: when a subagent stops with incomplete work:
  1. **Do/Check failed** → spawn the relevant HOW agent (e.g., Engineer failed → Architect) to diagnose the failure, review the approach, and suggest adjustments.
  2. **Re-delegate** → apply HOW's adjusted approach and re-delegate to a new Do/Check agent.
  3. **HOW also failed** → Lead reports the failure to the user with diagnosis details and asks for direction.
  - Maximum: 1 HOW diagnosis + 1 re-delegation per task. After that, escalate to user.
  - Relevant HOW mapping: Engineer→Architect, Writer→Strategist, Researcher→Postdoc, Tester→Architect.

### Resume Dispatch Rule

For each task, Lead chooses between fresh spawn and resume based on the \`owner\`'s \`resume_tier\`:

1. Lookup \`resume_tier\` from \`agents/{owner}.md\` frontmatter (if absent → treat as \`ephemeral\`).
2. If \`ephemeral\` → fresh spawn. Stop.
3. If \`bounded\` → check tasks.json history: did the same \`owner\` previously work on overlapping target files? If yes AND no intervening edits by other agents → resume candidate. Otherwise fresh. Always include "re-read target files before any modification" instruction in the resume prompt.
4. If \`persistent\` → resume by default if the same agent worked earlier in this run. Cross-task reuse allowed.
5. Before issuing SendMessage for any resume, verify \`.nexus/state/runtime.json\` has \`teams_enabled: true\`. Otherwise fall back to fresh spawn silently — do NOT throw an error.

### Step 3: Verify (Lead + Check subagents)

**Lead**: confirm build + E2E pass/fail.

**Tester — acceptance criteria verification**:
- Tester reads each completed task's \`acceptance\` field from tasks.json
- Verifies each criterion with PASS/FAIL judgment
- All criteria must pass for the task to be considered done
- If any criterion fails → Step 2 rework (reopen task)
- Tester spawn conditions (any one triggers):
  - tasks.json contains at least 1 task with an \`acceptance\` field
  - 3 or more files changed
  - Existing test files modified
  - External API/DB access code changed
  - Failure history for this area exists in memory

**Reviewer — writer deliverable verification**:
- Whenever Writer produced a deliverable in Step 2, Reviewer MUST verify it
- Writer → Reviewer is a mandatory pairing, not optional
- Reviewer checks: factual accuracy, source consistency, grammar/format

- If issues found: code problems → Step 2 rework; design problems → re-run nx-plan before re-executing.

### Step 4: Complete

Execute in order:

1. **nx-sync**: invoke \`Skill({ skill: "claude-nexus:nx-sync" })\` if code changes were made in this cycle. Best effort — failure does not block cycle completion.
2. **nx_task_close**: call to archive plan+tasks to history.json. This updates \`.nexus/history.json\`.
3. **git commit**: stage and commit source changes, build artifacts (\`bridge/\`, \`scripts/\`), \`.nexus/history.json\`, and any modified \`.nexus/memory/\` or \`.nexus/context/\`. Use explicit \`git add\` with paths (not \`git add -A\`) and a HEREDOC commit message with \`Co-Authored-By\`. This ensures the cycle's history archive lands in the same commit as the code changes, giving a 1:1 cycle-commit mapping.
4. **Report**: summarize to user — changed files, key decisions applied, and suggested next steps. Merge/push is the user's decision and outside this skill's scope.

---

## Reference Framework

| Phase | Owner | Content |
|-------|-------|---------|
| 1. Intake | Lead | Clarify intent, confirm direction, Branch Guard, check tasks.json / invoke nx-plan if absent |
| 2. Execute | Do subagents | Spawn per-task by owner, delegation criteria, parallel where safe |
| 3. Verify | Lead + Check subagent | Build check, quality verification |
| 4. Complete | Lead | nx-sync, nx_task_close, git commit, report |

---

## Structured Delegation

When Lead delegates tasks to subagents, structure the prompt in this format:

\`\`\`
TASK: {specific deliverable}

CONTEXT:
- Current state: {relevant code/doc locations}
- Dependencies: {results from prior tasks}
- Prior decisions: {relevant decisions}
- Target files: {file path list}

CONSTRAINTS:
- {constraint 1}
- {constraint 2}

ACCEPTANCE:
- {completion criterion 1}
- {completion criterion 2}
\`\`\`

---

## Key Principles

1. **Lead = interpret user direction + coordinate + own tasks**
2. **User decides scope and composition**
3. **tasks.json is the single source of state** — produced by nx-plan, read at Step 1, updated as tasks complete
4. **Do subagents = execute per owner** — Lead spawns one subagent per task based on the \`owner\` field. Engineers focus on code changes. Doc updates are done in bulk by Writer in Step 4. Researcher records to reference/ immediately.
5. **Check subagents = verify** — Lead's discretion + 4 conditions
6. **SubagentStop escalation** — when a subagent stops with incomplete work, escalate through HOW diagnosis → re-delegation → user report. Max 1 cycle per task.
7. **Gate Stop nonstop** — cannot terminate while pending tasks exist
8. **Plan first** — if tasks.json is absent, nx-plan must run before Step 2
9. **No file modification via Bash** — sed, echo >, cat <<EOF, tee, and similar Bash-based file edits are prohibited. Always use Edit/Write tools (Gate enforced)
## State Management

\`.nexus/state/tasks.json\` — produced by nx-plan, managed via \`nx_task_add\`/\`nx_task_update\`. Gate Stop enforcement.
On cycle end, archive plan+tasks to \`.nexus/history.json\` via \`nx_task_close\`.
`,
  "nx-setup": `## Role

Interactive project setup wizard — configure Nexus for a new project with minimal token cost. Every step is a concrete choice via \`AskUserQuestion\`, with no open-ended exploration.

## Constraints

- NEVER accept free-text input — every step must use \`AskUserQuestion\` with explicit options.
- NEVER skip the "Skip" option — all steps are optional.
- NEVER modify files outside the selected scope without explicit user confirmation.
- NEVER overwrite an existing \`statusLine\` field in settings.json without explicit user confirmation.

## Guidelines

## Trigger
- Direct invocation: \`/claude-nexus:nx-setup\`

---

## Steps

### Step 1: Scope Selection

\`\`\`
AskUserQuestion({
  questions: [{
    question: "Where should the Nexus configuration be applied?",
    header: "Scope",
    multiSelect: false,
    options: [
      { label: "User (Global)", description: "Apply to all projects (~/.claude/CLAUDE.md, ~/.claude/settings.json statusline)" },
      { label: "Project", description: "Apply to this project only (CLAUDE.md, .claude/settings.local.json)" }
    ]
  }]
})
\`\`\`

All file write paths for subsequent steps are determined by this selection:
- User: \`~/.claude/CLAUDE.md\`, \`~/.claude/settings.json\` (statusline wrapper)
- Project: \`./CLAUDE.md\`, \`./.claude/settings.local.json\`

### Step 2: Statusline

\`\`\`
AskUserQuestion({
  questions: [{
    question: "Enable the Nexus statusline? (model, branch, context usage, rate limits)",
    header: "Statusline",
    multiSelect: false,
    options: [
      { label: "Enable (Recommended)", description: "2 lines: model+branch+git, context+usage meters" },
      { label: "Skip", description: "Skip statusline configuration" }
    ]
  }]
})
\`\`\`

**Create wrapper script** (for Enable, run via Bash tool):
\`\`\`bash
mkdir -p ~/.claude/hooks
cat > ~/.claude/hooks/nexus-statusline.sh << 'EOF'
#!/bin/bash
SCRIPT=$(ls -1d "$HOME/.claude/plugins/cache/nexus/claude-nexus"/*/scripts/statusline.cjs 2>/dev/null | sort -V | tail -1)
[ -n "$SCRIPT" ] && exec node "$SCRIPT"
EOF
chmod +x ~/.claude/hooks/nexus-statusline.sh
\`\`\`

**On selection, depending on scope:**

**(1) User scope:**
- Create wrapper script (run step above)
- If \`statusLine\` field is **absent** in \`~/.claude/settings.json\`: add statusLine setting directly:
  \`\`\`json
  { "statusLine": { "type": "command", "command": "bash $HOME/.claude/hooks/nexus-statusline.sh" } }
  \`\`\`
- If \`statusLine\` field **already exists** in \`~/.claude/settings.json\`: create wrapper only, do not modify settings.json — ask user to confirm replacement (see "Statusline coexistence handling" below)

**(2) Project scope:**
- Create wrapper script (run step above)
- If \`statusLine\` field is **absent** in \`.claude/settings.local.json\`: add statusLine setting directly:
  \`\`\`json
  { "statusLine": { "type": "command", "command": "bash $HOME/.claude/hooks/nexus-statusline.sh" } }
  \`\`\`
- If \`statusLine\` field **already exists** in \`.claude/settings.local.json\`: create wrapper only, do not modify settings.local.json — ask user to confirm replacement (see "Statusline coexistence handling" below)
**(3) Skip:**
- Do not create wrapper or modify settings.json.

**Statusline coexistence handling:**

Run only if settings.json modification was deferred above (i.e., wrapper was created but existing statusLine was detected).
If statusLine settings were already applied above, skip this sub-step.

Specifically, treat an existing statusline setting as detected if any of the following are true:
- \`~/.claude/hooks/statusline.sh\` file exists
- Or the scope-appropriate settings.json (\`~/.claude/settings.json\` or \`.claude/settings.local.json\`) already has a \`statusLine\` field

If detected:

\`\`\`
AskUserQuestion({
  questions: [{
    question: "An existing statusline configuration was detected. Replace it with the Nexus statusline?",
    header: "Statusline",
    multiSelect: false,
    options: [
      { label: "Replace (Recommended)", description: "Replace with Nexus statusline (wrapper script configuration)" },
      { label: "Keep Existing", description: "Keep existing statusline. Nexus wrapper is created but settings.json is not modified." }
    ]
  }]
})
\`\`\`

- "Replace (Recommended)": replace the \`statusLine\` in the scope-appropriate settings.json with the Nexus wrapper (wrapper script already created above)
- "Keep Existing": keep the existing \`statusLine\` in settings.json (wrapper script already created above — user can switch manually later)

If no existing statusline configuration is detected, skip this sub-step.

### Step 3: Recommended Plugin

Check if \`context7@claude-plugins-official\` is in \`enabledPlugins\` (global or project settings.json).

**Already installed:**

Notify and skip:
\`\`\`
"Recommended plugin already installed: context7 ✓"
\`\`\`

**Not installed:**

\`\`\`
AskUserQuestion({
  questions: [{
    question: "Install the context7 plugin? It enables agents to look up library docs in real time.",
    header: "Plugin",
    multiSelect: false,
    options: [
      { label: "Install (Recommended)", description: "context7 — real-time library documentation lookup (Upstash Context7)" },
      { label: "Skip", description: "Skip recommended plugin installation" }
    ]
  }]
})
\`\`\`

**If "Install":**
Add to \`enabledPlugins\` in the scope-appropriate settings.json (\`~/.claude/settings.json\` or \`.claude/settings.local.json\`):
\`\`\`json
{
  "context7@claude-plugins-official": true
}
\`\`\`
Claude Code will automatically install the plugin at the start of the next session.

**If "Skip":** proceed to the next step.

Note: Once added to \`enabledPlugins\`, Claude Code automatically installs the plugin at the start of the next session.

### Step 4: Knowledge Init

\`\`\`
AskUserQuestion({
  questions: [{
    question: "Auto-generate project core knowledge?",
    header: "Init",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Analyze existing docs (README, CLAUDE.md, etc.) to generate knowledge files in .nexus/memory/ and .nexus/context/" },
      { label: "Skip", description: "Run manually later with /claude-nexus:nx-init" }
    ]
  }]
})
\`\`\`

If "Yes": invoke \`Skill({ skill: "claude-nexus:nx-init" })\`.
If "Skip": proceed to next step.

### Step 5: Complete

Output a setup completion message:
- Summary of applied settings
- Brief introduction to available skills/agents
- "To get started, describe a task, or use [plan] for planning, [run] for execution, [rule] for saving rules"

---

## Key Principles

1. **Every step uses AskUserQuestion** — no free-text input
2. **Minimize tokens** — limit each step to concrete choices to prevent unnecessary exploration
3. **Always provide a Skip option** — nothing is forced
4. **Extensible structure** — includes recommended plugin step, expandable to additional categories in the future

## State Management

Setup operates via sequential AskUserQuestion calls with no state file.
Configuration results are written to the scope-appropriate settings file at each step.
`,
  "nx-init": `## Role

Scans the project and builds Nexus knowledge in the flat .nexus/ structure. On first run, performs a 5-step full onboarding sequence.

## Constraints

- NEVER modify source code. Slimming down CLAUDE.md beyond the project section is not this skill's responsibility.
- NEVER infer or guess information that cannot be confirmed from code — do not write it to context/.
- NEVER store secrets (API keys, credentials, etc.) in knowledge files.
- NEVER overwrite existing files without \`--reset\`. On resume, preserve existing files.
- Project section in CLAUDE.md MUST go through user confirmation before writing.
- NEVER reference or create identity/, codebase/, reference/, or core/ paths.
- Essentials section MUST NOT exceed 10 lines. If more items are needed, move lower-priority ones to .nexus/context/.

## Guidelines

## Trigger

- \`/claude-nexus:nx-init\` — full onboarding (or resume)
- \`/claude-nexus:nx-init --reset\` — back up existing \`.nexus/\` knowledge and re-onboard
- \`/claude-nexus:nx-init --reset --cleanup\` — show backup list + selective deletion

---

## Modes

### First Run (no \`.nexus/\` flat structure)

Automatically runs the 5-step full onboarding.

Detection: \`.nexus/context/\`, \`.nexus/memory/\`, \`.nexus/state/\`, \`.nexus/rules/\` do not exist.

### Resume (\`.nexus/\` partially exists)

Check existing state and resume from the first incomplete step.

### Reset (\`--reset\`)

Back up existing \`.nexus/\` knowledge directories to \`.nexus/bak.{timestamp}/\`, then enter First Run.

### Cleanup (\`--reset --cleanup\`)

Show backup directory list, let user select backups to delete.

---

## Process

### Phase 0: Mode Detection

\`\`\`
IF --reset --cleanup flag:
  Show list of .nexus/bak.*/ directories
  AskUserQuestion({
    questions: [{
      question: "Select a backup to delete (or cancel)",
      options: [...backup list..., { label: "Cancel", description: "Exit without changes" }]
    }]
  })
  Delete selected backup and exit

ELSE IF --reset flag:
  Move .nexus/{memory,context,state,rules}/ → .nexus/bak.{timestamp}/
  Inform: "Existing knowledge has been backed up to .nexus/bak.{timestamp}/. Starting re-onboarding."
  → Enter First Run

ELSE IF .nexus/context/ exists:
  → Enter Resume (check existing steps and resume)

ELSE:
  → Enter First Run (from Step 1)
\`\`\`

---

## Steps

### Step 1: Project Scan

Auto-detect code structure and tech stack. Create the flat \`.nexus/\` directory structure if it does not exist.

Create directories (using Bash mkdir):
- \`.nexus/memory/\`
- \`.nexus/context/\`
- \`.nexus/state/\`
- \`.nexus/rules/\`

Collected items:
- **Directory structure**: top-level layout, major modules/packages
- **Tech stack**: language, framework, runtime (package.json, Cargo.toml, pyproject.toml, go.mod, build.gradle, etc.)
- **Build/test system**: scripts, CI configuration
- **Existing docs**: CLAUDE.md, README.md, docs/, .cursorrules, etc.
- **git context**: recent commits, branch structure, contributors

Output: scan summary (language, framework, structure overview)

For large projects (10+ top-level directories or 100+ files), consider spawning an Explore subagent for parallel scanning to reduce Lead context usage.

### Step 2: Mission + Essentials (Interactive)

Using the Step 1 scan results, draft a Mission statement (1–2 lines) and an Essentials list, then present both to the user for confirmation in a single pass.

#### Essentials Guidelines

Essentials are agent-critical facts — things an agent would get wrong if it didn't know them. Apply this judgment criterion: **"Would an agent produce wrong results without knowing this?"** Yes → Essentials. No → .nexus/context/.

Draft from these five categories (include only what applies to this project):

- **Tech stack** — runtime, language, package manager, core framework. Flag non-default tools (e.g. bun instead of npm, deno instead of node).
- **Workflow** — build, test, deploy commands. Must-follow procedures such as required lint or type-check steps before committing.
- **Constraints** — forbidden tools, patterns, or approaches. Directories or files that must not be modified.
- **Domain** — target audience, required terminology or tone, compliance or regulatory constraints, methodology for research projects.
- **Conventions** — naming, structure, or style that deviate from general defaults. Project-specific patterns an agent would not infer.

Do not include items that are standard defaults for the detected tech stack. Do not exceed 10 lines total in the Essentials section.

#### Draft Presentation

Present the full draft to the user in this format:

\`\`\`
The following will be added to CLAUDE.md (existing content will not be changed):

<!-- PROJECT:START -->
## {project-name}

{mission 1-2 lines}

### Essentials
- {auto-detected item}
- {auto-detected item}
<!-- PROJECT:END -->

Any changes?
\`\`\`

Wait for the user to confirm or provide edits. Apply all changes in one pass — do not ask about Mission and Essentials separately.

After confirmation, write the section into CLAUDE.md inside markers using the Edit tool. If CLAUDE.md already contains \`<!-- PROJECT:START -->\` markers, replace the content between them. If CLAUDE.md does not exist, create it with the markers.

### Step 3: Context Knowledge Auto-Generation

Analyze Step 1 scan results to generate context knowledge documents in \`.nexus/context/\`.

Principles:
- File names and content are decided freely based on project characteristics. No fixed templates.
- Existing docs are information sources only — do not replicate their structure verbatim.
- Do not guess content that cannot be confirmed from code.
- Typically 1-3 files are sufficient. More files are not better.
- **Generate abstract-level content only** — design patterns, architecture direction, module relationships, conventions. Do NOT include code-level details such as file listings, function signatures, or import maps. Those can be read directly from code.

Generation targets (select and name based on what the project actually needs):
- Development stack (languages, frameworks, runtimes, key dependencies, build/test/deploy workflow)
- Design and architecture (module relationships, data flow, core entry points, conventions)
- Implementation specifics (pipeline details, configuration patterns, file structure conventions, tool restrictions — anything too specific for CLAUDE.md but not readable from code alone)

Use the Write tool to create files at \`.nexus/context/{chosen-name}.md\`.

For large projects, spawn Writer subagents per topic to generate context knowledge in parallel. Lead coordinates and reviews outputs.

On completion: "context knowledge N files generated"

### Step 4: Rules Initial Setup (Optional)

Check whether team custom rules are needed.

\`\`\`
AskUserQuestion({
  questions: [{
    question: "Do you want to set up development rules now?",
    options: [
      { label: "Set up", description: "Coding conventions, test policy, commit rules, etc." },
      { label: "Skip", description: "Can be added later via [rule] tag" }
    ]
  }]
})
\`\`\`

If "Set up": present a draft based on scan results → user confirms → save via Write tool to \`.nexus/rules/{topic}.md\`.

If "Skip": inform and proceed to Step 5.

### Step 5: Completion Summary

Output a summary of the onboarding results.

\`\`\`
## Nexus Initialization Complete

### Generated Files
- CLAUDE.md: project section — mission and essentials (<!-- PROJECT:START/END -->)
- .nexus/context/: {list of generated files}
- .nexus/rules/: {generated files or "none (skipped)"}

### Next Steps
- [plan] — research, analyze, and plan before execution
- [run] — execute from a plan
- /claude-nexus:nx-init --reset — re-run onboarding (existing knowledge will be backed up)
\`\`\`
`,
  "nx-sync": `## Role

Scans the current project state and synchronizes .nexus/context/ design documents. Uses git diff to identify code changes, then updates abstract design documents (principles, philosophy, development stack, architectural decisions) that cannot be inferred from code alone.

## Constraints

- NEVER delete existing context files — only update or add
- NEVER modify source code — this skill updates documentation only
- NEVER guess information that cannot be confirmed from sources — mark as "needs verification" instead
- MUST preserve existing content structure — update sections, don't rewrite entire files unnecessarily
- NEVER use deprecated MCP knowledge tools — use Read and Write native tools only

## Guidelines

## Trigger

- \`[sync]\` — synchronize .nexus/context/ with current project state

## Process

### Step 1: Gather Sources

Collect information from all available sources:

1. **git diff** — run \`git diff --name-only HEAD~10..HEAD\` (or use recent commits to identify changed files)
   - Identifies which source files changed
   - Primary signal for determining which context documents may be stale
2. **Conversation context** — if available in current session
   - Design decisions discussed but not yet reflected in context documents
   - Supplementary source for all updates

### Step 2: Read Current Context

Read all files in \`.nexus/context/\` using the Read tool:

- List files: \`ls .nexus/context/\`
- Read each file to understand current documented state
- Compare against detected changes to identify gaps or stale content

Only update files where a concrete change is detected. If no staleness is found, report "already current" and skip.

### Step 3: Execute Updates

Spawn Writer agent to update affected context documents:

\`\`\`
Agent({ subagent_type: "claude-nexus:writer", name: "writer-sync-context",
  prompt: "Update .nexus/context/ documents based on the following changes. Read current files with the Read tool, then write updates with the Write tool. Changes: {change_manifest}" })
\`\`\`

The Writer agent:
- Reads each relevant context file with the Read tool
- Applies targeted updates — changes only the sections that are stale
- Writes the updated file back with the Write tool
- Does not rewrite files that are already accurate

### Step 4: Report

Report to user:
- Which context files were scanned
- Which files were updated and what changed
- Which files were already up to date
- Any items marked "needs verification"

## Key Principles

1. **Targeted updates over full rewrites** — only change sections that are actually stale
2. **Evidence-based** — every update must trace to a source (git diff or conversation)
3. **Preserve structure** — maintain existing document organization, headings, and format
4. **No speculation** — if a change's impact on context docs is unclear, flag it rather than guess

## What .nexus/context/ Contains

Context documents capture abstract knowledge that cannot be read directly from source code:

- Design principles and philosophy
- Architectural decisions and their rationale
- Development stack choices and constraints
- Project conventions and standards

These documents are updated when code changes reflect a shift in principles, a new architectural decision is made, or the development stack evolves. They are not updated for routine code additions that do not change the underlying design.
`,
  "nx-plan": `## Role

Facilitate structured multi-perspective analysis using subagents to decompose issues, deliberate on options, and align on decisions. Lead acts as synthesizer AND active participant — orchestrates subagent research/analysis AND contributes its own position. Does not execute — planning only. Transition to execution is the user's decision.

## Constraints

- NEVER execute — this skill is planning only; transition to execution is the user's decision
- NEVER call \`nx_plan_start\` before research is complete (research_summary is required)
- NEVER present multiple issues at once — one issue at a time only
- NEVER ask groundless questions — always research code/knowledge/decisions first
- NEVER use TeamCreate. SendMessage is permitted ONLY for resuming completed subagents whose \`resume_tier\` is \`persistent\` or \`bounded\`, and ONLY within the constraints of the Resume Policy section below. SendMessage to a \`name\` (running teammate communication) remains forbidden in plan sessions.
- MUST record all decisions with \`[d]\` tag so they are not scattered across turns
- MUST call \`nx_plan_decide\` when recording \`[d]\`
- MUST check for existing plan.json before starting a new session
- \`[d]\` without an active plan.json is BLOCKED — "[d]는 plan 세션 안에서만 유효합니다."
- MUST present a comparison table before asking for a decision — never present options as prose only. Format:

\`\`\`
| | A: {title} | B: {title} |
|---|---|---|
| Pros | ... | ... |
| Cons | ... | ... |
| Pick | | **(Recommended)** |
\`\`\`

## Guidelines

## Trigger

- Explicit tag: \`[plan]\` — continue existing session if plan.json exists, otherwise start new
- Additional analysis needed mid-session: spawn HOW subagents independently via Agent tool
- Continuing conversation without a tag → continue existing session

---

## Auto Mode (\`[plan:auto]\`)

When triggered with \`[plan:auto]\` or invoked via \`Skill({ args: "auto" })\`, run the full planning process **without user interaction**:

1. **Research** — spawn researcher+Explore subagents (same as interactive)
2. **Issue derivation** — Lead identifies issues from research
3. **Auto-decide** — for each issue, Lead selects the recommended option without presenting choices. Each \`nx_plan_decide(summary)\` MUST include: selected approach + reason, AND rejected alternatives + why they were dismissed. No comparison table needed, but internal deliberation is mandatory.
4. **Decision briefing** — output a concise summary of all decisions before generating tasks:
   \`\`\`
   [auto-plan complete] N issues, N decisions:
   - #1: {selected} ({rejected alternative} — reason)
   - #2: ...
   \`\`\`
   Do not wait for user response — proceed immediately to task generation.
5. **Plan document** — generate tasks.json following Step 7 rules (including HOW-assisted decomposition if \`how_agents\` present in plan.json issues). Apply owner table and verification auto-pairing.

Key differences from interactive mode:
- No \`AskUserQuestion\` or comparison tables — Lead decides autonomously
- No dynamic agenda proposals — Lead handles all derived issues internally
- Output: tasks.json ready for \`[run]\` execution

**Scope by invocation context:**
- \`[plan:auto]\` standalone → auto-plan + briefing + tasks.json generation. Stops here.
- Invoked by \`[run]\` (tasks.json absent) → auto-plan + briefing + tasks.json generation + seamless execution transition. No pause between plan and run.

This mode is invoked internally by \`[run]\` when no tasks.json exists, or explicitly by the user with \`[plan:auto]\`.

---

## Procedure (Interactive Mode)

### Step 1: Intent Discovery

Determine planning depth and identify which HOW subagents to delegate analysis to, based on Progressive Depth.

| Level | Signal | Exploration Scope |
|-------|--------|-------------------|
| **Specific** | File path, function name, error message, or concrete target named | Focused on the relevant file/module |
| **Direction-setting** | Open-ended question, "it would be nice if ~", choice needed among approaches | Related area + external case research |
| **Abstract** | "I don't know how to approach this", goal itself unclear, fundamental direction | Full codebase + external research + comparable project comparison |

- Specific request → confirm intent with 1–2 questions, derive issues immediately
- Direction-setting → use hypothesis-based questions to understand intent
- Abstract/fundamental → actively interview to uncover root goals the user hasn't clarified

**HOW subagent selection rule:**
- User explicitly names agents → use as-is, propose additions if gaps detected
- User does not name agents → Lead proposes based on issue scope, confirm with user
- Additional HOW subagents can be spawned at any time during analysis (Lead's or user's discretion)

### Step 2: Research

Understand code, core knowledge, and prior decisions before forming a planning agenda.

**Start by checking existing knowledge**: before spawning any subagent, use Glob/Read to scan \`.nexus/memory/\` and \`.nexus/context/\` for relevant memos and context files, and use \`nx_history_search\` to check for prior decisions on this topic. If the needed information is already there, use it directly and skip or narrow the subagent spawn. Only spawn subagents to fill gaps not covered by existing knowledge.

**Approach selection:**

| Scenario | Approach |
|----------|----------|
| Codebase orientation | Spawn Explore agent (\`subagent_type: "Explore"\`) for file/code search |
| External research needed | Spawn Researcher agent (\`subagent_type: "claude-nexus:researcher"\`) for web search |
| Both codebase and external | Spawn Explore + Researcher in parallel |

- NEVER call \`nx_plan_start\` before research is complete.
- \`research_summary\` parameter in \`nx_plan_start\` is required — forces research completion before session creation.
- Researcher subagents are spawned via the Agent tool and return findings to Lead. They do not join the plan session.

**Existing session (plan.json present):**
- Check current state with \`nx_plan_status\`.
- If new topic or additional research needed → spawn researcher subagent accordingly.
- Do not proceed to next issue before research is complete.

### Step 3: Session Setup

Register the planning session.

1. **\`nx_plan_start(topic, issues, research_summary)\`** — register plan in plan.json; auto-archives any existing plan.json.
2. Show the issue list to the user and confirm before proceeding.

### Step 4: Analysis

**Always proceed one issue at a time.** Never present multiple issues simultaneously.

For each issue:

1. **Current State Analysis** — Lead summarizes the current state and problems, drawing on research.
2. **Subagent Analysis** — for complex issues, spawn HOW subagents (architect, strategist, etc.) in parallel via Agent tool. Each subagent independently analyzes the issue and returns findings.
   - **Domain-Agent mapping** — match issue keywords to recommended HOW subagents:

   | Domain keywords | Recommended HOW |
   |----------------|-----------------|
   | UI, UX, 디자인, 인터페이스, 사용자 경험, 레이아웃 | Designer |
   | 아키텍처, 시스템 설계, 성능, 구조 변경, API, 스키마 | Architect |
   | 비즈니스, 시장, 전략, 포지셔닝, 경쟁, 수익 | Strategist |
   | 연구 방법론, 근거 평가, 문헌, 실험 설계 | Postdoc |

   - **Opt-out default**: if the issue matches a domain in the mapping, spawning is the default. Multiple matches → multiple spawns. To skip, state "{Agent} not needed — reason: ..." in the analysis text.
   - **No mapping match**: if no domain matches, Lead analyzes directly. When uncertain, spawn — the cost of an unnecessary spawn is lower than the cost of a shallow analysis.
   - **Record HOW findings**: after HOW subagents return, include their agent names and key findings when recording the decision via \`nx_plan_decide(how_agents=[...], how_summary={...})\`. This data is stored in plan.json for Step 7 task generation.
3. **Present Options** — after synthesis, Lead presents a comparison:

\`\`\`
| Item | A: {title} | B: {title} | C: {title} |
|------|-----------|-----------|-----------|
| Pros | ... | ... | ... |
| Cons | ... | ... | ... |
| Trade-offs | ... | ... | ... |
| Best for | ... | ... | ... |

**Recommendation: {X} ({title})**

- Option A falls short because {reason}
- Option B falls short because {reason}
- Option X overcomes {A/B limitations} → {core benefit}
\`\`\`

4. **Await user response** — receive free-form responses. Users may combine options, push back, or ask follow-up questions.

## Resume Policy

When \`.nexus/state/runtime.json\` shows \`teams_enabled: false\`, ALL resume paths are disabled — force fresh spawn. Otherwise:

| resume_tier | Same-issue default | Cross-issue | Disqualifiers |
|---|---|---|---|
| persistent | resume by default | Lead opt-in only | counter-evidence / reversal / re-review issue → fresh |
| bounded | conditional (same artifact only) | forbidden | loop 3x / feedback cycle (REVISION_REQUIRED) → fresh |
| ephemeral | forbidden | forbidden | N/A (always fresh) |

Before resuming a \`bounded\` agent: include a "re-read target files before any modification" instruction in the prompt. Bounded resume without re-read is BLOCKED.

\`resume_tier\` is read from each agent's frontmatter (\`agents/*.md\`). If absent, treat as \`ephemeral\` (most conservative).

### Step 5: Record Decision

When the user decides, record with the \`[d]\` tag.

- gate.ts detects \`[d]\` and routes to \`nx_plan_decide\`.
- \`nx_plan_decide(issue_id, summary)\` — marks issue as \`decided\`, writes \`decision\` inline in plan.json.
- Decisions are NOT written to decisions.json — plan.json is the single source of truth.
- \`[d]\` without plan.json is blocked.
- **Progress anchoring**: immediately after recording, output one line: "Issue #N decided (M of K complete). Next: #X — {title}." This keeps the user oriented in multi-issue sessions.

**Immediately after each decision**, Lead checks: "Does this decision create follow-up questions or new issues?" If yes, propose adding via \`nx_plan_update(action='add')\` before moving to the next issue.

**Decision reversal**: if the user wants to reconsider a prior decision ("아까 결정 다시 생각해보자", "issue #N 번복"), Lead calls \`nx_plan_update(action='reopen', issue_id=N)\` to reopen the issue and returns to Step 4 analysis for that issue.

### Step 6: Dynamic Agenda + Wrap-up

After each decision, Lead automatically checks for derived issues.

- **Dynamic agenda proposal**: after a decision is recorded, Lead examines whether the decision implies follow-on questions or unresolved sub-issues. If found, propose adding them with \`nx_plan_update(action='add', ...)\` and confirm with the user before adding.
- Pending issues remain → naturally transition to the next issue.
- All issues decided → **Gap check**: compare original question/topic against the issue list.
  - Gap found → register additional issues with \`nx_plan_update(action='add', ...)\`, return to Step 4.
  - No gap → signal planning complete.
- Wrap-up: confirm all analysis threads have reported conclusions to Lead.
- Proceed to Step 7 automatically — do not ask whether to generate the plan document.

### Step 7: Plan Document Generation

All issues decided → generate the plan document (tasks.json) immediately:

1. **Collect decisions** — gather all \`decided\` issues from plan.json
2. **Derive tasks** — decompose decisions into concrete, actionable tasks

   **HOW-assisted task decomposition**: check plan.json issues for \`how_agents\` field.
   - If HOW agents participated in analysis → re-spawn those HOWs with the decided approach + their prior \`how_summary\` as context. Ask them to propose task decomposition and owner assignment for their domain.
   - If no HOW agents participated → Lead decomposes alone using the owner table and auto-pairing rules above.
   - This ensures task generation depth is proportional to plan analysis depth.

3. **Enrich each task** with:
   - \`approach\` — implementation strategy derived from the decision rationale
   - \`acceptance\` — definition of done, verifiable criteria
   - \`risk\` — known risks or caveats from the analysis
   - \`deps\` — task dependencies based on execution order
   - \`owner\` — assign based on delegation analysis:

   | Task type | owner | Criteria |
   |-----------|-------|----------|
   | Single file, small change | **lead** | Subagent overhead > task effort |
   | Code implementation (.ts, .js, .py, etc.) | **engineer** | Source code creation/modification |
   | Documentation/content (.md, non-code) | **writer** | .md files, README, docs, non-code content |
   | Web research / external investigation | **researcher** | External information gathering needed |
   | Design analysis / review | **architect** etc. HOW | Technical trade-off judgment |
   | Sequential edits to same file | **lead** | Parallel subagents risk conflict |

   **Verification task auto-pairing** — create separate verification tasks:
   - Task with \`owner: "engineer"\` + \`acceptance\` field → pair a **tester** task (verify acceptance criteria)
   - Task with \`owner: "writer"\` → pair a **reviewer** task (verify deliverable)
   - Paired verification tasks are linked via \`deps\` to the original task
4. **Write tasks.json** via \`nx_task_add\`:
   - Set \`goal\` from the plan topic
   - Set \`decisions\` from plan.json decided summaries
   - Call \`nx_task_add(plan_issue=N, approach, acceptance, risk, owner)\` for each task
   - If any decisions involve design or architecture changes, include a task (owner: \`writer\` or \`lead\`) to update the relevant files in \`.nexus/context/\` to reflect those decisions
5. **Present plan document** — show the user the generated tasks.json summary for review
6. **Present transition**: "Proceed with \`[run]\` to execute."

**Incremental mode**: if tasks.json already exists (e.g., after adding follow-up issues), only add tasks for new decisions. Check \`plan_issue\` field to avoid duplicating tasks for already-covered issues.

---

## plan → run Transition

tasks.json is already generated in Step 7. Plan's role ends here.
Proceed with \`[run]\` to execute.

---

## Principles

1. **Active intent discovery** — actively uncover what the user hasn't clarified. Use interviewing to surface the root goal behind the words.
2. **Lead as synthesizer AND participant** — Lead does not merely relay subagent findings. Lead forms its own position, makes recommendations, and pushes back with evidence. Not a yes-man.
3. **Exploration first + proactive expansion** — research code/knowledge/external sources before planning starts. Never ask groundless questions.
4. **Hypothesis-based questions** — instead of empty questions, form hypotheses grounded in research and confirm with the user.
5. **Progressive Depth** — automatically adjust planning depth and HOW subagent composition based on request complexity.
6. **One at a time** — never present multiple issues at once. Reduce the user's cognitive load.
7. **Options must include pros/cons/trade-offs/recommendation** — when recommending, explain why other options fall short.
8. **Objective pushback** — even when the user arrives with strong conviction, Lead MUST independently analyze all viable options and present trade-offs the user may not have considered. The comparison table exists to surface what the user doesn't know, not to confirm what they already believe. Counter with evidence when better alternatives exist.
9. **Prose conversation by default** — free-form user responses (combinations, pushback, follow-up questions) are the core of planning quality.
10. **Dynamic agenda** — decisions create new questions. Lead proactively surfaces derived issues rather than waiting for the user to notice gaps.

---

## State Management

### plan.json

\`.nexus/state/plan.json\` — managed via MCP tools.

\`\`\`json
{
  "id": 1,
  "topic": "topic name",
  "issues": [
    {
      "id": 1,
      "title": "issue title",
      "status": "pending"
    },
    {
      "id": 2,
      "title": "issue title",
      "status": "decided",
      "decision": "decision summary",
      "how_agents": ["architect", "designer"],
      "how_summary": {
        "architect": "key findings...",
        "designer": "key findings..."
      }
    }
  ],
  "research_summary": "...",
  "created_at": "2026-01-01T00:00:00Z"
}
\`\`\`

- **Create**: \`nx_plan_start(topic, issues, research_summary)\` — called in Step 3; auto-archives any existing plan.json
- **Read**: \`nx_plan_status()\` — check current issue state + decisions
- **Update**: \`nx_plan_update(action, ...)\` — add/remove/edit/reopen issues
- **Decide**: \`nx_plan_decide(issue_id, summary)\` — marks issue as \`decided\`, writes decision inline
- **File presence = session in progress**

### Topic Switching

- \`[plan]\` → continue existing plan.json if present; start new session if not
- Continue conversation without tag → continue existing session
- New \`nx_plan_start\` call → auto-archives current plan.json before creating new one

### Session Abort

To abort a session, archive current state via \`nx_task_close\`. Incomplete issues/tasks are recorded in history.json for future reference.

---

## Self-Reinforcing Loop

\`\`\`
[plan] start → check/continue existing plan.json (start new if none)
  ↓
Intent discovery → research (parallel subagents) → nx_plan_start (register issues)
  ↓
Per-issue: HOW subagent analysis (parallel, independent) → Lead synthesis
  → options comparison → [d] → nx_plan_decide
  → dynamic agenda check → propose derived issues if found
  ↓
Next issue → ... → gap check → planning complete
  ↓
Proceed with \`[run]\` to execute.
  ↓
[run]: execution skill handles the full pipeline
  ↓
All done → nx_task_close (handled by run skill)
\`\`\`

gate.ts detects \`[d]\` and routes to \`nx_plan_decide\` if plan.json exists; blocks otherwise.

## Deactivation

When transitioning to \`[run]\`, Plan's role ends. Execution is handled by the run skill.
`,
};
