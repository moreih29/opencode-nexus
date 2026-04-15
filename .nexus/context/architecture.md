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

에이전트 메타데이터와 primary 에이전트 정의.

- `generated/index.ts`: `AGENT_META` — single source of truth. 9개 에이전트(`architect`, `designer`, `postdoc`, `strategist`, `engineer`, `researcher`, `writer`, `tester`, `reviewer`) 각각의 `id`, `name`, `category`(`how`/`do`/`check`), `description`, `model`, `disallowedTools`, `task`, `alias_ko`, `resume_tier`를 포함. (`src/agents/generated/index.ts:27` 참조)
  - HOW(architect, designer, postdoc, strategist): 분석·설계 역할. 파일 편집 도구 전체 차단.
  - DO(engineer, researcher, writer): 실행 역할. `nx_task_add` 차단.
  - CHECK(tester, reviewer): 검증 역할. `nx_task_add` 차단.
- `primary.ts`: Lead 에이전트의 ID, 설명, 프롬프트 정의.
- `prompts.ts`: 역할별 프롬프트 re-export barrel (`src/agents/generated/index.ts`로 연결).

### orchestration

서브에이전트 호출의 생애주기와 연속성(continuity) 관리.

- `core.ts`: (Deprecated) Task 1 이후 기능이 `agent-tracker.ts`로 이전되었으며 해당 파일은 제거 예정이다.
- `run-continuity-adapter.ts`: `task` 도구 호출 전 연속성 힌트 주입.
- `plan-continuity-adapter.ts`: Plan 세션의 참여자별 연속성 관리.
- `team-policy.ts`: run 모드에서 team_name 정책 판단 (Task 1 이후 선택적). Meet 참여 허용 여부 등을 결정한다.
- `delegation.ts`: 서브에이전트 위임 페이로드 생성.

### pipeline

파일 편집 작업 전 태스크 사이클 상태를 평가하는 가드 레이어.

- `evaluator.ts`: `PipelineSnapshot` → `PipelineEvaluation` 반환. 핵심 판단: `editsAllowed`, `canCloseCycle`, `shouldTriggerQa`, `nextGuidanceKey`.
- `qa-trigger.ts`: Tester 자동 트리거 조건 평가.

### plugin

훅 구현체와 시스템 프롬프트 빌더.

- `hooks.ts`: 6개 훅 — `event`(세션 초기화), `tool.execute.before`(가드레일), `tool.execute.after`(완료 처리), `chat.message`(프롬프트 저장), `command.execute.before`(종료 경고), `experimental.chat.system.transform`(모드 감지·시스템 프롬프트 주입). 
  - `tool.execute.before`: 편집류 도구(edit-like tools)에 대해 **태스크 사이클 상태에 따른 차등 가드레일**을 적용한다. `idle` 모드(태스크 없음) 또는 `free` 편집 모드에서는 차단하지 않으며, `completed-open` 상태에서만 보호(block/warning)가 작동한다.
  - `tool.execute.after`: 도구 실행 완료 후 **미완료 소유자 태스크 경고**를 추가한다. 실행된 도구의 소유자(owner)와 일치하는 태스크가 `pending` 또는 `in_progress` 상태로 남아 있으면, 해당 태스크 목록을 경고 메시지에 포함시킨다.
  - `command.execute.before`: 종료 명령 시 **차등 종료 집행**을 수행한다. 활성 태스크 사이클(`active`)에서는 하드 블록, 완료-대기 상태(`completed-open`)에서는 원샷 소프트 블록/경고를 표시한다.
  - `experimental.chat.system.transform`: Option D B-leg 역할을 담당하며, 현재 모드와 태스크 사이클 상태를 기반으로 **동적 상태 알림(buildStatefulNotice)**을 생성하여 시스템 프롬프트에 주입한다. `[plan]`/`[run]`/`[sync]` 태그 감지 시 해당 모드의 `SKILL_PROMPTS[mode]` 본문을 `<nexus-skill id="...">` 블록으로 삽입하고, 모든 태스크 완료 시(Step 7) 태스크 생성 핸드오프 메시지를 포함한다. `manual_only` 스킬은 B-leg 주입 대상에서 제외되며, 모든 모드에서 수동 실행 안내(manual_only nudge)가 별도로 포함된다. plan 모드에서는 결정 요청 전 pros/cons/trade-offs 비교 표와 권고안 제시가 필요하다.
- `system-prompt.ts`: `buildNexusSystemPrompt()`가 현재 모드, 에이전트 목록, 스킬 목록을 조합하여 `<nexus>` 블록 형태 시스템 프롬프트 생성.

### shared

모듈 간 공통 유틸리티.

