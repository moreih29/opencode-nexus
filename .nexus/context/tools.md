<!-- tags: codebase, tools, runtime, dependencies -->
# 도구 및 런타임

## 런타임 환경

- **패키지 매니저**: Bun 1.3.9
- **언어**: TypeScript 5.6
- **모듈 형식**: ESM (`"type": "module"`)
- **빌드 출력**: `tsc -p tsconfig.json` → `dist/index.js`
- **런타임 의존성**: `@ast-grep/napi ^0.42.0` (AST 검색/치환), `zod ^3.23.8` (스키마 검증)
- **개발 의존성**: `@moreih29/nexus-core ^0.12.0` (에이전트/스킬 canonical source), `@opencode-ai/plugin` (tool 팩토리, 컨텍스트 타입), `@types/node ^22.10.1`, `typescript ^5.6.3`, `yaml ^2.7.0`
- **배포**: npm 공개 패키지 (`opencode-nexus`), `dist/`와 `templates/`만 포함

플러그인은 `@opencode-ai/plugin`의 `tool()` 팩토리로 각 도구를 정의하며, OpenCode가 런타임에 MCP 서버로 노출한다. 모든 도구는 `context.worktree ?? context.directory`를 기준 경로로 사용한다.

## nx_* 도구 목록

### 워크플로 (Workflow)

| 도구 | 역할 |
|------|------|
| `nx_plan_start` | Plan 세션 시작. 주제, research_summary, 이슈 목록 초기화 |
| `nx_plan_status` | 현재 Plan 상태 조회 |
| `nx_plan_resume` | HOW 역할 참여자의 재개 라우팅 정보 조회 |
| `nx_plan_followup` | 참여자에 대한 위임 준비 팔로업 안내 생성 |
| `nx_plan_update` | Plan 이슈 추가·제거·수정·재오픈 |
| `nx_plan_decide` | Plan 이슈에 결정 사항 기록. 결정 요청 전 pros/cons/trade-offs 비교 표와 권고안 제시 필요 |
| `nx_task_add` | 태스크 사이클에 태스크 추가. **모든 태스크 완료 시(Step 7) 자동 핸드오프 메시지가 시스템 프롬프트에 주입됨** |
| `nx_task_list` | 태스크 목록 및 상태 요약 조회 |
| `nx_task_update` | 태스크 상태 변경. 실행 후 소유자(owner)와 일치하는 미완료 태스크가 있으면 경고 메시지 추가 |
| `nx_task_close` | 태스크 사이클 종료 및 히스토리 아카이브. Nexus-lead 전용 — 서브에이전트는 호출할 수 없음. 완료-대기 상태(`completed-open`)에서만 호출 가능 |
| `nx_history_search` | 과거 plan·태스크 히스토리 조회 |
| `nx_init` | 저장소 스캔 후 core 지식 초기화. tracker를 초기화하지 않음 |
| `nx_sync` | `ensureNexusStructure` 호출 + nx-sync skill 워크플로 안내 메시지 반환. LLM이 `[sync]` 태그 시 git diff 실행 → Writer agent spawn → `.nexus/context/` Read/Write 직접 처리. tracker를 초기화하지 않음 |
| `nx_setup` | OpenCode 설정 파일과 스킬 파일 생성·병합. tracker를 초기화하지 않음 |

### 지식 관리 (Knowledge Management)

| 도구 | 역할 |
|------|------|
| `nx_context` | 현재 Nexus 상태 요약 조회 |
| `nx_artifact_write` | 아티팩트 파일 저장 |

### 코드 인텔리전스 (Code Intelligence)

