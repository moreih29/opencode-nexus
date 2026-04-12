<!-- tags: codebase, architecture, modules, data-flow -->
# opencode-nexus 아키텍처 개요

## 1. 전체 구조

`opencode-nexus`는 OpenCode의 Plugin 인터페이스를 구현한 npm 패키지다. claude-nexus와 sibling(자매) 관계로, 공유 Shared Prompt Library인 `@moreih29/nexus-core`를 consume하여 Nexus 오케스트레이션 워크플로우를 OpenCode 런타임에서 구현하며, 세 가지 기여 영역(도구, 설정, 훅)으로 OpenCode와 연동한다.

```
OpenCode 런타임
    │
    └── OpenCodeNexusPlugin (index.ts)
            ├── createPluginState()     → 인메모리 세션 상태
            ├── createHooks()           → 이벤트·도구·명령 훅
            ├── createTools()           → nx_* 도구 노출
            └── createConfigHook()     → 에이전트·권한 설정 주입
```

**데이터 흐름:**

- OpenCode가 세션 이벤트, 도구 실행, 채팅 메시지를 발생시킨다.
- 훅(hooks)이 이를 가로채어 오케스트레이션 상태를 갱신하고 감사 로그를 기록한다.
- 상태는 `.nexus/` 디렉터리(파일 기반)와 `NexusPluginState`(인메모리)로 이중 관리된다.
- 에이전트가 `nx_*` 도구를 호출하면 해당 도구가 파일 기반 상태를 읽고 쓴다.

## 2. 핵심 모듈 설명

### agents

에이전트 카탈로그와 primary 에이전트 정의.

- `catalog.ts`: `NexusAgentProfile` 배열. 각 에이전트는 `id`, `category`(`how`/`do`/`check`), `model`, `disallowedTools`를 가진다.
  - HOW(architect, designer, postdoc, strategist): 분석·설계 역할. 파일 편집 도구 전체 차단.
  - DO(engineer, researcher, writer): 실행 역할. `nx_task_add` 차단.
  - CHECK(qa, reviewer): 검증 역할. `nx_task_add` 차단.
- `primary.ts`: Lead 에이전트의 ID, 설명, 프롬프트 정의.
- `prompts.ts`: 역할별 프롬프트 보관.

### orchestration

서브에이전트 호출의 생애주기와 연속성(continuity) 관리.

- `core.ts` / `core-store.ts`: 호출 등록(`registerStart`/`registerEnd`), `.nexus/state/orchestration.opencode.json` 기반 상태 영속화.
- `run-continuity-adapter.ts`: `task` 도구 호출 전 연속성 힌트 주입.
- `plan-continuity-adapter.ts`: Plan 세션의 참여자별 연속성 관리.
- `team-policy.ts`: run 모드에서 team_name 필수 여부, Meet 참여 허용 여부 등 정책 판단.
- `delegation.ts`: 서브에이전트 위임 페이로드 생성.

### pipeline

파일 편집 작업 전 태스크 사이클 상태를 평가하는 가드 레이어.

- `evaluator.ts`: `PipelineSnapshot` → `PipelineEvaluation` 반환. 핵심 판단: `editsAllowed`, `canCloseCycle`, `shouldTriggerQa`, `nextGuidanceKey`.
- `qa-trigger.ts`: QA 자동 트리거 조건 평가.

### plugin

훅 구현체와 시스템 프롬프트 빌더.

- `hooks.ts`: 6개 훅 — `event`(세션 초기화), `tool.execute.before`(가드레일), `tool.execute.after`(완료 처리), `chat.message`(프롬프트 저장), `command.execute.before`(종료 경고), `experimental.chat.system.transform`(모드 감지·시스템 프롬프트 주입).
- `system-prompt.ts`: `buildNexusSystemPrompt()`가 현재 모드, 에이전트 목록, 스킬 목록을 조합하여 `<nexus>` 블록 형태 시스템 프롬프트 생성.

### shared

모듈 간 공통 유틸리티.

