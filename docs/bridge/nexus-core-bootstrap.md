# nexus-core Bootstrap Document

<!-- meta: bootstrap document for nexus-core repository -->
<!-- target-reader: future LLM executing Phase 1 in a fresh repo, no prior context -->
<!-- origin: plan session id=16, opencode-nexus, date 2026-04-10 -->
<!-- do-not-compress: completeness over brevity — LLM context completeness is the primary goal -->

---

## §0 What you are reading
## §0 이 문서의 정체

This document is a self-contained bootstrap specification for creating the `nexus-core` repository from scratch. It exists as a bridge artifact produced by a plan session (session id=16) in the `opencode-nexus` project on 2026-04-10.

이 문서는 `nexus-core` 저장소를 처음부터 생성하기 위한 완전 자립형 부트스트랩 명세서다. `opencode-nexus` 프로젝트의 plan 세션(session id=16)에서 2026-04-10에 생성된 브릿지 아티팩트다.

**Target reader / 대상 독자:** A future LLM instance that has no access to the original conversation, no memory of the plan session, and no context about the decision rationale. This LLM will read this document and execute Phase 1 bootstrapping of `nexus-core` in a fresh, empty repository. Every piece of information needed for that execution is included inline — nothing is omitted on the assumption that context exists elsewhere.

**대상 독자:** 원래 대화에 접근할 수 없고 plan 세션에 대한 기억이 없으며 결정 근거에 대한 컨텍스트가 없는 미래의 LLM 인스턴스. 이 LLM은 이 문서를 읽고 새롭고 빈 저장소에서 `nexus-core`의 Phase 1 부트스트래핑을 실행할 것이다.

**How to use this document / 사용 방법:**

1. Read §1 (Background) and §2 (Architectural principles) to understand the system context.
2. Use §3 (Schema specification) and §4 (Capability vocabulary) as the normative reference for file content.
3. Execute Phase 1 in the order given in §5 (Phase 1 execution steps).
4. Use §6 (Sync script specification) and §7 (CI/test gates) to implement supporting infrastructure.
5. After nexus-core publishes, execute §8 (opencode-nexus integration) in the opencode-nexus repository.
6. §9 through §11 define scope boundaries, open variables, and future trigger conditions.
7. §12 is the glossary. §13 is verbatim source material from the plan session.

**Do not skip any section.** Each section resolves an ambiguity that would otherwise require guessing.

---

## §1 Background
## §1 배경

### §1.1 The Nexus system overview / Nexus 시스템 개요

Nexus is an orchestration plugin for AI coding CLIs. It provides an agent catalog, task pipeline enforcement, and context management. It runs on two host runtimes:

- **Claude Code** — the Anthropic AI coding CLI. Nexus runs as a Claude Code plugin.
- **OpenCode** — an alternative AI coding CLI with a different tool and hook system. Nexus runs as an OpenCode plugin.

The agent catalog defines nine specialist agents organized into three categories:

| Category | Korean | Agents | Role |
|----------|--------|--------|------|
| HOW | 분석 | Architect, Designer, Postdoc, Strategist | Advisory analysis, multi-perspective evaluation |
| DO | 실행 | Engineer, Researcher, Writer | Task execution, implementation, research |
| CHECK | 검증 | Tester, Reviewer | Verification, quality assurance |

The task pipeline is enforced through a tag-based workflow. Tags appearing in user messages trigger specific behaviors:

- `[plan]` — activates the nx-plan skill: research, multi-perspective analysis, decision recording, plan document generation
- `[run]` — activates the nx-run skill: agent composition and parallel execution based on a plan document
- `[d]` — records a decision (called within plan sessions via `nx_plan_decide`)
- `[rule]` — stores a rule in `.nexus/rules/`
- `[m]` — stores a lesson or reference in `.nexus/memory/`
- `[m:gc]` — garbage-collects memory files
- `[sync]` — synchronizes `.nexus/context/` design documents with current project state

Lead is the main agent that directly communicates with the user. Lead orchestrates all other agents. Lead owns `tasks.json` and controls the task pipeline. Sub-agents operate within the `disallowedTools` constraints defined in their profile — this is structural enforcement, not prompt-level instruction.

### §1.2 Two parent projects / 두 부모 프로젝트

**claude-nexus v0.25.0**

Located at: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/`

This is the original Nexus implementation. It is a markdown-based Claude Code plugin with the following structure:

```
agents/
  architect.md      — agent definition with YAML frontmatter + markdown body
  designer.md
  postdoc.md
  strategist.md
  engineer.md
  researcher.md
  writer.md
  tester.md
  reviewer.md
skills/
  nx-init/SKILL.md
  nx-plan/SKILL.md
  nx-run/SKILL.md
  nx-setup/SKILL.md
  nx-sync/SKILL.md
hooks/
  hooks.json        — Claude Code hook routing definition
  gate.cjs          — single gate entry point for all hooks
bridge/
  mcp-server.cjs    — MCP bridge server
src/                — supporting TypeScript source
VERSION
CHANGELOG.md
```

The `.nexus/` directory layout used by claude-nexus (since v0.24.1) is flat:

```
.nexus/
  memory/           — lessons, references
  context/          — design documents
  rules/            — project rules
  state/            — plan.json, tasks.json, history.json
```

Agent files use YAML frontmatter with the following fields: `name`, `model`, `description`, `task`, `maxTurns`, `disallowedTools`, `tags`, `alias_ko`, `category`, `resume_tier`.

The `disallowedTools` field lists Claude Code-specific tool identifiers such as `Edit`, `Write`, `NotebookEdit`, `mcp__plugin_claude-nexus_nx__nx_task_add`, `mcp__plugin_claude-nexus_nx__nx_task_update`.

**opencode-nexus v0.1.0**

Located at: `/Users/kih/workspaces/areas/opencode-nexus/`

This is the OpenCode implementation of Nexus. It is a compiled TypeScript npm package:

```
src/
  agents/
    catalog.ts      — NEXUS_AGENT_CATALOG: NexusAgentProfile[]
    prompts.ts      — AGENT_PROMPTS: Record<string, string> (740 lines, being migrated)
  skills/
    prompts.ts      — skill prompt bodies (208 lines, being migrated)
  tools/
    plan.ts         — nx_plan_start, nx_plan_decide, nx_plan_update, nx_plan_status
    task.ts         — nx_task_update, nx_task_close, nx_task_list
    (others)
dist/index.js       — compiled bundle (tsc → dist/index.js)
scripts/
  (e2e test scripts)
docs/
  bridge/           — this document lives here
package.json
tsconfig.json
```

The `.nexus/` directory layout used by opencode-nexus is hierarchical (intentional divergence from claude-nexus flat layout):

```
.nexus/
  core/
    identity/       — project identity documents
    codebase/       — codebase architecture documents
    memory/         — lessons, references
    reference/      — external reference documents
  state/            — plan.json, tasks.json
  rules/            — project rules
