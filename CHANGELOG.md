# Changelog

## [0.10.0] — 2026-04-20

### BREAKING CHANGE — nexus-core 0.15.1 shared runtime substrate 전면 수용

opencode-nexus는 자체 Nexus 오케스트레이션 런타임에서 @moreih29/nexus-core 0.15.1+ shared runtime substrate 래퍼로 재정의됐다.

### Consumer Action Required

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
     "agents": [
       { "id": "lead", "module": "./node_modules/opencode-nexus/src/agents/lead.ts" },
       { "id": "architect", "module": "./node_modules/opencode-nexus/src/agents/architect.ts" },
       { "id": "designer", "module": "./node_modules/opencode-nexus/src/agents/designer.ts" },
       { "id": "engineer", "module": "./node_modules/opencode-nexus/src/agents/engineer.ts" },
       { "id": "postdoc", "module": "./node_modules/opencode-nexus/src/agents/postdoc.ts" },
       { "id": "strategist", "module": "./node_modules/opencode-nexus/src/agents/strategist.ts" },
       { "id": "researcher", "module": "./node_modules/opencode-nexus/src/agents/researcher.ts" },
       { "id": "reviewer", "module": "./node_modules/opencode-nexus/src/agents/reviewer.ts" },
       { "id": "tester", "module": "./node_modules/opencode-nexus/src/agents/tester.ts" },
       { "id": "writer", "module": "./node_modules/opencode-nexus/src/agents/writer.ts" }
     ]
   }
   ```
   - **MCP 키는 `mcp` (not `mcp_servers`)** — opencode config validator 요구사항
   - **`agents` 배열은 필수** — `plugin` 등록만으로는 에이전트 자동 활성화 안 됨. `node_modules/opencode-nexus/opencode.json.fragment`가 참조 가능
   - 이전 isolated config (`.opencode/nexus/config.json`)는 제거됨 — agent별 model override는 각 agent 항목의 `model` 필드로 직접 지정

3. **Node 런타임 업그레이드**: Node.js >= 22 필요 (`import ... with { type: "json" }` 구문 요구). 이전에 Node 20을 사용 중이면 업그레이드 필수.

4. **기존 `.opencode/skills/` 커스터마이즈 백업**: postinstall이 nx-init/plan/run/sync를 생성하지만 **기존 파일 존재 시 보존**. 안전을 위해 커스터마이즈 분은 별도 백업 권장. deploy skill은 opencode-nexus 고유이며 postinstall 대상 아님.

5. **CLI 명령어 제거**: 이전 버전의 `opencode-nexus setup / migrate / install / update` 명령어는 제거됨. 신규 설치는 opencode.json plugin 배열 + bun trust로 완료.

6. **AGENTS.md 자동 sync 중단**: 프로젝트의 AGENTS.md `<!-- NEXUS:START/END -->` 블록 자동 sync 기능 제거. 수동 관리 또는 삭제.

7. **Plan/run session의 task_id auto-wiring 제거**: HOW 에이전트 resume 시 LLM이 prior task 출력에서 task_id를 수동으로 참조해야 함. opencode-nexus 고유 auto-injection 로직이 canonical nexus-core skill flow로 대체.

### Removed Features

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

### Added

- `scripts/postinstall.mjs`: consumer `.opencode/skills/`로 nx-init/plan/run/sync 4 skill 자동 복사
- `scripts/e2e-nexus-integration.mjs`: MCP handshake, mountHooks, sync idempotency, plugin load 회귀 검증
- `src/plugin.ts`: mountHooks 엔트리 (sync-managed template)

### Changed

- Version: 0.9.1 → 0.10.0 (minor bump, pre-v1 convention)
- dependencies 승격: @moreih29/nexus-core devDep → dep (^0.15.1)
- engines.node: >=20 → >=22
- main: dist/index.js → src/plugin.ts (TypeScript 직접 로드)
- bin 필드 제거 (CLI 전면 삭제)
- Primary agent: `nexus` identity → nexus-core canonical `lead` (mode: primary)

### Upstream

nexus-core v0.13.0 ~ v0.15.1 adoption 경로에서 발견된 upstream 이슈들이 모두 resolved:
- nexus-core#26 hook-manifest export (resolved v0.14.0)
- nexus-core#28 dist ROOT resolution (resolved v0.14.1)
- nexus-core#30 sync subdir prepend (resolved v0.15.0)
- nexus-core#32 distribution I/O contract RFC (resolved v0.15.0 + harness-io.md §4-2)
- nexus-core#36 fresh-install 2 bugs (resolved v0.15.1)
- nexus-core#37 distribution-invariant CI gate meta (resolved v0.15.1)

### Phase Model

Phase 1 (빌드 타임 prompt consumer) → Phase 2 (runtime substrate consumer). 상세: UPSTREAM.md §"v0.15.1 Upgrade + Phase 2 Transition".

---

## Historical Versions

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
