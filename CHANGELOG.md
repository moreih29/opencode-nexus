# 변경 이력

`opencode-nexus`의 주요 변경 사항은 이 파일에 기록한다.

## [0.13.0] — 2026-04-22

### 추가됨

- **Interactive install flow** 추가 — `opencode-nexus install`이 scope 선택부터 시작하고, 필요하면 바로 agent model 설정으로 이어진다.
- **Ink 기반 models wizard** 추가 — `lead`, OpenCode built-in (`general`, `explore`), Nexus subagent 전체를 지원한다.
- **스크립트용 direct model override** 지원 추가: `opencode-nexus models --agents=... --model=provider/model`
- **GitHub Actions 워크플로우** 추가:
  - `validate.yml`: `bun run check`, `bun run test:e2e`, `npm pack --dry-run`
  - `publish-npm.yml`: Trusted Publishing 기반 npm 배포
- **릴리즈 운영 문서** 추가: `.nexus/context/releasing.md`

### 변경됨

- **현재 기준 OpenCode wrapper**로 패키지를 재구성했다 (`@moreih29/nexus-core 0.18.2`).
- install은 이제 **현재 실행 중인 CLI 버전만** `opencode.json`에 pin한다. 더 이상 cross-version pinning을 허용하지 않는다.
- install 기본값을 **Nexus 기준으로 정규화**했다:
  - `default_agent: "lead"`
  - `agent.build.disable: true`
  - `agent.plan.disable: true`
- 번들되는 skill 구성을 현재 nexus-core OpenCode 출력에 맞췄다: `nx-auto-plan`, `nx-plan`, `nx-run`
- runtime agent registration은 사용자 config가 아니라 plugin layer에서 주입하도록 바꿨다.
- README를 Node 기반 CLI 실행, Bun 설치 지원 기준으로 다시 정리했다.

### 제거됨

- CLI에서 **cross-version install flow** 제거. install 중에 다른 버전 패키지를 fetch/unpack하지 않는다.
- 현재 nexus-core 계약에 포함되지 않는 구형 skill set 및 wrapper 전용 legacy install 가정 제거.

### 브레이킹 변경 (pre-v1 minor)

- **신규 설치/업그레이드가 현재 wrapper 계약을 기준으로 동작**한다. `0.13.0`으로 올린 뒤에는 다음을 반영하려고 `opencode-nexus install`을 다시 실행해야 한다.
  - pinned plugin entry
  - Nexus 기본 agent 설정
  - 복사되는 skill 파일
- **배포되는 skill 구성이 바뀌었다**. 현재 OpenCode/nexus-core 출력인 `nx-auto-plan`, `nx-plan`, `nx-run`을 기준으로 동작하므로, 이전 bundled skill을 기대하던 문서나 흐름은 갱신해야 한다.
- install은 더 이상 **임의의 target package version**을 고르지 않는다. 다른 버전을 설치하려면 먼저 그 버전의 CLI를 설치한 뒤 `opencode-nexus install`을 다시 실행해야 한다.

### 검증

- `bun run check` PASS
- `bun run test:e2e` PASS
- `npm pack --dry-run` PASS

---

## [0.12.0] — 2026-04-20

### 변경됨

- **Adopted `@moreih29/nexus-core ^0.16.2`** — 3-harness consumer plugin I/O contract realignment, OpenCode fragment 제거, smoke-consumer gate. Canonical OpenCode contract: `harness-io.md §4-2` (sync outputs = `package.json`/`src/plugin.ts` Template + `src/index.ts`/`src/agents/*.ts`/`.opencode/skills/*` Managed; `plugin: ["<name>"]` auto-register; `agents` array in consumer config is invalid).
- `@opencode-ai/plugin` bumped to `1.4.9`.
- `.nexus/memory/anti-patterns.md` §9.2 / §9.5 re-contextualized — `opencode.json.fragment`을 v0.15.x 이전의 legacy 로 명시, 원칙(fragment-as-install-SSOT 금지) 유지.
- `.nexus/context/architecture.md` + `build-and-release.md` — v0.16 adoption + v0.12.0 타겟 반영.

### 추가됨

- e2e `scripts/e2e-nexus-integration.mjs` blocks:
  - **E. hook manifest resolves** — manifest JSON load + `handlerPath` existsSync for every entry (prompt-router 포함).
  - **F. prompt-router self-contained load** — dynamic `import()` sanity of the packaged prompt-router handler.
  - **C block** fragment-absence assertion — `sync --dry-run` stdout must not mention `opencode.json.fragment`.
- `.nexus/memory/upstream-docs-drift.md` — record of observed upstream nexus-core docs drift (SSOT vs tutorial/template), kept for future upstream follow-up outside this cycle.