```

The `catalog.ts` agent profiles use OpenCode-native tool identifiers. For example, the `disallowedTools` for architect in `catalog.ts` lists `["edit", "write", "patch", "multiedit", "nx_task_add", "nx_task_update"]` — these are OpenCode tool names, not Claude Code tool names.

### §1.3 The drift problem / 드리프트 문제

The primary problem that `nexus-core` solves is **prompt drift** — the divergence of agent and skill prompt content between the two harnesses over time. This drift is currently documented and evidenced as follows:

**Evidence 1: `meet.ts` → `plan.ts` naming inconsistency**

The file `/Users/kih/workspaces/areas/opencode-nexus/src/tools/plan.ts` was previously named `meet.ts`. After renaming, the file now exports `nxPlanStart`, `nxPlanDecide`, etc. (plan-vocabulary), but the old name "meet" persisted in other references. The rename `meet.ts → plan.ts` is part of the Issue #3 decision in this plan cycle.

This is a concrete example of how prompt and code renaming propagates inconsistently across a hand-maintained codebase.

**Evidence 2: qa → tester naming drift**

In claude-nexus, the agent is named `tester` (file: `agents/tester.md`). In `opencode-nexus/src/agents/catalog.ts`, the agent ID is `"tester"` — correct. However, `src/agents/prompts.ts` contains mixed references: some sections say "qa" and others say "tester", with approximately 6 references to the old "qa" name remaining in the 740-line file. The file `docs/prompt-parity-plan.md` references `agents/qa.md` (a file that never existed in claude-nexus) and `skills/nx-meet/SKILL.md` (the skill was renamed to `nx-plan`). These stale references confirm that hand-copied prompts accumulate drift.

**Evidence 3: Missing tags `[m]` / `[m:gc]` / `[sync]`**

claude-nexus implements the `[m]`, `[m:gc]`, and `[sync]` tag workflows. opencode-nexus does not have these tag triggers defined in its tag parser. This is documented in `/Users/kih/workspaces/areas/opencode-nexus/docs/deferred-from-claude-nexus.md` as D8.

**Evidence 4: Postdoc bash drift**

The `disallowedTools` frontmatter in `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/postdoc.md` does NOT list `Bash`. However, `/Users/kih/workspaces/areas/opencode-nexus/src/agents/catalog.ts` lists `"bash"` in postdoc's `disallowedTools`. This means the two implementations diverge on a security-relevant constraint. See §10.1 for the resolution.

### §1.4 Bidirectional framing / 양방향 프레이밍

The critical insight that shaped the final architecture decision is **bidirectional framing**: the author's primary harness can flip over time.

Original framing (rejected): claude-nexus is the stable parent; opencode-nexus is a downstream fork that periodically cherry-picks from claude-nexus. This framing assigns a fixed directional relationship.

Corrected framing (adopted): The author is a "Nexus user on harness X this month". This month it may be Claude Code, next season it may be OpenCode. Neither project is permanently canonical. At any given time, the active harness accumulates prompt improvements, and those improvements need to flow into the shared library and thence to the inactive harness.

This bidirectional flip invalidates the Soft Fork option (see §1.5), because Soft Fork assumes a stable upstream to wait for. If the upstream changes, the Soft Fork has no mechanism to re-anchor.

### §1.5 Why Option E chosen / Option E가 선택된 이유

The plan session evaluated five architectural options:

| Option | Name | Description | Verdict |
|--------|------|-------------|---------|
| A | Strict Mirror | opencode-nexus is a byte-for-byte mirror of claude-nexus with automated sync | **Rejected** — Fails at primitive level. Claude Code primitives `PreCompact` and `SubagentStart` do not exist in OpenCode. The hook system, MCP bridge pattern, and tool name space are fundamentally different. Mirroring produces broken content. |
| B | Soft Fork | opencode-nexus is a fork of claude-nexus; periodically cherry-pick changes | **Rejected under bidirectional reframe** — Soft Fork's "cherry-pick every 2 weeks" obligation assumes stable direction. When the flip occurs (opencode-nexus becomes primary), there is no merge base, no rename tiebreaker, and the flow reversal breaks the model. |
| C | Reimplementation | Write all prompts independently from scratch for opencode-nexus | **Rejected** — The premise is empirically false. The agent prompt bodies in `src/agents/prompts.ts` are already nearly verbatim copies of the claude-nexus agent markdown bodies. 25 versions of prompt iteration already exist in claude-nexus. Reimplementation discards that work and multiplies effort under bidirectional scenario. |
| D | Full Shared-Core with runtime | Extract both prompt content AND runtime code (hooks, MCP, tool implementations) into a shared package | **Rejected as temporally wrong** — This is the correct long-term destination but incorrect now. claude-nexus is too volatile to freeze for extraction. The runtime abstraction layer (abstracting over Claude Code hooks vs OpenCode hooks) is speculative engineering before both harnesses have stabilized. |
| E | Shared Prompt Library | Extract only prompt bodies and metadata (no runtime code) into `@moreih29/nexus-core`; each harness resolves capabilities against its own tool namespace | **Adopted** — Minimum viable abstraction. Prompts are platform-neutral. Runtime code stays per-harness. Capability abstraction layer resolves tool-name differences cleanly without speculative runtime engineering. |

The key insight distinguishing Option E from Option D: the capability abstraction layer (abstract capability strings like `no_file_edit` that map to per-harness concrete tool lists) handles the only truly harness-specific information in the agent metadata — the tool restriction list. Everything else (prompt body, description, category, tags) is genuinely platform-neutral.

---

## §2 Architectural principles
## §2 아키텍처 원칙

### §2.1 Two-layer split: neutral vs runtime-specific / 중립 vs 런타임 특화 2계층 분리

Every piece of information in a Nexus agent or skill definition belongs to one of two layers:

**Neutral layer (shared in nexus-core):**

These fields are platform-independent and can be consumed by any harness without modification:

- `id` — unique string identifier for the agent (e.g., `architect`)
- `name` — display name (e.g., `Architect`)
- `alias_ko` — Korean name (e.g., `아키텍트`)
- `description` — one-line description of the agent's role
- `task` — short description of the tasks this agent handles
- `category` — one of `how`, `do`, `check`
- `tags` — list of descriptive strings
- `capabilities` — list of abstract capability constraint strings (e.g., `["no_file_edit", "no_task_create"]`)
- `resume_tier` — one of `ephemeral`, `bounded`, `persistent`
- `body` — the full markdown prompt body, after stripping any host-specific tool name references
- `model_tier` — abstract model tier (e.g., `high`, `standard`) — **not** a concrete model identifier

**Forbidden in neutral layer (must NOT appear in nexus-core):**

- Concrete model names (e.g., `opus`, `sonnet`, `openai/gpt-5.3-codex`)
- Raw `disallowedTools` lists containing harness-specific tool identifiers (e.g., `mcp__plugin_claude-nexus_nx__nx_task_add`, `edit`, `write`)
- Runtime-enforced `maxTurns` integers (this is a harness-local policy)
- MCP tool call references in body text (e.g., `mcp__plugin_claude-nexus_nx__X` → must be rewritten to abstract `nx_X` during extraction)

**Allowed to vary between harnesses (Phase 1: none in neutral layer):**

In Phase 1, no fields in the neutral layer are harness-variant. All fields listed under "neutral" are identical across both harnesses. A future Phase 2 extension might allow per-harness body overlays for platform-specific sections, but this is explicitly deferred.

### §2.2 Capability abstraction pattern / 역량 추상화 패턴

The capability abstraction layer is the key architectural mechanism that makes Option E viable. Instead of storing per-harness tool names, the neutral layer stores abstract capability strings. Each harness resolves these strings into its own concrete tool restriction lists at build time.

Example mapping:

| Abstract capability | Concern | Claude Code mapping | OpenCode mapping |
|--------------------|---------|---------------------|------------------|
| `no_file_edit` | Prevent writing or editing files | `Edit`, `Write`, `NotebookEdit` | `edit`, `write`, `patch`, `multiedit` |
| `no_task_create` | Prevent creating new tasks | `mcp__plugin_claude-nexus_nx__nx_task_add` | `nx_task_add` |
| `no_task_update` | Prevent updating existing tasks | `mcp__plugin_claude-nexus_nx__nx_task_update` | `nx_task_update` |
| `no_shell_exec` | Prevent executing shell commands | `Bash` | `bash` |

Why this resolves the leaky abstraction: if nexus-core stored Claude Code's `mcp__plugin_claude-nexus_nx__nx_task_add` directly, OpenCode would have no use for it (the tool doesn't exist in OpenCode's tool space). Conversely, if it stored OpenCode's `nx_task_add`, Claude Code couldn't use it. The abstraction layer means nexus-core stores neither — it stores `no_task_create`, and each harness's build process resolves that to its own concrete identifier.

### §2.3 Forward-only schema / 단방향 전진 스키마

The nexus-core schema follows a forward-only evolution policy during Phase 1:

- No breaking changes to the meta.yml field schema during Phase 1
- Additive changes (new optional fields) are allowed with a minor version bump
- Breaking changes (removing required fields, changing field semantics) require a major version bump and are deferred until claude-nexus adopts the package
- Both semver minor and patch bumps are non-breaking

This policy exists because claude-nexus will eventually adopt nexus-core in Phase 2. If the schema breaks during Phase 1 (before claude-nexus consumes it), Phase 2 integration faces an avoidable migration burden.

Semver cadence:

- `0.1.0` — initial seed (9 agents, 5 skills, 4 capabilities)
- `0.1.x` — patch: fixing body content, correcting typos in vocabulary
- `0.2.0` — bump after all 9 agents and 5 skills are fully seeded and validated
- `1.0.0` — when both harnesses successfully consume the package

### §2.4 Staged migration / 단계적 마이그레이션

Phase 1 (opencode-nexus first): Only opencode-nexus integrates nexus-core. claude-nexus is untouched. The sync script runs manually: when the author makes a prompt change in claude-nexus, they run `import-from-claude-nexus.mjs` to pull the change into nexus-core. opencode-nexus's `generate-prompts.mjs` then regenerates the TypeScript source.

Phase 2 (both harnesses consume): Triggered by measurable flip signals (see §11). claude-nexus implements its own loader to read from the package. At this point, both harnesses are consuming nexus-core, and the sync script becomes bidirectional (or is retired in favor of direct nexus-core editing).

Why staging avoids the lockstep-refactor objection: the objection "both repos need to change simultaneously" is false under staging. opencode-nexus changes first; claude-nexus changes independently later when the flip conditions are met. There is no moment where both repos must be refactored together.

---

## §3 Schema specification (complete)
## §3 스키마 명세 (완전)

### §3.1 Directory tree / 디렉터리 트리

The complete `nexus-core` repository directory layout after Phase 1 completion:

```
nexus-core/
  agents/
    architect/
      body.md
      meta.yml
    designer/
      body.md
      meta.yml
    postdoc/
      body.md
      meta.yml
    strategist/
      body.md
      meta.yml
    engineer/
      body.md
      meta.yml
    researcher/
      body.md
      meta.yml
    writer/
      body.md
      meta.yml
    tester/
      body.md
      meta.yml
    reviewer/
      body.md
      meta.yml
  skills/
    nx-init/
      body.md
      meta.yml
    nx-plan/
      body.md
      meta.yml
    nx-run/
      body.md
      meta.yml
    nx-setup/
      body.md
      meta.yml
    nx-sync/
      body.md
      meta.yml
  vocabulary/
    capabilities.yml
    categories.yml
    resume-tiers.yml
  schema/
    agent.schema.json
    skill.schema.json
    capability.schema.json
  scripts/
    import-from-claude-nexus.mjs
  .import-state.json          (generated, gitignored)
  .github/
    workflows/
      validate.yml
  package.json
  VERSION
  CHANGELOG.md
  README.md
  LICENSE
```

### §3.2 agents/{id}/body.md spec / body.md 명세

The `body.md` file contains the pure markdown prompt body for the agent, stripped of any YAML frontmatter.

Rules for body.md content:

1. **Frontmatter stripped**: The `---` ... `---` YAML block that appears at the top of claude-nexus agent files must be removed. Only the markdown body remains.
2. **MCP tool reference normalization**: Any reference to `mcp__plugin_claude-nexus_nx__X` in the body text is rewritten to the abstract form `nx_X` during extraction. This applies to inline references, not just frontmatter.
3. **Host-specific tool name blacklist**: The following regex patterns must NOT appear in body.md:
   - `mcp__plugin_` (MCP plugin namespace prefix)
   - `\$CLAUDE_PLUGIN_ROOT` (Claude-specific environment variable)
   - `\bNotebookEdit\b` (Claude Code-specific tool name)
   - `\bTask\b` when used as a Claude Code tool name (context: "Use the Task tool to..." — this must be abstracted or removed)
   - `\bAskUserQuestion\b` (Claude Code-specific tool name)
4. **Platform-neutral language**: Body text must use abstract tool descriptions ("use file editing tools") rather than tool names ("use Edit/Write").

### §3.3 agents/{id}/meta.yml spec / meta.yml 명세

Full field specification for `meta.yml`:

| Field | Type | Classification | Constraints |
|-------|------|----------------|-------------|
| `id` | string | strictly neutral | kebab-case, matches directory name |
| `name` | string | strictly neutral | Title Case display name |
| `alias_ko` | string | strictly neutral | Korean display name |
| `description` | string | strictly neutral | One sentence, no host-specific terms |
| `task` | string | strictly neutral | Short task description |
| `category` | string | strictly neutral | enum: `how` \| `do` \| `check` |
| `tags` | string[] | strictly neutral | Descriptive strings, no host-specific terms |
| `capabilities` | string[] | strictly neutral | References to vocabulary/capabilities.yml entries |
| `resume_tier` | string | strictly neutral | enum: `ephemeral` \| `bounded` \| `persistent` |
| `model_tier` | string | strictly neutral | enum: `high` \| `standard` — NOT a concrete model name |

Fields that are FORBIDDEN in meta.yml (must not appear):

- `model` with a concrete value (e.g., `opus`, `sonnet`, `openai/gpt-5.3-codex`)
- `maxTurns` (runtime-local policy)
- `disallowedTools` (replaced by `capabilities`)

### §3.4 Complete meta.yml examples for all 9 agents / 9개 에이전트 meta.yml 완전 예시

**architect/meta.yml:**

```yaml
id: architect
name: Architect
alias_ko: 아키텍트
description: Technical design — evaluates How, reviews architecture, advises on implementation approach
task: "Architecture, technical design, code review"
category: how
tags:
  - architecture
  - design
  - review
  - technical
capabilities:
  - no_file_edit
  - no_task_create
  - no_task_update
resume_tier: persistent
model_tier: high
```

**designer/meta.yml:**

```yaml
id: designer
name: Designer
alias_ko: 디자이너
description: UX/UI design — evaluates user experience, interaction patterns, and how users will experience the product
task: "UI/UX design, interaction patterns, user experience"
category: how
tags:
  - design
  - ux
  - ui
  - interaction
  - experience
capabilities:
  - no_file_edit
  - no_task_create
  - no_task_update
resume_tier: persistent
model_tier: high
```

**postdoc/meta.yml:**

```yaml
id: postdoc
name: Postdoc
alias_ko: 포닥
description: Research methodology and synthesis — designs investigation approach, evaluates evidence quality, writes synthesis documents
task: "Research methodology, evidence synthesis"
category: how
tags:
  - research
  - synthesis
  - methodology
capabilities:
  - no_file_edit
  - no_task_create
  - no_task_update
  - no_shell_exec
resume_tier: persistent
model_tier: high
```

Note on postdoc: `no_shell_exec` is included here because opencode-nexus catalog.ts lists `bash` in postdoc's disallowedTools. The claude-nexus frontmatter does NOT currently list `Bash`. This is a drift — the security-conscious default (no shell) is the correct default. See §10.1 for resolution policy.

**strategist/meta.yml:**

```yaml
id: strategist
name: Strategist
alias_ko: 전략가
description: Business strategy — evaluates market positioning, competitive landscape, and business viability of decisions
task: "Business strategy, market analysis, competitive positioning"
category: how
tags:
  - strategy
  - business
  - market
  - competitive
  - positioning
capabilities:
  - no_file_edit
  - no_task_create
  - no_task_update