- `paths.ts`: `.nexus/` 하위 모든 파일 경로를 `createNexusPaths(projectRoot)`로 집중 관리.
- `state.ts`: `.nexus/` 디렉터리 초기화(비파괴), 태스크 요약.
- `audit-log.ts`: 세션별·서브에이전트별·글로벌 감사 로그 기록. `tool-log.jsonl`의 `files_touched`는 세션 스코프에서 추적되며, 자식 세션 연속성이 확정된 후 소급 적용(retroactive attribution)된다.
- `agent-tracker.ts`: 세션 범위의 runtime continuity/observability 상태 추적 (`agent-tracker.json`). 위임 추적은 `createDelegationTrackerRegistrar(filePath)` 팩토리로 생성된 registrar 객체를 통해 관리되며, hooks와 orchestration 모두에서 이 추상화를 사용한다. **Reset 경계는 primary session lifecycle 훅(`session.created`)으로 단일화되어 있으며**, ensure/setup/init/sync 경로에서는 tracker를 초기화하지 않는다.
- `plan-sidecar.ts`: Plan 세션의 OpenCode 사이드카 동기화.
- `tag-parser.ts`: 프롬프트에서 `[plan]`, `[run]`, `[d]`, `[rule]` 태그 감지.
- `schema.ts`, `json-store.ts`, `markdown.ts`, `history.ts`: 공통 타입, JSON 스토어, 마크다운, 히스토리 관리.

### skills

- `generated/index.ts`: `SKILL_META` — single source of truth. 5개 스킬(`nx-plan`, `nx-run`, `nx-init`, `nx-sync`, `nx-setup`) 각각의 `id`, `name`, `description`, `trigger_display`, `purpose` 5필드를 포함. (`src/skills/generated/index.ts:19` 참조)
- `prompts.ts`: 스킬별 상세 프롬프트 re-export barrel (`src/skills/generated/index.ts`로 연결).

### tools

모든 `nx_*` 도구 구현체.

| 도구 그룹 | 파일 | 역할 |
|-----------|------|------|
| Plan 관리 | `plan.ts` | nx_plan_start, status, resume, followup, update, decide |
| 태스크·히스토리 | `task.ts` | nx_task_add, list, update, close, nx_history_search |
| 워크플로우 | `workflow.ts` | nx_init, nx_sync (ensureNexusStructure + 안내 메시지. ensure/setup/init/sync는 tracker 비파괴. LLM이 [sync] 시 git diff → Writer agent spawn → .nexus/context/ 직접 update) |
| 컨텍스트 | `context.ts` | nx_context |
| 아티팩트 | `artifact.ts` | nx_artifact_write |
| LSP | `lsp.ts` | nx_lsp_* (심볼, hover, 정의, 진단, 참조, 리네임, 코드액션) |
| AST | `ast.ts` | nx_ast_search, nx_ast_replace |
| 설정 | `setup.ts` | nx_setup |

## nexus-core Consumption (Phase 1 adoption — 2026-04-11 완료)

opencode-nexus는 Nexus 생태계의 Authoring layer(`@moreih29/nexus-core`)를 **빌드 타임 read-only consumer**로 소비한다. Phase 1 adoption은 `phase1-nexus-core-adoption` feature branch에서 4-commit bisectable sequence(`a9cb773` → `4df4451` → `ff813e6` → `ee52ed5`)로 완료되었다.

### Option D — 스킬 이중 delivery (A-leg + B-leg)

nexus-core에서 생성된 스킬 본문(`SKILL_PROMPTS`)은 두 경로로 LLM에 도달한다. **A-leg**: `installSkillFiles()`가 플러그인 초기화 시 `templates/skills/<id>/SKILL.md`를 사용자 프로젝트 `.opencode/skills/<id>/SKILL.md`로 복사한다. OpenCode 런타임이 이 파일을 네이티브 skill 디스커버리 경로로 인식하여 필요 시 로드한다. **B-leg**: `experimental.chat.system.transform` 훅이 `[plan]`/`[run]`/`[sync]` 태그를 감지하면 해당 `SKILL_PROMPTS[mode]` 본문을 `<nexus-skill id="...">` 블록으로 시스템 프롬프트에 직접 삽입한다. 양 경로가 전달하는 스킬 canonical body는 동일하며(`@moreih29/nexus-core` 단일 소스), delivery mechanism만 다르다. 배포 경로 및 플러그인 내부 리소스 패턴 상세는 `.nexus/memory/opencode-reference.md` §5.1, §5.1a, §9.5 참조.

### 구조

- **Dependency**: `@moreih29/nexus-core ^0.4.0` (devDependency 전용 — 최종 사용자 환경에 미설치)
- **Generator**: `scripts/generate-from-nexus-core.{mjs,lib.mjs}` (claude-nexus 포팅, opencode 차이점 수정). 빌드 타임에 `node_modules/@moreih29/nexus-core`를 읽어 `src/agents/prompts.generated.ts`와 `src/skills/prompts.generated.ts`를 생성
- **Barrel re-export**: `src/agents/prompts.ts`와 `src/skills/prompts.ts`는 thin re-export barrel. 기존 import site 회귀 없이 generated에 연결
- **Catalog**: `AGENT_META`(`src/agents/generated/index.ts`)와 `SKILL_META`(`src/skills/generated/index.ts`)가 각각의 single source of truth. 별도 catalog 파일 없음. `disallowedTools`는 generated 상수에 inline literal로 포함되며, 별도 교차 검증 함수 없음.

### Capability resolution

