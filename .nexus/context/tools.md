<!-- tags: codebase, tools, runtime, dependencies -->
# 도구 및 런타임

## 런타임 환경

- **패키지 매니저**: Bun ≥ 1.3.9
- **언어**: TypeScript ^5.6
- **모듈 형식**: ESM (`"type": "module"`)
- **Node 엔진**: ≥ 22 (`import ... with { type: "json" }` 구문 요구)
- **빌드**: `bun run sync && tsc --noEmit` — dist 없음, OpenCode가 TS 직접 로드 (`main: ./src/plugin.ts`)
- **런타임 의존성 (npm `dependencies`)**:
  - `@moreih29/nexus-core ^0.15.1` (shared runtime substrate)
  - `@opencode-ai/plugin ^1.4.7` (OpenCode plugin interface)
- **개발 의존성 (`devDependencies`)**: `@types/node ^22.10.1`, `typescript ^5.6.3`
- **MCP 서버**: `nexus-mcp` stdio 서버 — 별도 프로세스로 `nx_*` 도구 canonical 제공

## MCP Integration

### Consumer opencode.json 설정 (SSOT)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-nexus"],
  "mcp": {
    "nx": { "type": "local", "command": ["nexus-mcp"] }
  },
  "default_agent": "lead"
}
```

- **`mcp` 키** (not `mcp_servers`) — opencode config schema 요구사항
- `type: "local"` — stdio 서버 local spawn
- `command` 배열 — `nexus-mcp` bin은 @moreih29/nexus-core dependency로 `node_modules/.bin/`에 자동 resolve
- **`plugin: ["opencode-nexus"]`만으로 10 agents 자동 등록** — `agent` 객체(단수)는 모델/권한 override 용도로만 선택적 선언. canonical schema에 `agents` 배열은 존재하지 않음.
- v0.11.0+에서는 `bunx opencode-nexus install`이 이 config를 자동 생성합니다.

### nexus-mcp 제공 도구 (v0.15.1 기준 18개)

**Plan 도구 (6)**:

| 도구 | 역할 |
|------|------|
| `nx_plan_start` | Plan 세션 시작. topic, research_summary, issues 초기화 |
| `nx_plan_status` | 현재 Plan 상태 조회 |
| `nx_plan_resume` | HOW 참여자의 재개 라우팅 정보 조회 |
| `nx_plan_update` | Plan 이슈 add/remove/edit/reopen |
| `nx_plan_decide` | Plan 이슈 결정 기록 (`[d]` 태그 핸들러) |
| `nx_plan_analysis_add` | HOW 분석 엔트리 추가 |

**Task 도구 (5)**:

| 도구 | 역할 |
|------|------|
| `nx_task_add` | 태스크 사이클에 태스크 추가 |
| `nx_task_list` | 태스크 목록 및 상태 요약 |
| `nx_task_update` | 태스크 상태 변경 (`pending`/`in_progress`/`completed`) |
| `nx_task_close` | 태스크 사이클 종료 및 히스토리 아카이브 |
| `nx_task_resume` | 태스크 실행 재개 |

**History 도구 (1)**: `nx_history_search` — 과거 plan/task 히스토리 조회

**Artifact 도구 (1)**: `nx_artifact_write` — `.nexus/state/artifacts/` 파일 저장

**LSP 도구 (5)**:

| 도구 | 역할 |
|------|------|
| `nx_lsp_hover` | 특정 위치 심볼 정보 |
| `nx_lsp_diagnostics` | 경량 진단 및 리팩터 힌트 |
| `nx_lsp_find_references` | 심볼 참조 워크스페이스 탐색 |
| `nx_lsp_rename` | 단어 경계 매칭 이름 변경 (프리뷰/적용) |
| `nx_lsp_code_actions` | 경량 code action 제안 |

### v0.10.0에서 완전 제거된 도구 (nexus-mcp에도 존재하지 않음)

이전 opencode-nexus 버전에서 로컬 구현했으나 **nexus-mcp canonical에도 없는** 도구 — cut 확정 (Issue #8):

| 이전 도구 | 처분 |
|-----------|------|
| `nx_context` | **CUT** — 이전 로컬 상태 요약 도구, nexus-mcp 미포함 |
| `nx_init` / `nx_sync` (workflow wrappers) | **CUT** — skill 트리거(`skill({ name: "nx-init" })`, `[sync]` 태그)로 대체 |
| `nx_ast_search` / `nx_ast_replace` | **CUT** — 구조적 리팩터링 도구 제거. grep/regex 또는 외부 도구 |
| `nx_lsp_document_symbols` | **CUT** — nexus-mcp는 이 도구 미제공 |
| `nx_lsp_workspace_symbols` | **CUT** — 동일 |
| `nx_lsp_goto_definition` | **CUT** — 동일 |
| `nx_plan_followup` | **CUT** — nexus-mcp의 `nx_plan_analysis_add`가 유사 역할 |

> **주의**: 위 도구들은 **nexus-mcp로 이전된 것이 아니라 ecosystem에서 완전히 제거됐다**. 과거 workflow를 이 도구에 의존했다면 nexus-core canonical 대체를 사용하거나 해당 기능을 포기해야 한다 (Plan #57 Issue #8 "functional regression acceptance" 결정).

### 삭제된 로컬 구현 디렉토리 (v0.10.0)

| 디렉토리/파일 | 비고 |
|---------------|------|
| `src/tools/` | 전체 삭제 — MCP 대체 가능분은 nexus-mcp로, 나머지는 cut |
| `src/plugin/hooks.ts` (1,224줄) | 삭제 — canonical handler로 대체 (아래 Hook 섹션 참고) |
| `src/plugin/system-prompt.ts` (219줄) | 삭제 — nexus-core `prompt-router` hook이 대체 |
| `src/orchestration/` | 전체 삭제 (team-policy, delegation, continuity adapters 등) |
| `src/pipeline/` | 전체 삭제 (evaluator, qa-trigger) |
| `src/shared/` 대부분 | agent-tracker, knowledge-index, plan-how-panel, memory-access, tag-parser 등 삭제 |

**총 19,755 LOC 삭제** (Plan #57 T2 구조 마이그레이션).

## Plugin Hook Dispatch (nexus-core canonical)

opencode-nexus plugin entry(`src/plugin.ts`)는 `mountHooks(ctx, manifest)` 호출로 nexus-core canonical handler를 OpenCode plugin API에 wiring한다. 플러그인 자체는 hook 로직을 구현하지 않는다.

### OpenCode 이벤트 ↔ canonical handler 매핑

| OpenCode hook key | nexus-core handler | 역할 |
|-------------------|--------------------|------|
| `event` (session.created) | `session-init` | `.nexus/` 구조 초기화, runtime.json, initial state |
| `chat.message` | `prompt-router` | 사용자 프롬프트 태그 감지 |
| `experimental.chat.system.transform` | `prompt-router` | system 프롬프트에 skill/state 주입 (additional_context flush) |
| `tool.execute.before` + `.after` (input.tool === "task") | `agent-bootstrap` / `agent-finalize` | subagent 생명주기, agent-tracker |
| `tool.execute.after` (other tools) | `post-tool-telemetry` | tool 실행 텔레메트리 (opencode 런타임에서 적용 가능한 capability subset) |

### Hook manifest

`@moreih29/nexus-core/hooks/opencode-manifest` JSON을 `with { type: "json" }` import attribute로 로딩. nexus-core publish 시 pre-bundled된 `dist/assets/hooks/<name>/handler.js`를 `handlerPath`로 참조. Consumer 측 추가 빌드 불필요.

## CLI vs MCP tools 구분

- **nexus-mcp tools** (18개, nexus-core 관리): opencode 세션 낮부에서 호출되는 MCP server 기능 (nx_plan_start 등)
- **opencode-nexus CLI** (v0.11.0+): opencode 실행 외부에서 config/skills 설치하는 wrapper CLI (install/uninstall/doctor)

두 surface는 목적과 실행 환경이 다릅니다:
- MCP tools: OpenCode 런타임 낮부, nexus-mcp stdio server 통해 제공
- CLI: 쉘 환경, standalone Node.js script, opencode 없이도 동작

## 배포 도구

- **nexus-core CLI**: `nexus-core` bin (`@moreih29/nexus-core` dependency로 `node_modules/.bin/`에 설치)
  - `sync` — managed paths 생성
  - `init` — 신규 plugin repo 스캐폴드
  - `list` — 에이전트/스킬/훅 목록
  - `validate` — assets frontmatter 검증
  - `mcp` — stdio MCP 서버 직접 실행 (nexus-mcp와 동일)
- **opencode-nexus 고유 script**:
  - `scripts/postinstall.mjs` — consumer `.opencode/skills/` 복사
  - `scripts/e2e-nexus-integration.mjs` — 통합 회귀 (MCP handshake + mountHooks + sync idempotency + plugin load)
- **deploy skill**: `.opencode/skills/deploy/SKILL.md` — npm publish 오케스트레이션 (opencode-nexus 고유 유지)