resume_tier: persistent
model_tier: high
```

**engineer/meta.yml:**

```yaml
id: engineer
name: Engineer
alias_ko: 엔지니어
description: Implementation — writes code, debugs issues, follows specifications from Lead and architect
task: "Code implementation, edits, debugging"
category: do
tags:
  - implementation
  - coding
  - debugging
capabilities:
  - no_task_create
resume_tier: bounded
model_tier: standard
```

**researcher/meta.yml:**

```yaml
id: researcher
name: Researcher
alias_ko: 리서처
description: Independent investigation — conducts web searches, gathers evidence, and reports findings with citations
task: "Web search, independent investigation"
category: do
tags:
  - research
  - investigation
  - web-search
  - analysis
capabilities:
  - no_file_edit
  - no_task_create
resume_tier: persistent
model_tier: standard
```

**writer/meta.yml:**

```yaml
id: writer
name: Writer
alias_ko: 라이터
description: Technical writing — transforms research findings, code, and analysis into clear documents and presentations for the intended audience
task: "Technical writing, documentation, presentations"
category: do
tags:
  - writing
  - documentation
  - communication
  - presentation
capabilities:
  - no_task_create
resume_tier: bounded
model_tier: standard
```

**tester/meta.yml:**

```yaml
id: tester
name: Tester
alias_ko: 테스터
description: Testing and verification — tests, verifies, validates stability and security of implementations
task: "Testing, verification, security review"
category: check
tags:
  - verification
  - testing
  - security
  - quality
capabilities:
  - no_file_edit
  - no_task_create
resume_tier: ephemeral
model_tier: standard
```

**reviewer/meta.yml:**

```yaml
id: reviewer
name: Reviewer
alias_ko: 리뷰어
description: Content verification — validates accuracy, checks facts, confirms grammar and format of non-code deliverables
task: "Content verification, fact-checking, grammar review"
category: check
tags:
  - review
  - verification
  - fact-checking
  - content
  - quality
capabilities:
  - no_file_edit
  - no_task_create
resume_tier: ephemeral
model_tier: standard
```

### §3.5 skills/{id}/ spec / 스킬 spec

Skill directories follow the same pattern as agents: `body.md` + `meta.yml`.

`body.md` for skills: the full skill prompt body, after stripping the YAML frontmatter block. Host-specific tool names must be normalized. `AskUserQuestion` references must be abstracted or removed.

`meta.yml` for skills:

| Field | Type | Classification |
|-------|------|----------------|
| `id` | string | strictly neutral |
| `name` | string | strictly neutral |
| `description` | string | strictly neutral |
| `purpose` | string | strictly neutral |
| `trigger_display` | string | strictly neutral — display hint only |
| `triggers` | string[] | strictly neutral — abstract trigger strings |
| `tool_surface` | string[] | strictly neutral — abstract `nx_*` tool names this skill uses |

Forbidden in skill meta.yml: concrete tool names (`nx_plan_start` is abstract and allowed; `mcp__plugin_claude-nexus_nx__nx_plan_start` is forbidden).

### §3.6 Complete meta.yml examples for all 5 skills / 5개 스킬 meta.yml 완전 예시

**nx-init/meta.yml:**

```yaml
id: nx-init
name: nx-init
description: "Project onboarding — scan, mission, essentials, context generation"
purpose: "Full project onboarding: scan codebase, establish project mission and essentials, generate context knowledge"
trigger_display: "/nexus:nx-init"
triggers:
  - "/nexus:nx-init"
tool_surface: []
```

**nx-plan/meta.yml:**

```yaml
id: nx-plan
name: nx-plan
description: Structured multi-perspective analysis to decompose issues, align on decisions, and produce an enriched plan before execution. Plan only — does not execute.
purpose: "Structured planning — subagent-based analysis, deliberate decisions, produce execution plan"
trigger_display: "[plan]"
triggers:
  - "[plan]"
  - "[plan:auto]"
tool_surface:
  - nx_plan_start
  - nx_plan_decide
  - nx_plan_update
  - nx_plan_status
```

**nx-run/meta.yml:**

```yaml
id: nx-run
name: nx-run
description: Execution — user-directed agent composition.
purpose: "Execution — user-directed agent composition"
trigger_display: "[run]"
triggers:
  - "[run]"
tool_surface:
  - nx_task_update
  - nx_task_close
  - nx_task_list
```

**nx-setup/meta.yml:**

```yaml
id: nx-setup
name: nx-setup
description: Interactive project setup wizard for Nexus configuration.
purpose: "Configure Nexus interactively"
trigger_display: "/nexus:nx-setup"
triggers:
  - "/nexus:nx-setup"
tool_surface: []
```

**nx-sync/meta.yml:**

```yaml
id: nx-sync
name: nx-sync
description: "Context knowledge synchronization — scans project state and updates .nexus/context/ design documents"
purpose: "Synchronize .nexus/context/ design documents with current project state"
trigger_display: "[sync]"
triggers:
  - "[sync]"
tool_surface: []
```

### §3.7 vocabulary/capabilities.yml spec and seed content / 역량 vocab 명세 및 초기 내용

```yaml
# vocabulary/capabilities.yml
# Each capability is an abstract constraint that can be resolved to per-harness tool lists.
# DO NOT store harness-specific tool names here. Those are in scripts/import-from-claude-nexus.mjs
# and scripts/generate-prompts.mjs mapping tables.

capabilities:
  - id: no_file_edit
    concern: "Prevent creating, writing, or editing files"
    mappings:
      claude-code: ["Edit", "Write", "NotebookEdit"]
      opencode: ["edit", "write", "patch", "multiedit"]

  - id: no_task_create
    concern: "Prevent creating new tasks in the task pipeline"
    mappings:
      claude-code: ["mcp__plugin_claude-nexus_nx__nx_task_add"]
      opencode: ["nx_task_add"]

  - id: no_task_update
    concern: "Prevent updating existing tasks in the task pipeline"
    mappings:
      claude-code: ["mcp__plugin_claude-nexus_nx__nx_task_update"]
      opencode: ["nx_task_update"]

  - id: no_shell_exec
    concern: "Prevent executing shell commands"
    mappings:
      claude-code: ["Bash"]
      opencode: ["bash"]
```

### §3.8 vocabulary/categories.yml / 카테고리 vocab

```yaml
# vocabulary/categories.yml
# The three agent categories and their semantics.

categories:
  - id: how
    label: HOW
    label_ko: 분석
    description: "Advisory analysis agents. They evaluate, advise, and provide multi-perspective analysis. They do not write code or execute tasks."

  - id: do
    label: DO
    label_ko: 실행
    description: "Task execution agents. They implement, research, write, and take action. They produce concrete artifacts."

  - id: check
    label: CHECK
    label_ko: 검증
    description: "Verification agents. They test, review, validate, and ensure quality. They assess the work of DO agents."
```

### §3.9 vocabulary/resume-tiers.yml / 재개 티어 vocab

```yaml
# vocabulary/resume-tiers.yml
# The three resume tiers define how long an agent thread persists.

resume_tiers:
  - id: ephemeral
    label: Ephemeral
    label_ko: 일회성
    description: "Agent spawned fresh for each invocation. No state persists between calls. Used for verification agents (tester, reviewer) where stale context is a liability."

  - id: bounded
    label: Bounded
    label_ko: 태스크 단위
    description: "Agent thread reused within a single task lifecycle. State persists across multiple exchanges within the same task. When the task closes, the thread is retired. Used for execution agents (engineer, writer)."

  - id: persistent
    label: Persistent
    label_ko: 세션 지속
    description: "Agent thread persists across tasks and potentially across sessions. Used for advisory agents (architect, designer, postdoc, strategist, researcher) where accumulated context improves advice quality."
```

### §3.10 schema/*.json / JSON 스키마 파일

**schema/agent.schema.json** (to be used with AJV for meta.yml validation):

```json
{
  "$id": "agent.schema.json",
  "type": "object",
  "required": ["id", "name", "alias_ko", "description", "task", "category", "tags", "capabilities", "resume_tier", "model_tier"],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]*$",
      "description": "Kebab-case unique agent identifier"
    },
    "name": {
      "type": "string",
      "description": "Title Case display name"
    },
    "alias_ko": {
      "type": "string",
      "description": "Korean display name"
    },
    "description": {
      "type": "string",
      "description": "One-sentence description, no host-specific terms"
    },
    "task": {
      "type": "string",
      "description": "Short task description"
    },
    "category": {
      "type": "string",
      "enum": ["how", "do", "check"]
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "minItems": 1
    },
    "capabilities": {
      "type": "array",
      "items": { "type": "string" }
    },
    "resume_tier": {
      "type": "string",
      "enum": ["ephemeral", "bounded", "persistent"]
    },
    "model_tier": {
      "type": "string",
      "enum": ["high", "standard"]
    }
  }
}
```

**schema/skill.schema.json:**

```json
{
  "$id": "skill.schema.json",
  "type": "object",
  "required": ["id", "name", "description", "purpose", "trigger_display", "triggers", "tool_surface"],
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
    "name": { "type": "string" },
    "description": { "type": "string" },
    "purpose": { "type": "string" },
    "trigger_display": { "type": "string" },
    "triggers": { "type": "array", "items": { "type": "string" } },
    "tool_surface": { "type": "array", "items": { "type": "string" } }
  }
}
```

**schema/capability.schema.json:**

```json
{
  "$id": "capability.schema.json",
  "type": "object",
  "required": ["id", "concern", "mappings"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
    "concern": { "type": "string" },
    "mappings": {
      "type": "object",
      "required": ["claude-code", "opencode"],
      "properties": {
        "claude-code": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
        "opencode": { "type": "array", "items": { "type": "string" }, "minItems": 1 }
      }
    }
  }
}
```

---

## §4 Capability vocabulary (complete initial set)
## §4 역량 vocab 완전 초기 집합

### §4.1 Capability definitions / 역량 정의

**`no_file_edit`**

- Concern: Prevents the agent from creating, modifying, or deleting files. Advisory and research agents should not write to the codebase — only Lead and Engineer create files as part of their sanctioned role.
- Claude Code mapping: `Edit`, `Write`, `NotebookEdit` — the three Claude Code tools that can write to disk
- OpenCode mapping: `edit`, `write`, `patch`, `multiedit` — the four OpenCode tools that write to disk
- Agents that require this: architect, designer, postdoc, strategist, tester, reviewer, researcher

**`no_task_create`**

- Concern: Prevents the agent from adding new tasks to the task pipeline. Only Lead manages task creation. Sub-agents operate within tasks assigned to them; they must not unilaterally extend the pipeline.
- Claude Code mapping: `mcp__plugin_claude-nexus_nx__nx_task_add`
- OpenCode mapping: `nx_task_add`
- Agents that require this: all 9 agents (architect, designer, postdoc, strategist, engineer, researcher, writer, tester, reviewer)

**`no_task_update`**

- Concern: Prevents the agent from modifying the status or content of existing tasks. Only Lead updates task state. Sub-agents report results to Lead, who then updates tasks.
- Claude Code mapping: `mcp__plugin_claude-nexus_nx__nx_task_update`
- OpenCode mapping: `nx_task_update`
- Agents that require this: architect, designer, postdoc, strategist (HOW agents); tester, reviewer (CHECK agents). NOT required for: engineer, researcher, writer (these DO agents are allowed to update their own task in some harness configurations)

**`no_shell_exec`**

- Concern: Prevents the agent from running shell commands. This is a security constraint for research and advisory agents whose role does not require direct codebase mutation. Shell access enables file system traversal and process execution beyond the intended read-only scope.
- Claude Code mapping: `Bash`
- OpenCode mapping: `bash`
- Agents that require this: postdoc (confirmed in opencode-nexus catalog.ts). Note: claude-nexus currently does NOT restrict Bash for postdoc — this is a drift. Resolution: keep the restriction, send PR to claude-nexus (see §10.1).

### §4.2 Agent × capability matrix / 에이전트 × 역량 매트릭스

The following matrix shows which agents require which capabilities. Source: `/Users/kih/workspaces/areas/opencode-nexus/src/agents/catalog.ts` (opencode-nexus) and `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/` frontmatter (claude-nexus).

| Agent | `no_file_edit` | `no_task_create` | `no_task_update` | `no_shell_exec` |
|-------|:--------------:|:----------------:|:----------------:|:---------------:|
| architect | YES | YES | YES | no |
| designer | YES | YES | YES | no |
| postdoc | YES | YES | YES | **YES** |
| strategist | YES | YES | YES | no |
| engineer | no | YES | no | no |
| researcher | YES | YES | no | no |
| writer | no | YES | no | no |
| tester | YES | YES | no | no |
| reviewer | YES | YES | no | no |

Matrix reading notes:
- The postdoc row has `no_shell_exec` marked in bold because this capability exists in the opencode-nexus catalog but is missing from the claude-nexus frontmatter. This is a known drift (see §10.1).
- Engineer has `no_task_create` because engineers should not extend the pipeline scope. Engineer CAN edit files (no `no_file_edit`).
- Writer has `no_task_create` but CAN edit files (no `no_file_edit`) — writer's job requires writing deliverable files using `nx_artifact_write`.
- Researcher CAN execute web search tools (no `no_shell_exec`) but CANNOT edit files.

### §4.3 Extension policy / 역량 확장 정책

Adding a new capability to `vocabulary/capabilities.yml` requires a Lead plan session and answers to three questions:

1. **Subset/union test**: Is this new capability a strict subset or superset of an existing capability? If yes, consider whether the existing capability should be refined rather than adding a new one.
2. **YAGNI test**: Does at least one agent need this capability *right now* — not speculatively in the future? If no concrete agent needs it, defer.
3. **All-runtime mapping test**: Does this capability have a concrete tool-name mapping for BOTH `claude-code` AND `opencode`? If only one runtime has a concrete mapping, adding the capability now creates a permanently unresolvable mapping — defer until both runtimes have mappings.

A new capability is a **minor semver bump** (e.g., `0.1.0` → `0.2.0`) if no existing agent's effective capability set changes. If adding the capability retroactively changes what any existing agent is allowed or disallowed to do, it is a **major semver bump**.

---

## §5 Phase 1 execution steps
## §5 Phase 1 실행 단계

**Important**: Execute these steps in the exact order given. Steps within a section can be parallelized, but sections depend on each other in sequence.

### §5.1 Bootstrap the repository / 저장소 초기화

```bash
mkdir nexus-core
cd nexus-core
git init
git checkout -b main
```

Create `README.md` (stub content — will be expanded after content is seeded):

```markdown
# @moreih29/nexus-core