휴리스틱 기반. 정규식과 패턴 매칭으로 동작. 지원 확장자: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.go`, `.rs`

| 도구 | 역할 |
|------|------|
| `nx_lsp_document_symbols` | 파일 내 심볼 정의 목록 |
| `nx_lsp_workspace_symbols` | 워크스페이스 전체 심볼 검색 |
| `nx_lsp_hover` | 특정 위치의 심볼 정보 조회 |
| `nx_lsp_goto_definition` | 심볼의 정의 위치 조회 |
| `nx_lsp_diagnostics` | 경량 진단 (TODO/FIXME, console.log, debugger) |
| `nx_lsp_code_actions` | 진단 기반 코드 액션 제안 |
| `nx_lsp_find_references` | 워크스페이스 심볼 참조 탐색 |
| `nx_lsp_rename` | 워크스페이스 전체 심볼 리네임 |
| `nx_ast_search` | 정규식 패턴 검색 |
| `nx_ast_replace` | 정규식 기반 소스 코드 치환 |

## 도구 카테고리 요약

구현 근거: `src/tools/index.ts` — 26개 도구 export (`src/tools/index.ts:19-49` 참조)

| 카테고리 | 도구 수 | 주요 목적 |
|----------|---------|-----------|
| 워크플로 | 14 | Plan·태스크 사이클, 히스토리, 초기화·동기화, 설정 |
| 지식 관리 | 2 | 컨텍스트, 아티팩트 |
| 코드 인텔리전스 | 10 | 휴리스틱 LSP, AST 검색·치환 |
| **합계** | **26** | |

## 도구 실행 훅 동작

### `tool.execute.before` — 편집 가드레일 및 KNOWLEDGE_INDEX 주입

편집류 도구(edit, write, patch, multiedit 등)에 대해 태스크 사이클 상태를 평가하여 차등 가드레일을 적용한다:

| 태스크 사이클 상태 | 동작 |
|-------------------|------|
| `idle` / `none` | 편집 허용 (태스크 없는 자유 편집) |
| `empty` | 편집 허용 |
| `active` | 편집 허용 |
| `completed-open` | 보호(block/warning) — 태스크 사이클 종료 권장 |

추가로 `task` 도구 호출 시 `appendKnowledgeIndexToTaskArgs(paths, args)`를 통해 `.nexus/{context,memory,rules}`의 파일 목록을 `KNOWLEDGE_INDEX:` 블록으로 주입하여 subagent_spawn continuity를 지원한다.

### `tool.execute.after` — 미완료 태스크 경고 및 knowledge-index 캐시 무효화

도구 실행 완료 후, 다음 조건을 확인하여 경고 메시지를 추가한다:

1. 실행된 도구의 `owner` 필드와 일치하는 태스크를 조회
2. 해당 태스크가 `pending` 또는 `in_progress` 상태인 경우
3. "다음 태스크가 아직 완료되지 않았습니다" 경고와 함께 태스크 목록 표시

이는 의도하지 않은 종료를 방지하고 태스크 사이클의 완전한 종료를 유도한다.

추가로 편집 대상 경로가 `.nexus/{context,memory,rules}` 하위일 경우 `invalidateKnowledgeIndex(projectRoot)`를 호출하여 knowledge-index 캐시를 무효화한다.

### 세션 컴팩팅 스냅샷 (`experimental.session.compacting`)

세션 컴팩팅 시 `buildCompactionStateSnapshot(paths)`가 `[nexus-state-snapshot]` prefix의 multi-line 구조 스냅샷을 생성한다:

- `active mode`: `plan` | `run` | `idle`
- `plan`: topic 및 issues(제목+status, 최대 20개)
- `tasks`: 태스크(제목+status, 최대 30개) 및 ready-task set(의존성 완료된 pending 태스크)
- `knowledge_index`: context/memory/rules 파일명(각 최대 50개)
- `active agents`: 활성 에이전트 목록(coordination_label 포함, 최대 30개)

### 동적 상태 알림 (Dynamic Stateful Notices)

`experimental.chat.system.transform` 훅이 현재 모드와 태스크 사이클 상태를 기반으로 동적 알림을 생성하여 시스템 프롬프트에 주입한다:

- **Step 7 완료 핸드오프**: 모든 태스크가 `completed` 상태가 되면, `nx_task_add` 호출을 통한 새 태스크 생성 안내 메시지가 자동으로 포함된다.
- **모드별 스킬 주입**: `[plan]`/`[run]`/`[sync]` 태그 감지 시 해당 스킬 본문이 `<nexus-skill id="...">` 블록으로 삽입된다.
- **manual_only nudge**: 수동 실행 스킬(nx-init, nx-setup)은 B-leg 주입 대상에서 제외되고, 대신 실행 안내 메시지가 표시된다.
