<!-- tags: codebase, tools, runtime, dependencies -->
# 도구 및 런타임

## 런타임 환경

- **패키지 매니저**: Bun 1.3.9
- **언어**: TypeScript 5.6
- **모듈 형식**: ESM (`"type": "module"`)
- **빌드**: `bun run sync && tsc --noEmit` — dist 없음, TS 직접 로드
- **런타임 의존성**: 
  - `@moreih29/nexus-core ^0.15.1` (runtime substrate)
  - `@opencode-ai/plugin ^1.4.7` (OpenCode plugin interface)
- **개발 의존성**: `typescript ^5.6.3` (타입 검사만)
- **MCP 서버**: `nexus-mcp` — 별도 프로세스로 모든 `nx_*` 도구 제공

## MCP Integration

### nexus-mcp 서버 접근

모든 `nx_*` 도구는 **nexus-mcp** stdio server를 통해 제공된다. Consumer는 `opencode.json`에 MCP 설정을 추가해야 한다.

**Consumer opencode.json 설정:**
```json
{
  "mcp": {
    "nx": {
      "type": "local",
      "command": ["nexus-mcp"]
    }
  }
}
```

### nexus-mcp 제공 도구 (14+ 개)

| 도구 | 역할 |
|------|------|
| `nx_plan_start` | Plan 세션 시작. 주제, research_summary, 이슈 목록 초기화 |
| `nx_plan_status` | 현재 Plan 상태 조회 |
| `nx_plan_resume` | HOW 역할 참여자의 재개 라우팅 정보 조회 |
| `nx_plan_followup` | 참여자에 대한 위임 준비 팔로업 안내 생성 |
| `nx_plan_update` | Plan 이슈 추가·제거·수정·재오픈 |
| `nx_plan_decide` | Plan 이슈에 결정 사항 기록. 결정 요청 전 pros/cons/trade-offs 비교 표와 권고안 제시 필요 |
| `nx_task_add` | 태스크 사이클에 태스크 추가 |
| `nx_task_list` | 태스크 목록 및 상태 요약 조회 |
| `nx_task_update` | 태스크 상태 변경 |
| `nx_task_close` | 태스크 사이클 종료 및 히스토리 아카이브 |
| `nx_history_search` | 과거 plan·태스크 히스토리 조회 |
| `nx_init` | 저장소 스캔 후 core 지식 초기화 |
| `nx_sync` | 태스크 사이클 완료 후 코어 지식 동기화 |
| `nx_context` | 현재 Nexus 상태 요약 조회 |
| `nx_artifact_write` | 아티팩트 파일 저장 |

### LSP 도구 (nexus-mcp canonical)

| 도구 | 역할 |
|------|------|
| `nx_lsp_document_symbols` | 파일 내 심볼 정의 목록 |
| `nx_lsp_workspace_symbols` | 워크스페이스 전체 심볼 검색 |
| `nx_lsp_hover` | 특정 위치의 심볼 정보 조회 |
| `nx_lsp_goto_definition` | 심볼의 정의 위치 조회 |
| `nx_lsp_find_references` | 워크스페이스 심볼 참조 탐색 |