Shared prompt library for the Nexus orchestration system. Consumed by opencode-nexus and claude-nexus.

See [nexus-core-bootstrap.md] for full specification.
```

Create `LICENSE` (MIT):

```
MIT License

Copyright (c) 2026 moreih29
```

Create `VERSION`:

```
0.1.0
```

Create `CHANGELOG.md`:

```markdown
# Changelog

## 0.1.0 — 2026-04-10

Initial seed. 9 agents, 5 skills, 4 capabilities extracted from claude-nexus v0.25.0.
```

Create `package.json` (see §5.7 for full content).

### §5.2 Create directory structure / 디렉터리 구조 생성

```bash
mkdir -p agents/architect agents/designer agents/postdoc agents/strategist
mkdir -p agents/engineer agents/researcher agents/writer agents/tester agents/reviewer
mkdir -p skills/nx-init skills/nx-plan skills/nx-run skills/nx-setup skills/nx-sync
mkdir -p vocabulary schema scripts .github/workflows
```

### §5.3 Per-agent extraction from claude-nexus / 에이전트별 추출

Source directory: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/`

For each agent, follow this procedure:

**Step A — Read the source file**: Read the full content of `{agent_id}.md` from the source directory.

**Step B — Strip the frontmatter**: The file begins with `---` ... `---`. Remove everything from the first `---` up to and including the closing `---`. The remaining content is the body.

**Step C — Normalize body content**: Apply the following rewrites to the body:
- Replace any occurrence of `mcp__plugin_claude-nexus_nx__nx_X` with `nx_X` (where X is any suffix)
- Remove or abstract any reference to `AskUserQuestion`
- Remove any reference to `NotebookEdit` as a tool name
- Verify no `mcp__plugin_` prefix remains

**Step D — Write body.md**: Write the normalized body to `agents/{id}/body.md`.

**Step E — Convert frontmatter to meta.yml**: Using the field mapping in §3.3:
- `name` → `name`
- `alias_ko` → `alias_ko`
- `description` → `description`
- `task` → `task`
- `category` → `category`
- `tags` → `tags`
- `resume_tier` → `resume_tier`
- `model` → convert to `model_tier`: `opus` → `high`, `sonnet` → `standard`
- `disallowedTools` → convert to `capabilities` using the disallowedTools → capabilities table in §5.5
- `maxTurns` → **OMIT** (not included in meta.yml)
- Add `id` field = the agent directory name

**Step F — Write meta.yml**: Write the complete meta.yml to `agents/{id}/meta.yml`. Use the examples in §3.4 as the canonical reference.

**Per-agent source paths:**

- architect: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/architect.md`
- designer: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/designer.md`
- postdoc: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/postdoc.md`
- strategist: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/strategist.md`
- engineer: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/engineer.md`
- researcher: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/researcher.md`
- writer: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/writer.md`
- tester: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/tester.md`
- reviewer: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/reviewer.md`

### §5.4 Per-skill extraction from claude-nexus / 스킬별 추출

Source directory: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/skills/`

Follow the same extraction procedure as §5.3, with these skill-specific differences:

- Frontmatter fields map to skill meta.yml (see §3.5 and §3.6)
- `trigger_display` field: replace `/claude-nexus:` prefix with `/nexus:` in the stored value (this makes the display trigger harness-neutral)
- `triggers` array: same normalization — replace `/claude-nexus:` with `/nexus:`
- `tool_surface`: list the abstract `nx_*` tool names this skill invokes. Derive these from reading the skill body content.
- `disable-model-invocation` field in nx-setup frontmatter: **OMIT** (runtime-local)

**Per-skill source paths:**

