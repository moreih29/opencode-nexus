<!-- tags: codebase, tools, runtime, dependencies -->
# 도구 및 런타임

## 런타임 환경

- **패키지 매니저**: Bun 1.3.9
- **언어**: TypeScript 5.6
- **모듈 형식**: ESM (`"type": "module"`)
- **빌드 출력**: `tsc -p tsconfig.json` → `dist/index.js`
- **런타임 의존성**: `zod ^3.23.8` (스키마 검증)
- **개발 의존성**: `@opencode-ai/plugin` (tool 팩토리, 컨텍스트 타입), `@types/node`
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
| `nx_plan_decide` | Plan 이슈에 결정 사항 기록 |
| `nx_task_add` | 태스크 사이클에 태스크 추가 |
| `nx_task_list` | 태스크 목록 및 상태 요약 조회 |
| `nx_task_update` | 태스크 상태 변경 |
| `nx_task_close` | 태스크 사이클 종료 및 히스토리 아카이브 |
| `nx_history_search` | 과거 plan·태스크 히스토리 조회 |
| `nx_init` | 저장소 스캔 후 core 지식 초기화 |
| `nx_sync` | `ensureNexusStructure` 호출 + nx-sync skill 워크플로 안내 메시지 반환. LLM이 `[sync]` 태그 시 git diff 실행 → Writer agent spawn → `.nexus/context/` Read/Write 직접 처리 |
| `nx_setup` | OpenCode 설정 파일과 스킬 파일 생성·병합 |

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