### 제거됨

- **`opencode.json.fragment`** — no longer produced by `nexus-core` v0.16.0+ `sync`. Stale tracked file removed from the repo, `.gitignore` updated to prevent accidental re-introduction.
- **`.opencode/plugins/opencode-nexus.js`** — legacy shim that re-exported a stale `dist/index.js`. Not referenced by OpenCode loader (canonical registration is `plugin: ["opencode-nexus"]` → `package.json exports` → `./src/plugin.ts`), not in `files` whitelist, confirmed removable.

### 업스트림

- nexus-core v0.15.2 `fix(hooks)` — `dist/hooks/*.js` CLI bootstrap 주입.
- nexus-core v0.16.0 `feat(contract)` — 3-harness consumer plugin I/O 계약 재정렬 + OpenCode fragment 제거 + smoke gate (#45).
- nexus-core v0.16.1 `fix(hooks)` — prompt-router 번들 self-contained화 + smoke-consumer gate (#46, #47).
- nexus-core v0.16.2 `fix(codex)` — Codex `disabled_tools`를 `[mcp_servers.nx]` 블록으로 이동 (#48, #49); OpenCode harness 에는 영향 없음.
- Tier A bootstrap audit: subpath exports 3/3 PASS, manifest handlerPath resolve 4/4 PASS (`session-init`, `prompt-router`, `agent-finalize`, `agent-bootstrap`), `src/plugin.ts` tsc PASS.
- Tier B SSOT diff review: sync output fully aligned with `docs/contract/harness-io.md §4-2` (v0.16.2).

### 검증

- `bun run check` PASS (sync:dry + `tsc --noEmit`).
- `bun run test:e2e` PASS (blocks A–F).
- `bun run test:cli` PASS (B1–B15, 15/15).

### 참고

- Plan #59 (`opencode-nexus: adopt nexus-core v0.16.x`) — 4 decisions (caret bump + v0.12.0 target; B-tier diff verification; Tier A + targeted Tier B audit; e2e manifest/prompt-router/fragment-absence assertions).

---

## [0.11.0] — 2026-04-20

### 추가됨

- **`opencode-nexus` CLI binary** — canonical installer/mutator for OpenCode config and skills:
  - `install [--scope=user|project|both] [--yes] [--dry-run] [--force] [--skills=...] [--normalize]`
  - `uninstall [--scope=user|project|both] [--yes] [--purge]`
  - `doctor [--scope=user|project|both] [--json] [--fix]`
- **Scope model**: `user` (~/.config/opencode), `project` (./opencode.json), `both` (ownership split — user owns plugin+mcp, project owns default_agent+skills)
- **Intelligent merge engine** (lib/config-merge.mjs):
  - Path-scoped patching — only managed keys (`plugin`, `mcp.nx`, `default_agent`, `$schema`) touched; consumer-owned fields (`agent`, `instructions`, `permission`, other `mcp.*`, other `plugin` entries) preserved
  - Preserve-first plugin handling — bare/pinned duplicates warned, auto-collapse only with `--normalize`
  - Patch-empty ⇒ no-op (no backup, no write)
  - Sibling timestamped backups (`.backup-YYYYMMDD-HHMMSS`), keep last 5
  - Atomic temp+rename writes
  - JSON strict only, JSONC detection with fail-safe error (no silent comment stripping)
  - Formatting preserve (indent 2/4 detection, trailing newline)
- **Doctor diagnostics** (lib/doctor.mjs):
  - State classification: fresh / complete / partial_config / partial_skills / orphan_* / jsonc_error
  - Per-scope checks: plugin entry, mcp.nx canonical, default_agent, skills installed, modified detection, backup accumulation, agent.lead declaration advisory
  - `--fix`: non-destructive normalize (plugin dedup collapse, empty container cleanup)
  - `--json`: machine-readable output
- **Skills management** (lib/skills-copy.mjs):
  - Preserve-first install (existing files skipped, `--force` to overwrite)
  - `--purge` opt-in on uninstall (default: preserve)
  - SKILLS_TO_COPY whitelist ensures user-authored skills never deleted
- **E2E regression suite** (scripts/e2e-cli.mjs): 15 blocks covering install/uninstall/doctor × scope × edge cases (preserve-first, duplicate plugin, dry-run, backup rotation, atomic write, JSONC, postinstall silence)
- `bin` field in package.json
- `test:cli` script

### 변경됨

- **postinstall role minimized** — no filesystem mutation. Prints hint message pointing to `bunx opencode-nexus install`. Self-install guard preserved.
- **README restructured** — CLI-first Quick Install as primary path; scope ownership table; package-manager matrix (bun/npm/pnpm/yarn)
- **Bun trust reframed** — no longer a prerequisite for setup; CLI works without trust. trust only affects whether postinstall hint runs.
- **nx-setup role redefined** — CLI handles bootstrap (mechanical install); nx-setup remains as post-install configuration wizard (cognitive refinement)

### 제거됨

- **`opencode.json.fragment` dependency** — CLI does not read the fragment; install spec is wrapper-local hardcoded (future migration to nexus-core official export when available). Aligns with upstream nexus-core#43 (fragment deprecate discussion).
- Previous postinstall-driven skills copy flow (superseded by CLI)

### BREAKING (v0.11.0, pre-1.0 minor)

Pre-1.0 semver permits breaking changes in minor bumps, but consumers should be aware:

- **Postinstall no longer copies skills automatically** — even with Bun `pm trust`. Run `bunx opencode-nexus install --scope=project` after package install.
- **Manual opencode.json edit no longer needed** — CLI handles it. If you previously edited manually, existing keys are preserved; re-run `install` to add any missing Nexus-managed keys.
- **CLI is the canonical mutator** — direct file edits or scripted patches should be replaced with `install` / `uninstall` to maintain idempotency and backup guarantees.

At the time of `0.11.0`, a separate migration guide was provided for common upgrade scenarios.

### 업스트림

- nexus-core#43 (opencode.json.fragment deprecate) — CLI design intentionally fragment-independent to support Option A.

---

## [0.10.1] — 2026-04-20

### 수정됨

- **Published OpenCode consumer config example was invalid** — v0.10.0 문서에 포함된 `agents` 배열 + `module` 필드 예시는 opencode canonical schema에 존재하지 않는 키를 사용해 consumer가 그대로 복사 시 `Unrecognized key: "agents"` 오류로 opencode 기동이 실패했습니다.
- **Canonical minimal config로 교체**:
  ```json
  {
    "plugin": ["opencode-nexus"],
    "mcp": { "nx": { "type": "local", "command": ["nexus-mcp"] } },
    "default_agent": "lead"
  }
  ```
- `plugin: ["opencode-nexus"]` 등록만으로 10 agents가 자동 등록되므로 `agent` 섹션/배열은 불필요합니다(override 용도만).
- `opencode.json.fragment` 참조 언급 제거 (upstream nexus-core#43에서 deprecate 검토 중).

### 참고

- v0.10.0은 기능적으로 동일하지만 문서 예시가 invalid했으므로 **v0.10.1 적용을 강력히 권장**합니다.
- v0.11.0에서 CLI (install/uninstall/doctor)로 이 설정을 자동화할 예정입니다.

---

## [0.10.0] — 2026-04-20

### BREAKING CHANGE — nexus-core 0.15.1 shared runtime substrate 전면 수용

opencode-nexus는 자체 Nexus 오케스트레이션 런타임에서 @moreih29/nexus-core 0.15.1+ shared runtime substrate 래퍼로 재정의됐다.

### 사용자 조치 필요

기존 v0.9.x 사용자는 다음 단계를 따라야 한다:

1. **Bun post-install 신뢰 설정** (Bun 1.3+):
   ```bash
   bun pm trust opencode-nexus
   ```
   이 설정 없이는 postinstall이 실행되지 않아 consumer `.opencode/skills/`가 생성되지 않습니다.

2. **opencode.json 구성 업데이트**:
   ```json
   {
     "plugin": ["opencode-nexus"],
     "mcp": {
       "nx": { "type": "local", "command": ["nexus-mcp"] }
     },
     "default_agent": "lead"
   }
   ```
   - **MCP 키는 `mcp` (not `mcp_servers`)** — opencode config validator 요구사항
   - **`plugin` 등록만으로 10 agents 자동 활성화** — `agent`/`agents` 섹션 불필요 (v0.10.0 초기 문서의 `agents` 배열 예시는 invalid였으며 v0.10.1에서 수정됨)
   - 이전 isolated config (`.opencode/nexus/config.json`)는 제거됨 — agent별 model override는 `agent.<name>.model`로 직접 지정

3. **Node 런타임 업그레이드**: Node.js >= 22 필요 (`import ... with { type: "json" }` 구문 요구). 이전에 Node 20을 사용 중이면 업그레이드 필수.

4. **기존 `.opencode/skills/` 커스터마이즈 백업**: postinstall이 nx-init/plan/run/sync를 생성하지만 **기존 파일 존재 시 보존**. 안전을 위해 커스터마이즈 분은 별도 백업 권장. deploy skill은 opencode-nexus 고유이며 postinstall 대상 아님.

5. **CLI 명령어 제거**: 이전 버전의 `opencode-nexus setup / migrate / install / update` 명령어는 제거됨. 신규 설치는 opencode.json plugin 배열 + bun trust로 완료.

6. **AGENTS.md 자동 sync 중단**: 프로젝트의 AGENTS.md `<!-- NEXUS:START/END -->` 블록 자동 sync 기능 제거. 수동 관리 또는 삭제.

7. **Plan/run session의 task_id auto-wiring 제거**: HOW 에이전트 resume 시 LLM이 prior task 출력에서 task_id를 수동으로 참조해야 함. opencode-nexus 고유 auto-injection 로직이 canonical nexus-core skill flow로 대체.

### 제거된 기능

**Category 1: Plugin hooks (12개)**
- exit guard (tool.execute.before/after based)
- team-policy injection
- knowledge-index injection
- plan/run continuity auto-injection
- AGENTS.md template sync
- mode-aware playbook text injection
- memory-access observation
- agent-tracker reset preservation
- tool-log edit-like scope limiting
- compaction snapshot
- task-after-owner warning
- edit gate scope enforcement

**Category 2: Tools (4개)**
- `nx_context` — use nexus-mcp instead
- `nx_ast_search/replace` — migrate to nexus-mcp
- `nx_lsp_document_symbols/workspace_symbols/goto_definition` — migrate to nexus-mcp
- `nx_init/nx_sync` workflow wrappers — use skill triggers instead

**Category 3: CLI/Setup (4개)**
- isolated config (`.opencode/nexus/config.json`)
- `opencode-nexus setup/migrate/install/update` CLI commands
- `installSkillFiles` backup/restore
- nx-setup skill

**Category 4: Agent/Orchestration (6개)**
- `src/agents/primary.ts` (nexus identity)
- `team-policy.ts`
- `delegation.ts`
- `run-continuity-adapter.ts`
- `plan-continuity-adapter.ts`
- `knowledge-index.ts`
- `plan-how-panel.ts`

### 추가됨

- `scripts/postinstall.mjs`: consumer `.opencode/skills/`로 nx-init/plan/run/sync 4 skill 자동 복사
- `scripts/e2e-nexus-integration.mjs`: MCP handshake, mountHooks, sync idempotency, plugin load 회귀 검증
- `src/plugin.ts`: mountHooks 엔트리 (sync-managed template)

### 변경됨

- Version: 0.9.1 → 0.10.0 (minor bump, pre-v1 convention)
- dependencies 승격: @moreih29/nexus-core devDep → dep (^0.15.1)
- engines.node: >=20 → >=22
- main: dist/index.js → src/plugin.ts (TypeScript 직접 로드)
- bin 필드 제거 (CLI 전면 삭제)
- Primary agent: `nexus` identity → nexus-core canonical `lead` (mode: primary)

### 업스트림

nexus-core v0.13.0 ~ v0.15.1 adoption 경로에서 발견된 upstream 이슈들이 모두 resolved:
- nexus-core#26 hook-manifest export (resolved v0.14.0)
- nexus-core#28 dist ROOT resolution (resolved v0.14.1)
- nexus-core#30 sync subdir prepend (resolved v0.15.0)
- nexus-core#32 distribution I/O contract RFC (resolved v0.15.0 + harness-io.md §4-2)
- nexus-core#36 fresh-install 2 bugs (resolved v0.15.1)
- nexus-core#37 distribution-invariant CI gate meta (resolved v0.15.1)

### 전환 단계

Phase 1 (빌드 타임 prompt consumer) → Phase 2 (runtime substrate consumer) 전환 시기였다.

---

## 이전 버전

### [0.9.1] — 2026-04-19
- Fix: @opencode-ai/plugin dependencies 승격 (devDep-only 선언 버그 수정)

### [0.9.0] — 2026-04-18
- Feature: isolated config 도입 (`.opencode/nexus/config.json`)
- Feature: CLI setup/migrate/install/update 명령어

### [0.8.0] — 2026-04-16
- Feature: AGENTS.md template sync
- Feature: plan/run continuity auto-injection

### [0.7.0] — 2026-04-15
- Feature: knowledge-index injection
- Feature: memory-access observation

### [0.6.0] — 2026-04-14
- Feature: team-policy injection
- Feature: agent-tracker reset preservation

### [0.5.0] — 2026-04-13
- nexus-core v0.5.0 adoption: runtime.json writer, agent-tracker.json 분해

### [0.4.0] — 2026-04-13
- nexus-core v0.4.0 adoption: harness-state-namespace 규칙 적용

### [0.3.0] — 2026-04-12
- nexus-core v0.2.0 upgrade: capability-map 도입

### [0.2.0] — 2026-04-11
- Phase 1 Big-Bang Cutover: nexus-core ^0.1.2 devDependency adoption

### [0.1.0] — 2026-04-10
- Initial release