- nx-init: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/skills/nx-init/SKILL.md`
- nx-plan: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/skills/nx-plan/SKILL.md`
- nx-run: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/skills/nx-run/SKILL.md`
- nx-setup: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/skills/nx-setup/SKILL.md`
- nx-sync: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/skills/nx-sync/SKILL.md`

### §5.5 disallowedTools → capabilities conversion table / disallowedTools → capabilities 변환표

Use this table when converting the claude-nexus frontmatter `disallowedTools` list to `capabilities` in meta.yml.

| Claude Code tool name | Abstract capability |
|-----------------------|--------------------|
| `Edit` | `no_file_edit` |
| `Write` | `no_file_edit` |
| `NotebookEdit` | `no_file_edit` |
| `mcp__plugin_claude-nexus_nx__nx_task_add` | `no_task_create` |
| `mcp__plugin_claude-nexus_nx__nx_task_update` | `no_task_update` |
| `Bash` | `no_shell_exec` |

Grouping rule: if all three of `Edit`, `Write`, `NotebookEdit` appear in `disallowedTools`, they map to a single `no_file_edit` capability (not three separate capabilities). This is because they collectively represent "file editing" — the same semantic concern.

**Per-agent conversion results:**

| Agent | claude-nexus disallowedTools | nexus-core capabilities |
|-------|------------------------------|------------------------|
| architect | `[Edit, Write, NotebookEdit, mcp__plugin_...nx_task_add, mcp__plugin_...nx_task_update]` | `[no_file_edit, no_task_create, no_task_update]` |
| designer | `[Edit, Write, NotebookEdit, mcp__plugin_...nx_task_add, mcp__plugin_...nx_task_update]` | `[no_file_edit, no_task_create, no_task_update]` |
| postdoc | `[Edit, Write, NotebookEdit, mcp__plugin_...nx_task_add, mcp__plugin_...nx_task_update]` | `[no_file_edit, no_task_create, no_task_update, no_shell_exec]` |
| strategist | `[Edit, Write, NotebookEdit, mcp__plugin_...nx_task_add, mcp__plugin_...nx_task_update]` | `[no_file_edit, no_task_create, no_task_update]` |
| engineer | `[mcp__plugin_...nx_task_add]` | `[no_task_create]` |
| researcher | `[Edit, Write, NotebookEdit, mcp__plugin_...nx_task_add]` | `[no_file_edit, no_task_create]` |
| writer | `[mcp__plugin_...nx_task_add]` | `[no_task_create]` |
| tester | `[Edit, Write, NotebookEdit, mcp__plugin_...nx_task_add]` | `[no_file_edit, no_task_create]` |
| reviewer | `[Edit, Write, NotebookEdit, mcp__plugin_...nx_task_add]` | `[no_file_edit, no_task_create]` |

**Postdoc bash drift note**: The claude-nexus `postdoc.md` frontmatter (read from `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/postdoc.md`) lists `disallowedTools: [Edit, Write, NotebookEdit, mcp__plugin_claude-nexus_nx__nx_task_add, mcp__plugin_claude-nexus_nx__nx_task_update]`. It does NOT include `Bash`. However, the opencode-nexus catalog at `/Users/kih/workspaces/areas/opencode-nexus/src/agents/catalog.ts` includes `"bash"` in postdoc's `disallowedTools`. Resolution: the nexus-core meta.yml for postdoc includes `no_shell_exec`. The claude-nexus source is considered to have an omission bug. A PR should be opened against claude-nexus to add `Bash` to postdoc's `disallowedTools`. See §10.1.

### §5.6 Seed vocabulary and schema files / vocab 및 schema 파일 시드

Write the following files using the content defined in §3.7 through §3.10:

- `vocabulary/capabilities.yml` — content from §3.7
- `vocabulary/categories.yml` — content from §3.8
- `vocabulary/resume-tiers.yml` — content from §3.9
- `schema/agent.schema.json` — content from §3.10
- `schema/skill.schema.json` — content from §3.10
- `schema/capability.schema.json` — content from §3.10

### §5.7 package.json final content / package.json 최종 내용

```json
{
  "name": "@moreih29/nexus-core",
  "version": "0.1.0",
  "description": "Shared prompt library for the Nexus orchestration system",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git@github.com:moreih29/nexus-core.git"
  },
  "keywords": [
    "nexus",
    "agents",
    "orchestration",
    "opencode",
    "claude"
  ],
  "type": "module",
  "files": [
    "agents/",
    "skills/",
    "vocabulary/",
    "schema/",
    "VERSION",
    "CHANGELOG.md"
  ],
  "exports": {
    ".": "./package.json",
    "./agents/*": "./agents/*/",
    "./skills/*": "./skills/*/",
    "./vocabulary/*": "./vocabulary/*",
    "./schema/*": "./schema/*"
  },
  "scripts": {
    "validate": "node scripts/validate.mjs",
    "import": "node scripts/import-from-claude-nexus.mjs"
  },
  "devDependencies": {
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "js-yaml": "^4.1.0"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

Note: `@moreih29/nexus-core` is scoped. The unscoped name `nexus-core` is squatted by an abandoned middleware package on npm. Always use the scoped name.

### §5.8 First publish checklist / 첫 퍼블리시 체크리스트

Execute in order:

1. Verify all 9 agent directories have `body.md` and `meta.yml`
2. Verify all 5 skill directories have `body.md` and `meta.yml`
3. Verify `vocabulary/*.yml` files exist and are valid YAML
4. Verify `schema/*.json` files are valid JSON
5. Run CI validation locally: `node scripts/validate.mjs` (see §7 for what this script does)
6. `npm login` — authenticate with npm registry
7. `npm publish --dry-run` — verify the package contents without publishing
8. Review dry-run output: confirm that `agents/`, `skills/`, `vocabulary/`, `schema/` are included and no unexpected files are bundled
9. `npm publish` — publish to npm registry
10. `git tag v0.1.0`
11. `git push origin main --tags`
12. Verify package appears at registry: `npm info @moreih29/nexus-core`

---

## §6 Sync script specification
## §6 동기화 스크립트 명세

### §6.1 Location / 위치

```
nexus-core/scripts/import-from-claude-nexus.mjs
```

### §6.2 CLI signature / CLI 서명

```bash
node scripts/import-from-claude-nexus.mjs --source <path> [--dry-run]
```

- `--source <path>`: Absolute path to the root of the claude-nexus installation. Example: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0`
- `--dry-run`: Print all intended changes with diffs. Touch no files. Exit with non-zero code if any conflicts are detected.

### §6.3 What it reads / 읽는 파일 목록

From `--source`:

- `{source}/agents/architect.md`
- `{source}/agents/designer.md`
- `{source}/agents/postdoc.md`
- `{source}/agents/strategist.md`
- `{source}/agents/engineer.md`
- `{source}/agents/researcher.md`
- `{source}/agents/writer.md`
- `{source}/agents/tester.md`
- `{source}/agents/reviewer.md`
- `{source}/skills/nx-init/SKILL.md`
- `{source}/skills/nx-plan/SKILL.md`
- `{source}/skills/nx-run/SKILL.md`
- `{source}/skills/nx-setup/SKILL.md`
- `{source}/skills/nx-sync/SKILL.md`

### §6.4 What it writes / 쓰는 파일 목록

Output directory is the nexus-core repository root (where the script is located):

- `agents/{id}/body.md` — normalized body content
- `agents/{id}/meta.yml` — converted frontmatter (note: script does NOT overwrite capabilities — capabilities are maintained in nexus-core manually, since postdoc drift shows claude-nexus can be missing restrictions)
- `.import-state.json` — idempotency tracking file (gitignored)

**`.import-state.json` schema:**

```json
{
  "last_import": "2026-04-10T00:00:00Z",
  "source_path": "/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0",
  "entries": {
    "agents/architect": {
      "source_sha256": "abc123...",
      "imported_at": "2026-04-10T00:00:00Z"
    }
  }
}
```

### §6.5 Execution triggers / 실행 트리거

**Manual only in Phase 1.** The script is NOT run by CI automatically, NOT by a cron job, and NOT by a git hook. The author runs it manually when they notice that claude-nexus has received a meaningful prompt update.

Rationale: automated sync would silently overwrite intentional divergences (like the postdoc `no_shell_exec` decision). Manual execution puts the author in the loop for every import decision.

### §6.6 Conflict handling / 충돌 처리

3-way diff algorithm pseudocode:

```
for each source file:
  source_content = read(source_path)
  source_sha256  = sha256(source_content)
  target_path    = derived target path in nexus-core
  
  if not exists(target_path):
    # New file — import directly
    write(target_path, normalize(source_content))
    update_state(source_sha256)
    continue
  
  last_known_sha256 = state[target].source_sha256
  target_content    = read(target_path)
  
  if source_sha256 == last_known_sha256:
    # Source unchanged since last import — skip
    continue
  
  if last_known_sha256 == None:
    # First time this entry is tracked — treat as new
    write(target_path, normalize(source_content))
    update_state(source_sha256)
    continue
  
  # Source changed since last import AND target exists
  # Check if target was also manually edited since last import
  target_sha256_at_last_import = sha256(denormalize(target_content))
  
  if target_content differs from what would have been imported at last_known_sha256:
    # CONFLICT: both source and target have changed
    write(target_path + ".import.new", normalize(source_content))
    log("CONFLICT: {target_path} — manual merge required. New content in {target_path}.import.new")
    set exit_code = 1
    continue
  
  # No conflict — source changed, target unchanged — safe to overwrite
  write(target_path, normalize(source_content))
  update_state(source_sha256)
```

On exit code 1 (conflict detected), the script prints the list of conflicting files and the location of `.import.new` side-files. The author resolves conflicts manually, then re-runs the script (which will skip already-imported entries and process only unresolved ones).

### §6.7 Idempotency / 멱등성

The script is idempotent: running it twice with the same source produces the same result as running it once. The SHA-256 check in `.import-state.json` ensures that unchanged source files are skipped. Overwriting a file with identical content is not a side effect.

### §6.8 Dry-run mode / 드라이런 모드

With `--dry-run`:
- For each file that WOULD be written: print the unified diff between current target and proposed new content
- For each file that WOULD be skipped: print a one-line "SKIP: {path} (unchanged)"
- For each conflict: print "CONFLICT: {path}" and the conflicting diff
- Touch no files
- Exit with non-zero code if any conflicts would be detected, zero otherwise

### §6.9 Inverse direction absent in Phase 1 / Phase 1에서 역방향 없음

There is no `export-to-claude-nexus.mjs` or inverse direction in Phase 1. When opencode-nexus produces a prompt improvement that should be shared, the flow is:

1. Author edits nexus-core directly (add the improvement to `agents/{id}/body.md`)
2. Author bumps VERSION and publishes
3. opencode-nexus's `generate-prompts.mjs` picks up the change on next build
4. claude-nexus's Phase 2 loader will pick up the change when Phase 2 is implemented

The inverse direction (opencode-nexus → nexus-core directly) is deferred to Phase 2 and will require a new script with different logic.

---

## §7 CI / test gates
## §7 CI / 테스트 게이트

### §7.1 Complete .github/workflows/validate.yml template

```yaml
# .github/workflows/validate.yml
# Runs on all pushes and pull requests to main branch.
# All jobs must pass before merging.

name: Validate nexus-core

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  schema-validate:
    name: Schema validation (meta.yml)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - name: Validate all agent meta.yml files
        run: |
          node -e "
          import Ajv from 'ajv';
          import { readFileSync, readdirSync } from 'fs';
          import { load } from 'js-yaml';
          const ajv = new Ajv();
          const schema = JSON.parse(readFileSync('schema/agent.schema.json', 'utf8'));
          const validate = ajv.compile(schema);
          let failed = false;
          for (const dir of readdirSync('agents')) {
            const meta = load(readFileSync('agents/' + dir + '/meta.yml', 'utf8'));
            if (!validate(meta)) {
              console.error('FAIL agents/' + dir + '/meta.yml:', validate.errors);
              failed = true;
            }
          }
          if (failed) process.exit(1);
          console.log('All agent meta.yml files valid.');
          "
      - name: Validate all skill meta.yml files
        run: |
          node -e "
          import Ajv from 'ajv';
          import { readFileSync, readdirSync } from 'fs';
          import { load } from 'js-yaml';
          const ajv = new Ajv();
          const schema = JSON.parse(readFileSync('schema/skill.schema.json', 'utf8'));
          const validate = ajv.compile(schema);
          let failed = false;
          for (const dir of readdirSync('skills')) {
            const meta = load(readFileSync('skills/' + dir + '/meta.yml', 'utf8'));
            if (!validate(meta)) {
              console.error('FAIL skills/' + dir + '/meta.yml:', validate.errors);
              failed = true;
            }
          }
          if (failed) process.exit(1);
          console.log('All skill meta.yml files valid.');
          "

  capability-integrity:
    name: Capability integrity check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - name: Check all referenced capabilities exist with full mappings
        run: |
          node -e "
          import { readFileSync, readdirSync } from 'fs';
          import { load } from 'js-yaml';
          const vocab = load(readFileSync('vocabulary/capabilities.yml', 'utf8'));
          const knownIds = new Set(vocab.capabilities.map(c => c.id));
          const allWithMappings = vocab.capabilities.filter(c =>
            c.mappings && c.mappings['claude-code'] && c.mappings['opencode']
          );
          const mappedIds = new Set(allWithMappings.map(c => c.id));
          let failed = false;
          for (const dir of readdirSync('agents')) {
            const meta = load(readFileSync('agents/' + dir + '/meta.yml', 'utf8'));
            for (const cap of (meta.capabilities || [])) {
              if (!knownIds.has(cap)) {
                console.error('UNKNOWN capability:', cap, 'in agents/' + dir);
                failed = true;
              }
              if (!mappedIds.has(cap)) {
                console.error('MISSING mapping for capability:', cap, 'in agents/' + dir);
                failed = true;
              }
            }
          }
          if (failed) process.exit(1);
          console.log('Capability integrity OK.');
          "

  body-lint:
    name: Body file host-specific identifier check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check for forbidden patterns in body.md files
        run: |
          FAILED=0
          PATTERNS=(
            "mcp__plugin_"
            '\$CLAUDE_PLUGIN_ROOT'
            '\bNotebookEdit\b'
            '\bAskUserQuestion\b'
          )
          for file in agents/*/body.md skills/*/body.md; do
            for pattern in "${PATTERNS[@]}"; do
              if grep -qP "$pattern" "$file"; then
                echo "FORBIDDEN pattern '$pattern' found in $file"
                FAILED=1
              fi
            done
          done
          if [ $FAILED -ne 0 ]; then exit 1; fi
          echo "Body lint: all files clean."

  import-roundtrip:
    name: Import roundtrip (dry-run)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - name: Clone claude-nexus at latest tagged version
        run: |
          # This step requires the claude-nexus source to be available.
          # In CI, clone from the author's machine or a mirrored location.
          # Phase 1: this job is SKIP-level (warn only) until a CI-accessible mirror exists.
          echo "SKIP: import-roundtrip requires claude-nexus source access. Deferred."
          exit 0
      - name: Run import --dry-run
        run: |
          node scripts/import-from-claude-nexus.mjs \
            --source ./claude-nexus-source \
            --dry-run
          echo "Roundtrip dry-run complete."

  release-tag:
    name: Release on VERSION change (manual approval required)
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    needs: [schema-validate, capability-integrity, body-lint]
    steps:
      - uses: actions/checkout@v4
      - name: Check if VERSION changed
        id: version-check
        run: |
          git fetch origin main
          PREV=$(git show HEAD~1:VERSION 2>/dev/null || echo "none")
          CURR=$(cat VERSION)
          if [ "$PREV" != "$CURR" ]; then
            echo "changed=true" >> $GITHUB_OUTPUT
            echo "version=$CURR" >> $GITHUB_OUTPUT
          else
            echo "changed=false" >> $GITHUB_OUTPUT
          fi
      - name: Request manual approval before publish
        if: steps.version-check.outputs.changed == 'true'
        run: |
          echo "VERSION changed to ${{ steps.version-check.outputs.version }}"
          echo "Manual npm publish required. Run: npm publish from the release tag."
          echo "This job does NOT auto-publish. Author must run npm publish manually."
```

### §7.2 schema-validate job details

The schema-validate job uses AJV to validate each `meta.yml` against the corresponding `schema/agent.schema.json` or `schema/skill.schema.json`. It reads all directories under `agents/` and `skills/`, parses each `meta.yml` with `js-yaml`, and runs AJV validation. Any failure causes the job to exit 1 with a detailed error message.

### §7.3 capability-integrity job details

The capability-integrity job verifies two things:
1. Every capability string referenced in any meta.yml's `capabilities` list exists in `vocabulary/capabilities.yml`
2. Every such capability has a non-empty mapping for BOTH `claude-code` AND `opencode`

If a capability is referenced but only has a mapping for one runtime, the job fails. This prevents "half-mapped" capabilities from being published.

### §7.4 body-lint job details

The body-lint job applies a regex blacklist to all `body.md` files. Forbidden patterns:

- `mcp__plugin_` — any MCP plugin namespace prefix (catches any undiscovered host-specific tool references)
- `\$CLAUDE_PLUGIN_ROOT` — Claude Code environment variable
- `\bNotebookEdit\b` — Claude Code tool name
- `\bAskUserQuestion\b` — Claude Code-specific interactive tool (should be abstracted in bodies)

The job runs `grep -P` for each pattern across all `agents/*/body.md` and `skills/*/body.md` files. Any match is a hard failure.

### §7.5 import-roundtrip job details

This job is deferred to Phase 1+ (once a CI-accessible location for claude-nexus source exists). In Phase 1, the job exits 0 with a SKIP message. The intent is: clone claude-nexus at its latest git tag, run `import --dry-run`, and assert that the dry-run produces no changes (meaning the current nexus-core content is up-to-date with the source). Approved drift (like the postdoc `no_shell_exec` decision) must be documented in a `.approved-drift.yml` file and excluded from the diff assertion.

### §7.6 release-tag job details

Triggered on any push to `main` that changes the `VERSION` file. Requires all three validation jobs to pass first. Does NOT auto-publish to npm — it outputs a message requesting manual publish. The author runs `npm publish` manually after reviewing the tag. This prevents accidental publishes from automated workflows.

---

## §8 opencode-nexus integration (Phase 1 후반)
## §8 opencode-nexus 통합 (Phase 1 후반)

This section describes the changes to be made in the `opencode-nexus` repository after `@moreih29/nexus-core` publishes at `0.1.0`. Execute these steps in the opencode-nexus repository at `/Users/kih/workspaces/areas/opencode-nexus/`.

### §8.1 scripts/generate-prompts.mjs design

Create `scripts/generate-prompts.mjs` in the opencode-nexus repository. This script:

1. Reads `node_modules/@moreih29/nexus-core/` — specifically:
   - `agents/{id}/body.md` for each of the 9 agents
   - `agents/{id}/meta.yml` for each of the 9 agents
   - `skills/{id}/body.md` for each of the 5 skills
   - `skills/{id}/meta.yml` for each of the 5 skills
   - `vocabulary/capabilities.yml` for the capability → tool mapping

2. For each agent, resolves the `capabilities` list to concrete opencode tool names using the `opencode` mapping in `vocabulary/capabilities.yml`

3. Emits two TypeScript files:
   - `src/agents/prompts.generated.ts`
   - `src/skills/prompts.generated.ts`

### §8.2 Generated output format

`src/agents/prompts.generated.ts` structure:

```typescript
// AUTO-GENERATED by scripts/generate-prompts.mjs
// Source: @moreih29/nexus-core v{version}
// DO NOT EDIT MANUALLY — regenerate with: bun run generate:prompts

import type { NexusAgentProfile } from './catalog.js';

export const AGENT_PROMPTS: Record<string, string> = {
  architect: `{full body.md content}`,
  designer: `{full body.md content}`,
  // ... all 9 agents
};

export const AGENT_META: Record<string, NexusAgentProfile> = {
  architect: {
    id: 'architect',
    name: 'Architect',
    category: 'how',
    description: '...',
    model: 'openai/gpt-5.3-codex', // resolved from model_tier by harness config
    disallowedTools: ['edit', 'write', 'patch', 'multiedit', 'nx_task_add', 'nx_task_update'],
    // ^ resolved from capabilities using vocabulary/capabilities.yml opencode mappings
  },
  // ... all 9 agents
};
```

The `disallowedTools` field in the generated TypeScript is the per-harness resolved form — it contains actual OpenCode tool names, not abstract capability strings. The resolution happens in `generate-prompts.mjs` at build time.

`src/skills/prompts.generated.ts` structure:

```typescript
// AUTO-GENERATED by scripts/generate-prompts.mjs
// Source: @moreih29/nexus-core v{version}
// DO NOT EDIT MANUALLY

export const SKILL_PROMPTS: Record<string, string> = {
  'nx-init': `{full body.md content}`,
  'nx-plan': `{full body.md content}`,
  // ... all 5 skills
};
```

### §8.3 devDependency vs dependency

`@moreih29/nexus-core` is a **devDependency** in opencode-nexus. Rationale: the package contains only static data (markdown and YAML files). The `generate-prompts.mjs` script reads those files at build time and inlines the content as TypeScript string literals in `prompts.generated.ts`. The published `dist/index.js` bundle contains no runtime I/O calls to the package — the data is baked in. Therefore, end users of `opencode-nexus` do not need `@moreih29/nexus-core` installed.

### §8.4 package.json changes in opencode-nexus

Two changes to `/Users/kih/workspaces/areas/opencode-nexus/package.json`:

1. Add `"generate:prompts": "node scripts/generate-prompts.mjs"` to the `scripts` field
2. Change `"build": "tsc -p tsconfig.json"` to `"build": "bun run generate:prompts && tsc -p tsconfig.json"` (or add `"prebuild"` script)
3. Add `"@moreih29/nexus-core": "^0.1.0"` to `devDependencies`

### §8.5 File changes: prompts.ts deletion

After `generate-prompts.mjs` is working and validated:

- `src/agents/prompts.ts` is **deleted**. It is replaced by a re-export barrel file:

```typescript
// src/agents/prompts.ts (replacement — thin re-export)
export { AGENT_PROMPTS, AGENT_META } from './prompts.generated.js';
```

- `src/skills/prompts.ts` is **deleted**. Same pattern:

```typescript
// src/skills/prompts.ts (replacement — thin re-export)
export { SKILL_PROMPTS } from './prompts.generated.js';
```

This preserves all existing import sites (anything that imports from `./prompts`) without requiring changes throughout the codebase.

### §8.6 catalog.ts disposition

`src/agents/catalog.ts` stays as-is. The `NEXUS_AGENT_CATALOG` array is NOT generated — it is kept as the authoritative TypeScript source for the agent type definitions and runtime catalog. However, `AGENT_META` from `prompts.generated.ts` provides a complementary computed version with resolved `disallowedTools`. These two sources must remain consistent.

The `generate-prompts.mjs` script should include a consistency check: for each agent in the generated `AGENT_META`, verify that `id`, `name`, and `category` match the corresponding entry in `catalog.ts`. This prevents silent drift between the catalog and the generated metadata.

### §8.7 e2e test changes

Three new e2e test scripts, replacing the existing `e2e-prompt-parity.mjs`:

- `scripts/e2e-prompts-generated.mjs` — replaces `e2e-prompt-parity.mjs`. Verifies that `AGENT_PROMPTS` in `prompts.generated.ts` contains non-empty strings for all 9 agent IDs. Verifies that `SKILL_PROMPTS` contains non-empty strings for all 5 skill IDs.

- `scripts/e2e-capability-coverage.mjs` — verifies that every agent's `disallowedTools` in `AGENT_META` resolves to a non-empty list for agents that have capabilities. Verifies no unknown tool names appear (tool names must be drawn from the OpenCode tool whitelist or the known OpenCode tool set).

- `scripts/e2e-loader-smoke.mjs` — imports `dist/index.js` (the compiled bundle) and verifies that the agent prompt content is accessible at runtime without requiring `@moreih29/nexus-core` to be present (confirming the devDependency-only contract).

Update the `test:e2e` script in `package.json` to replace `e2e-prompt-parity.mjs` with the three new scripts.

### §8.8 Hard-fail error behaviors

`generate-prompts.mjs` must hard-fail (exit 1) for:

- `ERR_MISSING_NEXUS_CORE` — `node_modules/@moreih29/nexus-core` is not found. Message: "ERROR: @moreih29/nexus-core not found. Run 'npm install' or 'bun install' first."
- `ERR_UNKNOWN_CAPABILITY` — a capability string in a meta.yml is not present in `vocabulary/capabilities.yml`. Message: "ERROR: Unknown capability '{cap}' in {agent_id}/meta.yml."
- `ERR_MISSING_MAPPING` — a capability is found in `vocabulary/capabilities.yml` but has no `opencode` mapping. Message: "ERROR: No opencode mapping for capability '{cap}'."

The build fails loudly rather than silently producing incomplete `disallowedTools` lists.

---

## §9 Known non-goals (Phase 1 excludes)
## §9 Phase 1 제외 항목 (비목표)

### §9.1 claude-nexus loader migration

Phase 1 does NOT modify claude-nexus. The claude-nexus repository continues to use its existing agent markdown files directly. Phase 2 (triggered by flip conditions in §11) is when claude-nexus implements a loader that reads from `@moreih29/nexus-core`.

### §9.2 Hook, tool, and runtime code sharing

`@moreih29/nexus-core` is a **prompt-only** shared library. The following are explicitly excluded from its scope:

- Hook implementations (`gate.cjs` equivalent for any harness)
- MCP server implementations (`mcp-server.cjs`)
- OpenCode plugin tool implementations (`nx_plan_start`, `nx_task_update`, etc.)
- TypeScript type definitions for runtime types (`NexusAgentProfile`, `NexusAgentCategory`)
- Any runtime I/O logic

These remain harness-specific. Sharing them would require runtime abstraction layers that are speculative and premature before both harnesses stabilize.

### §9.3 Model name and maxTurns hard limits

`nexus-core` does NOT store concrete model names or numeric `maxTurns` values. The `model_tier` field (`high` / `standard`) is an abstract hint. Each harness resolves `model_tier` to a concrete model name through its own configuration.

`maxTurns` is a runtime-enforcement policy. Claude Code uses the `maxTurns` frontmatter field to limit agent conversation length. OpenCode may have different or no equivalent. Neither value is shared — each harness sets its own limits.

### §9.4 .nexus/core hierarchy flattening

opencode-nexus uses a 4-layer `.nexus/core/{identity,codebase,memory,reference}` hierarchy. claude-nexus uses a flat `.nexus/{memory,context,rules}` layout. These will NOT be reconciled in Phase 1 or Phase 2. This is an intentional divergence documented in `/Users/kih/workspaces/areas/opencode-nexus/UPSTREAM.md`. The hierarchical layout in opencode-nexus exists to support role-based access matrix patterns that require layer separation.

---

## §10 Open variables (decisions needed during Phase 1 execution)
## §10 미결 변수 (Phase 1 실행 중 결정 필요)

### §10.1 Postdoc bash drift / 포닥 bash 드리프트

**Current state of discrepancy:**

- File: `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/postdoc.md`
- frontmatter `disallowedTools`: `[Edit, Write, NotebookEdit, mcp__plugin_claude-nexus_nx__nx_task_add, mcp__plugin_claude-nexus_nx__nx_task_update]`
- `Bash` is NOT listed.

- File: `/Users/kih/workspaces/areas/opencode-nexus/src/agents/catalog.ts`
- `disallowedTools` for postdoc: `["edit", "write", "patch", "multiedit", "bash", "nx_task_add", "nx_task_update"]`
- `"bash"` IS listed.

**Resolution (decided in plan session):** Keep `no_shell_exec` in postdoc's nexus-core `capabilities`. The opencode-nexus catalog is considered correct — Postdoc's role ("research methodology and synthesis") does not require shell command execution. The postdoc agent in claude-nexus should also restrict Bash.

**Required action:** Open a pull request against the claude-nexus repository to add `Bash` to the `disallowedTools` list in `agents/postdoc.md`. Until that PR is merged, there will be a known drift between nexus-core's postdoc capabilities (which include `no_shell_exec`) and claude-nexus's postdoc frontmatter (which omits Bash restriction). Document this drift in nexus-core's `.approved-drift.yml` file.

### §10.2 OpenCode tool whitelist source

**Problem:** There is no machine-readable list of tool names available from `@opencode-ai/plugin`. The capability-to-tool mapping for OpenCode is currently derived from reading the source code and available documentation. If the OpenCode tool API changes, the mapping could silently become incorrect.

**Phase 1 treatment:** The capability-coverage e2e test (`e2e-capability-coverage.mjs`) is **warning-level** for OpenCode tool name validation — it warns but does not fail if an OpenCode tool name cannot be verified against a canonical whitelist.

**Post-Phase-1 task:** Assign Researcher to investigate whether `@opencode-ai/plugin` exposes an introspection API or exports a machine-readable tool manifest. If found, update the capability-coverage test to fail hard on unknown OpenCode tool names.

---

## §11 Phase 2 trigger conditions
## §11 Phase 2 트리거 조건

### §11.1 Three measurable signals / 세 가지 측정 가능 신호

Signal 1 (Commit velocity reversal):

```
commits_14d(opencode-nexus) > commits_14d(claude-nexus) × 1.5
```

Measured as the number of git commits to each repository in the trailing 14-day window, on any given day. The signal fires when this condition holds for 2 consecutive weeks (14 consecutive days, not rolling average).

Signal 2 (Author declaration):

The author explicitly declares "Phase 2 transition" in one of:
- A plan session recorded in `.nexus/state/plan.json` of either repository
- `UPSTREAM.md` in opencode-nexus or claude-nexus
- A tagged GitHub release note

Signal 3 (Sync direction reversal):

The frequency of "opencode-nexus proposes change → nexus-core" operations exceeds "claude-nexus → nexus-core" operations over a 30-day window. Concretely: the number of commits to nexus-core that originated from opencode-nexus improvements exceeds those from claude-nexus improvements.

### §11.2 Trigger rule / 트리거 규칙

Phase 2 is triggered when:

```
Signal 1 AND (Signal 2 OR Signal 3)
```

Signal 1 alone is not sufficient — velocity difference may reflect a temporary project focus rather than a permanent flip. Signal 2 (author declaration) or Signal 3 (observable flow reversal) confirms that the flip is intentional and sustained.

### §11.3 90-day safety rail / 90일 안전망

Regardless of whether the trigger conditions in §11.2 are met, a Phase 2 re-evaluation plan session must be held every 90 days from Phase 1 completion. The re-evaluation assesses:

1. How much has accumulated in opencode-nexus that is not reflected in nexus-core?
2. Is claude-nexus still the de facto primary source of prompt improvements?
3. Has the gap between the two repositories grown enough that Phase 2 is now justified even without a formal flip?

If the re-evaluation finds that opencode-nexus has accumulated >5 prompt improvements not yet in nexus-core, or that the drift ledger (documented in `deferred-from-claude-nexus.md`) is growing rather than shrinking, Phase 2 is initiated early.

### §11.4 Phase 2 execution steps outline

When Phase 2 is triggered, execute in the following order:

1. In the `claude-nexus` repository: create `scripts/use-nexus-core.mjs` — a loader script that reads from `node_modules/@moreih29/nexus-core/agents/{id}/` and generates the equivalent of frontmatter-parsed agent profiles.

2. In claude-nexus: modify the agent loading logic to use the package instead of reading `agents/*.md` directly. The `agents/*.md` files become deprecated but are kept for reference during transition.

3. In claude-nexus: add `@moreih29/nexus-core` as a dependency (NOT devDependency — claude-nexus reads the package at runtime, not build time, because Claude Code plugins do not have a build step in the same sense).

4. Run the claude-nexus startup smoke test: verify that all 9 agents load correctly with the expected `disallowedTools` resolved from the claude-code mappings in `vocabulary/capabilities.yml`.

5. Bump nexus-core VERSION to `1.0.0`. This signals that both harnesses are consuming the package and the forward-only guarantee is now binding for both consumers.

6. Update `UPSTREAM.md` in both repositories to reflect the Phase 2 steady state.

---

## §12 Glossary
## §12 용어집

Terms are listed alphabetically. All terms relate to the nexus-core system as designed in this plan session.

**Bidirectional framing / 양방향 프레이밍**
The architectural principle that neither claude-nexus nor opencode-nexus is permanently the "primary" harness. The author's primary harness can flip over time. Any architecture that assumes a fixed primary/secondary relationship (like Soft Fork or Strict Mirror) is invalid under bidirectional framing.

**body.md / 본문 파일**
The file within each `agents/{id}/` or `skills/{id}/` directory in nexus-core that contains the pure markdown prompt body. Frontmatter has been stripped. Host-specific tool name references have been normalized. This file is the harness-neutral prompt content.

**Bounded resume tier / 태스크 단위 재개 티어**
A `resume_tier` value for agents that persist within a single task lifecycle. When the task closes, the agent thread is retired. Used for execution agents (engineer, writer) where accumulated context within a task is beneficial but cross-task state is a liability.

**Capability / 역량**
An abstract string (e.g., `no_file_edit`) that represents a behavioral constraint for an agent. Capabilities are defined in `vocabulary/capabilities.yml` with per-harness concrete tool name mappings. Storing capabilities instead of raw tool names is what makes nexus-core harness-neutral.

**Category (HOW/DO/CHECK) / 카테고리**
The three-way classification of agents by their role in the pipeline. HOW agents are advisory (architect, designer, postdoc, strategist). DO agents execute (engineer, researcher, writer). CHECK agents verify (tester, reviewer).

**Ephemeral resume tier / 일회성 재개 티어**
A `resume_tier` value for agents spawned fresh for each invocation. No state persists between calls. Used for verification agents (tester, reviewer) where stale context from a previous task would be a liability.

**Flip moment / 전환 시점**
The point in time when the author's primary harness changes — e.g., from claude-nexus to opencode-nexus or vice versa. After a flip, prompt improvements primarily originate in the new primary harness. Phase 2 of the nexus-core migration is designed to handle flip moments gracefully.

**Forward-only schema / 단방향 전진 스키마**
The policy that nexus-core's meta.yml field schema never has breaking changes during Phase 1. Only additive (backward-compatible) changes are allowed. This ensures that claude-nexus can adopt the package in Phase 2 without encountering a schema that has already undergone breaking evolution.

**Harness / 하네스**
A specific AI coding CLI that hosts the Nexus plugin. In this document, two harnesses are referenced: Claude Code (hosting claude-nexus) and OpenCode (hosting opencode-nexus).

**Lead-mediated coordination / Lead 중재 조정**
The communication model in which sub-agents do not send messages directly to each other. All inter-agent coordination passes through Lead. Lead owns tasks.json, spawns sub-agents, receives their outputs, and decides next steps. This prevents the "agents directly calling agents" antipattern.

**meta.yml / 메타 파일**
The YAML metadata file within each `agents/{id}/` or `skills/{id}/` directory in nexus-core. Contains fields that are strictly neutral (platform-independent): `id`, `name`, `alias_ko`, `description`, `task`, `category`, `tags`, `capabilities`, `resume_tier`, `model_tier`. Does NOT contain harness-specific fields (`disallowedTools`, `model`, `maxTurns`).

**nexus-core / 넥서스 코어**
The npm package `@moreih29/nexus-core`. An independent public repository containing shared prompt content (body.md files), neutral metadata (meta.yml files), capability vocabulary, and schema definitions. Published on npm. Consumed by opencode-nexus as a devDependency and by claude-nexus (Phase 2) as a dependency.

**Persistent resume tier / 세션 지속 재개 티어**
A `resume_tier` value for agents whose thread persists across tasks and potentially across sessions. Used for advisory agents (architect, designer, postdoc, strategist) and researcher, where accumulated context improves the quality of advice and research over time.

**Phase 1 / 1단계**
The period during which only opencode-nexus integrates `@moreih29/nexus-core`. claude-nexus continues to use its existing agent markdown files directly. Phase 1 ends when Phase 2 trigger conditions are met (see §11).

**Phase 2 / 2단계**
The period during which both opencode-nexus AND claude-nexus consume `@moreih29/nexus-core`. Phase 2 begins when the trigger conditions in §11 are satisfied and the Phase 2 execution steps in §11.4 are completed.

**Shared Prompt Library / 공유 프롬프트 라이브러리**
The architectural option (Option E in the plan session) selected for nexus-core. It extracts only prompt bodies and neutral metadata (not runtime code) into a shared package. Each harness resolves capability abstractions at build time. This is distinguished from Full Shared-Core (Option D), which would also share runtime code.

**Sibling (vs parent-child) / 자매 (vs 부모-자식)**
The relationship between opencode-nexus and claude-nexus. They are sibling projects — both consuming from the same canonical source (`@moreih29/nexus-core`) but neither is a downstream fork of the other. This contrasts with a parent-child relationship where one project would be authoritative and the other would be derivative.

**Soft Fork (rejected alternative) / 소프트 포크 (거부된 대안)**
Option B in the plan session. opencode-nexus would fork claude-nexus's prompts and periodically cherry-pick upstream changes every 2 weeks. Rejected under bidirectional framing because it assumes a stable parent (claude-nexus) that never becomes the downstream. When the flip occurs, the model breaks: there is no merge base, no rename tiebreaker, and the cherry-pick direction reverses.

**Strict Mirror (rejected alternative) / 엄격한 미러 (거부된 대안)**
Option A in the plan session. opencode-nexus would be a byte-for-byte mirror of claude-nexus with automated sync. Rejected because Claude Code primitives (`PreCompact`, `SubagentStart`, `NotebookEdit`) do not exist in OpenCode. Mirroring would produce content that references unavailable tools. The primitive mismatch is a hard incompatibility.

**vocabulary/capabilities.yml / 역량 vocab 파일**
The YAML file in nexus-core that defines all abstract capability strings, their semantic concerns, and their per-harness concrete tool name mappings. The single source of truth for capability definitions. Any capability referenced in a `meta.yml` must have an entry here with both `claude-code` and `opencode` mappings.

---

## §13 Source material (verbatim)
## §13 출처 자료 (원문)

This section preserves the verbatim content from the plan session that produced this document. It is included for traceability and to enable a future LLM to reconstruct the reasoning behind any decision without requiring access to the original conversation.

### §13.1 Plan session metadata / 플랜 세션 메타데이터

- **Session ID**: 16
- **Date**: 2026-04-10
- **Repository**: opencode-nexus (`/Users/kih/workspaces/areas/opencode-nexus/`)
- **Topic**: nexus-core shared prompt library architecture, operational model, and cleanup plan
- **Three issues deliberated**:
  - Issue #1: Architectural positioning — what relationship should opencode-nexus and claude-nexus have? (Options A through E)
  - Issue #2: Operational mechanics — package naming, repository structure, schema design, sync script, CI gates
  - Issue #3: Immediate cleanup — documentation updates, file renames, deferred item tracking, this bridge document

### §13.2 Issue #1 decision verbatim / 이슈 #1 결정 원문

Option E. Shared Prompt Library with staged migration, opencode-nexus first. opencode-nexus and claude-nexus are NOT in parent-child relationship but SIBLING projects, each belonging to their respective host (OpenCode / Claude Code). Author's primary harness can flip over time. Identity = "OpenCode-native Nexus runtime consuming @moreih29/nexus-core". Capability abstraction layer resolves leaky abstraction concerns of full Shared-Core. Rejected: Strict Mirror (fails at primitive level — PreCompact/SubagentStart don't exist in OpenCode), Soft Fork (assumes stable direction, breaks under bidirectional flip — merge base absent, rename tiebreaker absent), Reimplementation (discards 25 versions of prompt iteration, multiplies work under bidirectional), Full Shared-Core with runtime (runtime abstraction too speculative).

### §13.3 Issue #2 decision verbatim / 이슈 #2 결정 원문

Flavor 1 Strict operational model. Package name: `@moreih29/nexus-core` (scoped; unscoped `nexus-core` squatted by abandoned middleware). Repository: independent sibling repo `github.com/moreih29/nexus-core`, public npm publish. 3-file schema split (body.md neutral, meta.yml neutral, vocabulary/ for capabilities + categories + resume-tiers). Initial capabilities: 4 items (no_file_edit, no_task_create, no_task_update, no_shell_exec). Postdoc bash drift resolution: no_shell_exec stays (claude-nexus must adopt). Sync script: nexus-core/scripts/import-from-claude-nexus.mjs, manual only, 3-way diff conflict handling, idempotent via SHA-256, dry-run. Loader: build-time codegen in opencode-nexus (scripts/generate-prompts.mjs → src/agents/prompts.generated.ts), @moreih29/nexus-core as devDependency. Hard-fail CI gates. Initial version 0.1.0, bump to 0.2.0 after all 9 agents + 5 skills seeded.

### §13.4 Issue #3 decision verbatim / 이슈 #3 결정 원문

Option β Balanced cleanup. 11 work items: update mission/roadmap/design/architecture.md, delete prompt-parity-plan.md, create UPSTREAM.md + deferred-from-claude-nexus.md, rename meet.ts → plan.ts (Phase 1 bundled), create nexus-core-bootstrap.md bridge document. .nexus/core/{identity,codebase,memory,reference} hierarchy kept as intentional divergence. D8/D9/D10 (missing tags, resume_tier, nx_history_search) deferred as runtime scope. Single bridge document = single artifact that transfers to nexus-core repo.

### §13.5 Architect analysis key excerpts / 아키텍트 분석 핵심 발췌

**Architect Round 1 — Positioning analysis:**

Strict Mirror fails at the primitive level. OpenCode lacks `PreCompact` and `SubagentStart` hook events. The hook system, MCP bridge pattern, and tool name space are fundamentally different between the two harnesses. A mirrored copy would contain unresolvable tool references. Soft Fork was the original recommendation before bidirectional reframe. Under the assumption of stable direction (claude-nexus always primary), Soft Fork provides the simplest maintenance model: cherry-pick every 2 weeks, bounded obligation. Reimplementation's premise is empirically false — the agent prompt bodies in `src/agents/prompts.ts` are already nearly verbatim copies of the claude-nexus agent markdown bodies. 25 versions of prompt iteration already exist in claude-nexus; reimplementation discards that. Full Shared-Core is the correct long-term destination but temporally wrong because claude-nexus is too volatile to freeze for extraction.

**Architect Round 2 — Bidirectional reframe:**

The bidirectional reframe is the key insight. After the author clarified that "Nexus user on harness X this month" is the correct mental model, Soft Fork's "cherry-pick from stable upstream" assumption is invalidated. The capability abstraction layer is the architectural mechanism that makes Option E viable without speculative runtime abstraction. Platform-neutral fields include: body, id, category, description, tags, alias_ko, capabilities, resume_tier, model_tier. Fields forbidden from the neutral layer include: concrete model names, raw `disallowedTools` (replaced by capability strings), runtime-enforced `maxTurns`. Phase 1 opencode-nexus first is the minimum viable path — estimated 3–5 days, claude-nexus untouched initially.

**Architect Round 3 — Issue #2 operational mechanics:**

Full repository layout designed. 4-capability initial vocabulary with bilateral mappings for both harnesses. Sync script specification with 3-way diff conflict handling. Build-time codegen loader for opencode-nexus (devDependency pattern preserves the single `dist/index.js` bundle shape). New e2e tests required: 3 in opencode-nexus (e2e-prompts-generated, e2e-capability-coverage, e2e-loader-smoke). 5 CI workflows in nexus-core (schema-validate, capability-integrity, body-lint, import-roundtrip, release-tag). Postdoc bash drift discovered during analysis: claude-nexus `agents/postdoc.md` frontmatter does NOT include `Bash` in `disallowedTools`, but opencode-nexus `src/agents/catalog.ts` DOES include `"bash"`. Recommendation: keep `no_shell_exec` in nexus-core postdoc capabilities (security-conscious default); claude-nexus should adopt by adding `Bash` to postdoc frontmatter.

### §13.6 Strategist analysis key excerpts / 전략가 분석 핵심 발췌

**Strategist Round 1 — Positioning analysis:**

Under the assumption of stable direction (author energy on claude-nexus, bounded obligation model), Soft Fork wins. The "cherry-pick every 2 weeks" model provides the simplest maintenance path. The key constraint is author energy: bounded obligation ("cherry-pick every 2 weeks") is more sustainable than unbounded chase. Risk of passive degradation if cadence slips. 3-month leading indicators for monitoring: real releases exist, divergence ledger exists and is not growing, drift inventories are shrinking not expanding.

**Strategist Round 2 — Bidirectional reframe:**

Soft Fork's core assumption is invalidated by the bidirectional reframe. "Cherry-pick from claude-nexus" only works when claude-nexus is the permanent upstream. The user's framing "Nexus user on harness X this month" eliminates that assumption. The 6-month bridge metaphor breaks (no stable upstream to wait for). The strategic argument for upfront extraction: "paying the cost on the warm side is cheaper than paying it on the cold side." While claude-nexus is active and the author's attention is on it, extracting the prompts is lower cost than extracting them after a flip when claude-nexus is cold and institutional memory has decayed. Phase 2 trigger: 2 consecutive weeks of opencode-nexus commit velocity exceeding claude-nexus × 1.5, combined with author's primary project being on OpenCode.

### §13.7 claude-nexus file paths and content areas / claude-nexus 파일 경로 및 내용 영역

All paths are absolute. These are the source files for Phase 1 extraction.

**Agent source files:**
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/architect.md` — frontmatter: `disallowedTools: [Edit, Write, NotebookEdit, nx_task_add, nx_task_update]`, `resume_tier: persistent`, `model: opus`, `category: how`
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/designer.md` — frontmatter: same disallowed pattern as architect, `resume_tier: persistent`, `model: opus`, `category: how`
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/postdoc.md` — frontmatter: `disallowedTools: [Edit, Write, NotebookEdit, nx_task_add, nx_task_update]` (MISSING Bash — drift), `resume_tier: persistent`, `model: opus`, `category: how`
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/strategist.md` — frontmatter: same as architect, `resume_tier: persistent`, `model: opus`, `category: how`
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/engineer.md` — frontmatter: `disallowedTools: [nx_task_add]`, `resume_tier: bounded`, `model: sonnet`, `category: do`
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/researcher.md` — frontmatter: `disallowedTools: [Edit, Write, NotebookEdit, nx_task_add]`, `resume_tier: persistent`, `model: sonnet`, `category: do`
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/writer.md` — frontmatter: `disallowedTools: [nx_task_add]`, `resume_tier: bounded`, `model: sonnet`, `category: do`
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/tester.md` — frontmatter: `disallowedTools: [Edit, Write, NotebookEdit, nx_task_add]`, `resume_tier: ephemeral`, `model: sonnet`, `category: check`
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/agents/reviewer.md` — frontmatter: `disallowedTools: [Edit, Write, NotebookEdit, nx_task_add]`, `resume_tier: ephemeral`, `model: sonnet`, `category: check`

Note on frontmatter tool names: the actual disallowedTools values in claude-nexus use the full MCP namespace: `mcp__plugin_claude-nexus_nx__nx_task_add` and `mcp__plugin_claude-nexus_nx__nx_task_update`. The table above abbreviates them for readability. When extracting, use the full names from the actual files.

**Skill source files:**
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/skills/nx-init/SKILL.md` — triggers: `["/claude-nexus:nx-init"]`
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/skills/nx-plan/SKILL.md` — triggers: `["[plan]", "[plan:auto]"]`
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/skills/nx-run/SKILL.md` — triggers: `["[run]"]`
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/skills/nx-setup/SKILL.md` — triggers: `["/claude-nexus:nx-setup"]`, has `disable-model-invocation: true` (omit from meta.yml)
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/skills/nx-sync/SKILL.md` — triggers: `["[sync]"]`

**Other relevant claude-nexus files:**
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/hooks/hooks.json` — hook routing (not part of nexus-core extraction — runtime only)
- `/Users/kih/.claude/plugins/cache/nexus/claude-nexus/0.25.0/VERSION` — current version: `0.25.0`

### §13.8 opencode-nexus file paths and content areas / opencode-nexus 파일 경로 및 내용 영역

All paths are absolute. These are the files in opencode-nexus that are relevant to Phase 1 and Phase 2 execution.

**Source files being migrated:**
- `/Users/kih/workspaces/areas/opencode-nexus/src/agents/prompts.ts` — 740 lines. Contains `AGENT_PROMPTS: Record<string, string>`. Hand-copied from claude-nexus with accumulated drift. Will be replaced by `prompts.generated.ts` after Phase 1 integration.
- `/Users/kih/workspaces/areas/opencode-nexus/src/agents/catalog.ts` — `NEXUS_AGENT_CATALOG: NexusAgentProfile[]`. Uses OpenCode-native tool names (`edit`, `write`, `patch`, `multiedit`, `bash`, `nx_task_add`, `nx_task_update`). Source of truth for opencode-side disallowedTools. Postdoc row includes `"bash"` — the correct security-conscious default.
- `/Users/kih/workspaces/areas/opencode-nexus/src/tools/plan.ts` — was `meet.ts`. Contains `nxPlanStart`, `nxPlanDecide`, `nxPlanUpdate`, `nxPlanStatus`. Renamed as part of Issue #3 cleanup.

**Documentation files:**
- `/Users/kih/workspaces/areas/opencode-nexus/UPSTREAM.md` — upstream relationship document. Defines sibling relationship, bidirectional flow policy, 90-day rule, Phase 2 trigger reference, intentional divergences.
- `/Users/kih/workspaces/areas/opencode-nexus/docs/deferred-from-claude-nexus.md` — deferred items from claude-nexus. D8 (missing tags), D9 (resume_tier scheme), D10 (nx_history_search). These are runtime-scope items deferred from Phase 1.
- `/Users/kih/workspaces/areas/opencode-nexus/docs/prompt-parity-plan.md` — TO BE DELETED as part of Issue #3 cleanup. Contains stale references: `agents/qa.md` (never existed), `skills/nx-meet/SKILL.md` (renamed to nx-plan). Will be replaced by nexus-core-based workflow.
- `/Users/kih/workspaces/areas/opencode-nexus/docs/bridge/nexus-core-bootstrap.md` — this document. The single bridge artifact produced by plan session #16.

**Configuration files:**
- `/Users/kih/workspaces/areas/opencode-nexus/package.json` — version `0.1.0`, `private: false`, `type: "module"`, build script `tsc -p tsconfig.json`, devDependencies: `@opencode-ai/plugin`, `@types/node`, `typescript`. Will be updated in Phase 1 to add `generate:prompts` script and `@moreih29/nexus-core` devDependency.
- `/Users/kih/workspaces/areas/opencode-nexus/tsconfig.json` — TypeScript configuration
- `/Users/kih/workspaces/areas/opencode-nexus/opencode.json` — OpenCode plugin configuration

---

*End of nexus-core bootstrap document. All 14 sections (§0–§13) are present. Word count target: 12,000–18,000 words.*