- `paths.ts`: `.nexus/` 하위 모든 파일 경로를 `createNexusPaths(projectRoot)`로 집중 관리.
- `state.ts`: `.nexus/` 디렉터리 초기화, 태스크 요약, 에이전트 트래커 리셋.
- `audit-log.ts`: 세션별·서브에이전트별·글로벌 감사 로그 기록.
- `agent-tracker.ts`: 현재 실행 중인 팀 상태 추적.
- `plan-sidecar.ts`: Plan 세션의 OpenCode 사이드카 동기화.
- `tag-parser.ts`: 프롬프트에서 `[plan]`, `[run]`, `[d]`, `[rule]` 태그 감지.
- `schema.ts`, `json-store.ts`, `markdown.ts`, `history.ts`: 공통 타입, JSON 스토어, 마크다운, 히스토리 관리.

### skills

- `catalog.ts`: `NexusSkillProfile` 배열. 각 스킬은 트리거 태그와 용도를 가진다(nx-plan, nx-run, nx-init, nx-sync, nx-setup).
- `prompts.ts`: 스킬별 상세 프롬프트 텍스트 보관.

### tools

모든 `nx_*` 도구 구현체.

| 도구 그룹 | 파일 | 역할 |
|-----------|------|------|
| Plan 관리 | `plan.ts` | nx_plan_start, status, resume, followup, discuss, decide, update, join |
| 태스크 관리 | `task.ts` | nx_task_add, list, update, close |
| 워크플로우 | `workflow.ts` | nx_init, nx_sync |
| 코어 스토어 | `core-store.ts` | nx_core_read, nx_core_write |
| 규칙 | `rules-store.ts` | nx_rules_read, nx_rules_write |
| 컨텍스트 | `context.ts`, `briefing.ts` | nx_context, nx_briefing |
| 위임 | `delegation.ts` | nx_delegate_template |
| 아티팩트 | `artifact.ts` | nx_artifact_write |
| LSP | `lsp.ts` | nx_lsp_* (심볼, hover, 정의, 진단, 참조, 리네임, 코드액션) |
| AST | `ast.ts` | nx_ast_search, nx_ast_replace |
| 설정 | `setup.ts` | nx_setup |

## nexus-core Consumption (Phase 1 adoption — 2026-04-11 완료)

opencode-nexus는 Nexus 생태계의 Authoring layer(`@moreih29/nexus-core`)를 **빌드 타임 read-only consumer**로 소비한다. Phase 1 adoption은 `phase1-nexus-core-adoption` feature branch에서 4-commit bisectable sequence(`a9cb773` → `4df4451` → `ff813e6` → `ee52ed5`)로 완료되었다.

### 구조