**제거된 LSP 도구**: `nx_lsp_diagnostics`, `nx_lsp_code_actions`, `nx_lsp_rename` — nexus-mcp v0.15.1에서 제거됨 (#8 T3).

## 삭제된 로컬 도구 (v0.10.0)

| 디렉토리/파일 | 삭제 이유 | 대체 |
|---------------|-----------|------|
| `src/tools/plan.ts` | nexus-mcp로 이전 | `nx_plan_*` via nexus-mcp |
| `src/tools/task.ts` | nexus-mcp로 이전 | `nx_task_*` via nexus-mcp |
| `src/tools/workflow.ts` | nexus-mcp로 이전 | `nx_init`, `nx_sync` via nexus-mcp |
| `src/tools/context.ts` | nexus-mcp로 이전 | `nx_context` via nexus-mcp |
| `src/tools/artifact.ts` | nexus-mcp로 이전 | `nx_artifact_write` via nexus-mcp |
| `src/tools/lsp.ts` | nexus-mcp로 이전 | `nx_lsp_*` via nexus-mcp |
| `src/tools/ast.ts` | nexus-mcp로 이전 | `nx_ast_*` via nexus-mcp |
| `src/tools/setup.ts` | 제거 |不再 필요 |

**총 19,755 LOC 삭제** (orchestration/, pipeline/, shared/, tools/, plugin/ 포함)

## Hook Events (Plugin Level)

opencode-nexus plugin은 다음 hook events를 구독한다:

| 이벤트 | 처리기 | 역할 |
|--------|--------|------|
| `event(session.created)` | session-init | .nexus/ 구조 초기화, tracker 리셋 |
| `chat.message` | prompt-router | 태그 감지, skill body 주입 |
| `tool.execute.before` | agent-bootstrap | 편집 가드레일, KNOWLEDGE_INDEX 주입 |
| `tool.execute.after` | agent-finalize | 미완료 태스크 경고, 캐시 무효화 |
| `experimental.chat.system.transform` | prompt-router | 동적 상태 알림 생성 |

## 도구 실행 훅 동작 (nexus-core canonical)

### `tool.execute.before` — 편집 가드레일 및 KNOWLEDGE_INDEX 주입

편집류 도구(edit, write, patch, multiedit 등)에 대해 태스크 사이클 상태를 평가하여 차등 가드레일을 적용한다:

| 태스크 사이클 상태 | 동작 |
|-------------------|------|
| `idle` / `none` | 편집 허용 (태스크 없는 자유 편집) |
| `empty` | 편집 허용 |
| `active` | 편집 허용 |
| `completed-open` | 보호(block/warning) — 태스크 사이클 종료 권장 |

추가로 `task` 도구 호출 시 `.nexus/{context,memory,rules}`의 파일 목록을 `KNOWLEDGE_INDEX:` 블록으로 주입하여 subagent_spawn continuity를 지원한다.

### `tool.execute.after` — 미완료 태스크 경고 및 knowledge-index 캐시 무효화

도구 실행 완료 후, 다음 조건을 확인하여 경고 메시지를 추가한다:

1. 실행된 도구의 `owner` 필드와 일치하는 태스크를 조회
2. 해당 태스크가 `pending` 또는 `in_progress` 상태인 경우
3. "다음 태스크가 아직 완료되지 않았습니다" 경고와 함께 태스크 목록 표시

추가로 편집 대상 경로가 `.nexus/{context,memory,rules}` 하위일 경우 knowledge-index 캐시를 무효화한다.

### 세션 컴팩팅 스냅샷 (`experimental.session.compacting`)

세션 컴팩팅 시 `[nexus-state-snapshot]` prefix의 multi-line 구조 스냅샷을 생성한다:

- `active mode`: `plan` | `run` | `idle`
- `plan`: topic 및 issues(제목+status, 최대 20개)
- `tasks`: 태스크(제목+status, 최대 30개) 및 ready-task set
- `knowledge_index`: context/memory/rules 파일명(각 최대 50개)
- `active agents`: 활성 에이전트 목록(coordination_label 포함, 최대 30개)

### 동적 상태 알림 (Dynamic Stateful Notices)

`experimental.chat.system.transform` 훅이 현재 모드와 태스크 사이클 상태를 기반으로 동적 알림을 생성하여 시스템 프롬프트에 주입한다:

- **Step 7 완료 핸드오프**: 모든 태스크가 `completed` 상태가 되면, `nx_task_add` 호출을 통한 새 태스크 생성 안내 메시지가 자동으로 포함된다.
- **모드별 스킬 주입**: `[plan]`/`[run]`/`[sync]` 태그 감지 시 해당 스킬 본문이 `<nexus-skill id="...">` 블록으로 삽입된다.
- **manual_only nudge**: 수동 실행 스킬(nx-init, nx-setup)은 B-leg 주입 대상에서 제외되고, 대신 실행 안내 메시지가 표시된다.