`scripts/generate-from-nexus-core.lib.mjs`의 `indexCapabilities`가 nexus-core `vocabulary/capabilities.yml`의 X3 schema(`blocks_semantic_classes`)를 consumer-local `capability-map.yml`의 `semantic_class_map`을 통해 opencode 구체 tool 이름으로 해석한다. `deriveDisallowedTools`가 각 agent capability(`no_file_edit`, `no_task_create`, `no_task_update`, `no_shell_exec`)를 tool 배열로 변환하여 `AGENT_META.disallowedTools`에 literal로 inline. `isEditLikeTool`(hooks.ts)은 generated 상수 `NO_FILE_EDIT_TOOLS`를 참조하여 single source of truth 유지. `e2e-capability-coverage.mjs`가 CI에서 capability-map 전체 커버리지를 검증한다.

### Tag id drift 보호

`src/shared/tag-parser.ts`의 `HANDLED_TAG_IDS = ['plan', 'run', 'sync', 'd', 'm', 'm-gc', 'rule'] as const` 정적 상수는 빌드 타임에 `verifyTagDrift`가 `nexus-core/vocabulary/tags.yml`과 교차 검증. drift 시 hard-fail. claude-nexus와 동일 패턴 (04-OPEN_QUESTIONS Q5 해소 참조).

### Runtime 공유 배제 (§9.2)

`dist/index.js`는 `@moreih29/nexus-core`를 런타임에 참조하지 않는다. `scripts/e2e-loader-smoke.mjs`가 컴파일된 번들에서 `@moreih29/nexus-core` 문자열이 주석 외 위치에 등장하지 않음을 검증하여 devDependency contract(§8.3)을 보증한다.

### `.nexus/` 구조

사람이 직접 작성/관리하는 영역은 claude-nexus 표준과 동일한 flat 구조를 따른다 (2026-04-12 refactor):

- `.nexus/context/` — 정적 설계 문서 (이 파일 포함, principles, orchestration, tools, build-and-release)
- `.nexus/memory/` — lessons learned, references, anti-patterns, follow-up
- `.nexus/rules/` — 강제 컨벤션
- `.nexus/state/` — runtime 데이터 (사람이 직접 작성/관리하는 영역. 자동 생성물 cache는 plan #23에서 폐지). nexus-core `rule:harness-state-namespace`에 따라 opencode-nexus 고유 파일(`agent-tracker.json`, `tool-log.jsonl`)은 `.nexus/state/opencode-nexus/` 네임스페이스 디렉토리로 격리된다. `agent-tracker.json`은 durable history가 아닌 세션 범위 ephemeral continuity/observability state이며 reset 경계는 `session.created` 훅이다. HOW 패널 연속성은 canonical `plan.json` + namespaced `agent-tracker.json` 조합에서 파생된다.

**참고**: Task 1 이후 `orchestration.json`과 `audit/` 디렉토리는 더 이상 활성 런타임 표면이 아니다. 관련 스키마 파일(`orchestration.schema.json`, `audit-log.schema.json`)은 legacy reference로 남아있을 수 있다.

### plan.json / tasks.json 스키마

두 파일은 claude-nexus 표준과 대칭이다 (`src/shared/schema.ts` 참조).

**PlanFile**: `id`, `topic`, `issues`, `research_summary?`, `created_at`. legacy 필드(`attendees`, `discussion`, `task_refs`)는 read 시 graceful parsing 후 신규 write에서 제외된다.

**PlanIssue**: `id`, `title`, `status`(`pending`|`decided`), `decision?`, `how_agents?`, `how_summary?`, `how_agent_ids?`. legacy 상태(`tasked`)는 read 시 `decided`로 자동 변환된다.

**TaskItem**: `id`, `title`, `status`(`pending`|`in_progress`|`completed`|`blocked`), `owner?`, `owner_agent_id?`, `owner_reuse_policy?`, `plan_issue?`, `deps?`, 기타 context 필드. `updated_at`은 legacy로 read 시 수용하되 신규 write에서 제외된다.


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

> **`createConfigHook` 세 가지 책임 (Option D A-leg):**
> 1. 서브에이전트 등록 시 `prompt: AGENT_PROMPTS[id]`를 각 에이전트의 설정 객체에 주입한다.
> 2. 플러그인 초기화 시 `installSkillFiles(ctx.directory, logger)`를 호출하여 `templates/skills/` 내 스킬 파일을 사용자 프로젝트의 `.opencode/skills/`로 설치한다(멱등 연산, 기존 파일은 `.bak` 백업).
> 3. 카탈로그 에이전트를 subagent로 등록하고 disallowedTools 정책을 OpenCode 설정 형식으로 변환한다.

**세션 생성 이후:**

1. `event` 훅이 `.nexus/` 하위 구조 초기화
2. `chat.message` 훅이 세션별 마지막 프롬프트 저장
3. `system.transform` 훅이 Nexus 태그를 감지해 모드 결정 → 시스템 프롬프트 주입
4. `tool.execute.before` 훅이 편집 도구에 파이프라인 가드레일 적용
5. 서브에이전트 호출 시 before/after 훅이 오케스트레이션 코어에 등록·연속성 갱신