- **Dependency**: `@moreih29/nexus-core ^0.2.0` (devDependency 전용 — 최종 사용자 환경에 미설치)
- **Generator**: `scripts/generate-from-nexus-core.{mjs,lib.mjs}` (claude-nexus 포팅, opencode 차이점 수정). 빌드 타임에 `node_modules/@moreih29/nexus-core`를 읽어 `src/agents/prompts.generated.ts`와 `src/skills/prompts.generated.ts`를 생성
- **Barrel re-export**: `src/agents/prompts.ts`와 `src/skills/prompts.ts`는 thin re-export barrel. 기존 import site 회귀 없이 generated에 연결
- **Catalog**: `src/agents/catalog.ts`와 `src/skills/catalog.ts`는 as-is 유지 (§8.6 canonical). `NEXUS_AGENT_CATALOG.disallowedTools`는 `verifyCatalogConsistency`로 `AGENT_META.disallowedTools`와 교차 검증(postdoc은 Gap 1 workaround로 exempt, 참조: moreih29/nexus-core#3)

### Capability resolution

`scripts/generate-from-nexus-core.lib.mjs`의 `indexCapabilities`가 nexus-core `vocabulary/capabilities.yml`의 X3 schema(`blocks_semantic_classes`)를 consumer-local `capability-map.yml`의 `semantic_class_map`을 통해 opencode 구체 tool 이름으로 해석한다. `deriveDisallowedTools`가 각 agent capability(`no_file_edit`, `no_task_create`, `no_task_update`, `no_shell_exec`)를 tool 배열로 변환하여 `AGENT_META.disallowedTools`에 literal로 inline. `isEditLikeTool`(hooks.ts)은 generated 상수 `NO_FILE_EDIT_TOOLS`를 참조하여 single source of truth 유지. `e2e-capability-coverage.mjs`가 CI에서 capability-map 전체 커버리지를 검증한다.

### Tag id drift 보호

`src/shared/tag-parser.ts`의 `HANDLED_TAG_IDS = ['plan', 'run', 'sync', 'd', 'm', 'm-gc', 'rule'] as const` 정적 상수는 빌드 타임에 `verifyTagDrift`가 `nexus-core/vocabulary/tags.yml`과 교차 검증. drift 시 hard-fail. claude-nexus와 동일 패턴 (04-OPEN_QUESTIONS Q5 해소 참조).

### Runtime 공유 배제 (§9.2)

`dist/index.js`는 `@moreih29/nexus-core`를 런타임에 참조하지 않는다. `scripts/e2e-loader-smoke.mjs`가 컴파일된 번들에서 `@moreih29/nexus-core` 문자열이 주석 외 위치에 등장하지 않음을 검증하여 devDependency contract(§8.3)을 보증한다.

### `.nexus/` 구조 — 사람 문서 flat + 도구 자동 관리물 4-layer

사람이 직접 작성/관리하는 영역은 claude-nexus 표준과 동일한 flat 구조를 따른다 (2026-04-12 refactor):

- `.nexus/context/` — 정적 설계 문서 (이 파일 포함, principles, orchestration, tools, build-and-release)
- `.nexus/memory/` — lessons learned, references, anti-patterns, follow-up
- `.nexus/rules/` — 강제 컨벤션
- `.nexus/state/` — runtime 데이터 + audit log

`nx_init` / `nx_sync` / `nx_core_*` / `nx_briefing` 도구의 4-layer 인프라(`core/{identity,codebase,memory,reference}`)는 코드 차원에서 유지되며 도구 호출 시 `mkdir(recursive: true)`로 자동 재생성된다. 자동 생성물(`recent-cycle-summary.md`, `recent-changes.md`, `decision-log.md` 등)은 그 4-layer에 작성되며 사람 문서와 디렉토리 충돌이 없다. 향후 도구 redesign 시 4-layer를 flat에 합칠 수 있으나 별도 plan session으로 분리한다 (참조: `memory/phase1-followup.md`).

## 3. 플러그인 초기화 흐름

```
OpenCode 시작
    │
    ▼
OpenCodeNexusPlugin(ctx) 호출  [index.ts]
    │
    ├─1─ createPluginState()
    │       → NexusPluginState 인메모리 객체 생성
    │
    ├─2─ createHooks({ directory, worktree, state })
    │       → createNexusPaths(projectRoot)로 .nexus/ 경로 맵 생성
    │       → 6개 훅 객체 반환
    │
    ├─3─ ctx.client.app.log(...)
    │       → 초기화 완료 기록
    │
    └─4─ 플러그인 반환 객체 조립
            ├── tool: createTools() → 모든 nx_* 도구
            ├── config: createConfigHook()
            │     · primary 에이전트 등록
            │     · 카탈로그 에이전트를 subagent로 등록
            │     · disallowedTools → 도구 정책 변환
            │     · default_agent를 primary로 지정
            └── ...hooks (6개)
```

**세션 생성 이후:**

1. `event` 훅이 `.nexus/` 하위 구조 초기화
2. `chat.message` 훅이 세션별 마지막 프롬프트 저장
3. `system.transform` 훅이 Nexus 태그를 감지해 모드 결정 → 시스템 프롬프트 주입
4. `tool.execute.before` 훅이 편집 도구에 파이프라인 가드레일 적용
5. 서브에이전트 호출 시 before/after 훅이 오케스트레이션 코어에 등록·연속성 갱신
