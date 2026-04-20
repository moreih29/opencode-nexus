<!-- tags: codebase, architecture, modules, data-flow -->
# opencode-nexus 아키텍처 개요

## 1. 전체 구조

`opencode-nexus`는 OpenCode 하네스용 **nexus-core 0.15.1+ shared runtime substrate 래퍼**다. claude-nexus와 sibling(자매) 관계로, Nexus 오케스트레이션 워크플로우를 OpenCode 런타임에서 구현한다.

**Phase 2 선언 (v0.10.0+)**: opencode-nexus는 더 이상 독립적인 orchestration runtime이 아니라, `@moreih29/nexus-core`의 **runtime substrate consumer**다. Canonical orchestration 로직은 nexus-core에서 관리되며, opencode-nexus는 OpenCode-specific harness adapter 역할만 수행한다.

```
OpenCode 런타임
    │
    └── opencode-nexus Plugin (src/plugin.ts)
            ├── mountHooks(ctx, manifest)     → nexus-core canonical hook handlers
            ├── src/agents/*.ts               → sync-managed AgentConfig (10개)
            └── postinstall.mjs               → nx-* skill files copy to consumer
```

**데이터 흐름:**

- OpenCode가 세션 이벤트(`session.created`), 도구 실행, 채팅 메시지를 발생시킨다.
- `mountHooks(ctx, manifest)`가 nexus-core canonical handlers를 dispatch한다.
- Canonical handlers: `session-init`, `prompt-router`, `agent-bootstrap`, `agent-finalize`
- 상태는 `.nexus/` 디렉터리(파일 기반)와 nexus-core substrate가 관리한다.
- 모든 `nx_*` 도구는 **nexus-mcp** stdio server를 통해 제공된다.

## 2. 핵심 모듈 설명

### src/plugin.ts (Entry Point)

Plugin 진입점. OpenCode가 플러그인을 로드할 때 호출된다.

```typescript
import { mountHooks } from "@moreih29/nexus-core/hooks/opencode-mount";
import manifest from "@moreih29/nexus-core/hooks/opencode-manifest" with { type: "json" };

export default function opencodeNexusPlugin(ctx: PluginContext) {
  return mountHooks(ctx, manifest);
}
```

**mountHooks 역할:**
- nexus-core canonical hook handlers 등록
- Hook events 구독: `event(session.created)`, `chat.message`, `tool.execute.before/after`, `experimental.chat.system.transform`

### src/index.ts

Plugin 및 타입 재남출 (barrel export). Consumer가 `import { ... } from "opencode-nexus"`로 접근할 수 있는 공개 API.

### src/agents/*.ts (10개, sync-managed)

nexus-core sync CLI가 관리하는 AgentConfig 객체들. **직접 편집 금지** — `bun run sync`로 재생성된다.

| 파일 | 에이전트 | 카테고리 |
|------|----------|----------|
| `architect.ts` | architect | HOW |
| `designer.ts` | designer | HOW |
| `postdoc.ts` | postdoc | HOW |
| `strategist.ts` | strategist | HOW |
| `engineer.ts` | engineer | DO |
| `researcher.ts` | researcher | DO |
| `writer.ts` | writer | DO |
| `tester.ts` | tester | CHECK |
| `reviewer.ts` | reviewer | CHECK |
| `lead.ts` | lead (primary) | Lead |

각 파일은 nexus-core canonical agent body를 포함하며, OpenCode-specific 설정(model, disallowedTools)을 오버레이한다.

### postinstall.mjs

Consumer 프로젝트의 `.opencode/skills/` 디렉토리로 nx-* 4 skill 파일을 복사한다.

- **A-leg delivery**: 스킬 파일이 consumer 로컬에 복사됨
- **B-leg**: nexus-core `prompt-router` hook이 `[plan]`/`[run]`/`[sync]` 태그 감지 시 canonical skill body 주입

**복사 대상 스킬:**
- `nx-plan` → `.opencode/skills/nx-plan/SKILL.md`
- `nx-run` → `.opencode/skills/nx-run/SKILL.md`
- `nx-init` → `.opencode/skills/nx-init/SKILL.md`
- `nx-sync` → `.opencode/skills/nx-sync/SKILL.md`

### 삭제된 모듈 (v0.10.0)

| 디렉토리 | 삭제 이유 |
|----------|-----------|
| `src/tools/` | nexus-mcp가 모든 도구 제공 (19,755 LOC 삭제) |
| `src/orchestration/` | nexus-core canonical orchestration으로 이전 |
| `src/pipeline/` | nexus-core evaluator로 이전 |
| `src/shared/` | nexus-core shared utils로 이전 |
| `src/plugin/` | hooks가 mountHooks로 단순화 |
| `src/skills/` | sync-managed로 이전, 템플릿 불필요 |
## 3. Plugin 초기화 흐름

```
OpenCode 시작
    │
    ▼
plugin import (src/plugin.ts)
    │
    ├─1─ mountHooks(ctx, manifest) 호출
    │       → nexus-core canonical handlers 등록
    │       → Hook events 구독
    │
    └─2─ Plugin 반환 객체
            └── hooks (nexus-core dispatch)

Session Created
    │
    ▼
event(session.created) → session-init handler
    │
    ├─1─ .nexus/ 구조 초기화 (context/memory/rules/state)
    ├─2─ knowledge-index 캐시 초기화
    └─3─ agent-tracker 상태 초기화

Chat Message
    │
    ▼
chat.message → prompt-router handler
    │
    ├─1─ [plan]/[run]/[sync] 태그 감지
    ├─2─ 해당 모드 skill body 주입
    └─3─ 동적 상태 알림 생성

Tool Execute
    │
    ▼
tool.execute.before → agent-bootstrap handler
    │
    ├─1─ 편집 가드레일 적용
    ├─2─ KNOWLEDGE_INDEX 주입
    └─3─ Owner continuity 확인

tool.execute.after → agent-finalize handler
    │
    ├─1─ 미완료 태스크 경고
    └─2─ knowledge-index 캐시 무효화
```
## 4. nexus-core Consumption (Phase 2 adoption — 2026-04-20)

opencode-nexus는 `@moreih29/nexus-core`를 **runtime substrate consumer**로 소비한다. Phase 2 adoption은 기존 orchestration/pipeline/shared/tools 코드 19,755 LOC를 삭제하고 nexus-core canonical 구현으로 대체했다.

### Consumption Mode 변경

| 구분 | Phase 1 (v0.9.x) | Phase 2 (v0.10.0+) |
|------|------------------|-------------------|
| 모드 | 빌드 타임 read-only consumer | runtime substrate consumer |
| 로직 위치 | opencode-nexus local | nexus-core canonical |
| 도구 구현 | src/tools/* (로컬) | nexus-mcp (별도 프로세스) |
| Hook 처리 | src/plugin/hooks.ts (로컬) | mountHooks dispatch |
| 스킬 전달 | A-leg + B-leg | postinstall copy + B-leg |

### Dependency

- **Dependency**: `@moreih29/nexus-core ^0.16.2` (runtime dependency — 더 이상 devDependency 아님) — plan #59 decision D1 (v0.12.0 release target)
- **Plugin Interface**: `@opencode-ai/plugin ^1.4.9`
- **TypeScript**: 개발 의존성으로만 사용 (런타임은 TS 직접 로드)

### v0.16.0 OpenCode fragment 제거 수용

nexus-core v0.16.0+ 에서 OpenCode 계약이 재정렬되었다. `opencode.json.fragment`는 더 이상 생성되지 않으며, canonical registration은 `plugin: ["<name>"]`이다. consumer config의 `agents: [...]` 배열은 v0.16 기준 invalid하다. 상세 내용은 `.nexus/memory/upstream-docs-drift.md` 참조.

### `.nexus/` 구조

사람이 직접 작성/관리하는 영역은 claude-nexus 표준과 동일한 flat 구조를 따른다:

- `.nexus/context/` — 정적 설계 문서 (이 파일 포함, principles, orchestration, tools, build-and-release)
- `.nexus/memory/` — lessons learned, references, anti-patterns, follow-up
- `.nexus/rules/` — 강제 컨벤션
- `.nexus/state/` — runtime 데이터. nexus-core `rule:harness-state-namespace`에 따라 opencode-nexus 고유 파일은 `.nexus/state/opencode-nexus/` 네임스페이스로 격리된다.

**plan.json / tasks.json 스키마**

두 파일은 nexus-core canonical 표준을 따른다.

**PlanFile**: `id`, `topic`, `issues`, `research_summary?`, `created_at`

**PlanIssue**: `id`, `title`, `status`(`pending`|`decided`), `decision?`, `how_agents?`, `how_summary?`, `how_agent_ids?`

**TaskItem**: `id`, `title`, `status`(`pending`|`in_progress`|`completed`|`blocked`), `owner?`, `owner_agent_id?`, `owner_reuse_policy?`, `plan_issue?`, `deps?`, 기타 context 필드

---

## 5. MCP Integration

### nexus-mcp 서버

모든 `nx_*` 도구는 **nexus-mcp** stdio server를 통해 제공된다. nexus-mcp는 별도 프로세스로 실행되며, opencode.json의 MCP 설정을 통해 연결된다.

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

### 도구 제공 범위

nexus-mcp는 14+ 개의 canonical 도구를 제공한다:
- Plan 관리: `nx_plan_start`, `nx_plan_status`, `nx_plan_resume`, `nx_plan_followup`, `nx_plan_update`, `nx_plan_decide`
- 태스크 관리: `nx_task_add`, `nx_task_list`, `nx_task_update`, `nx_task_close`
- 히스토리: `nx_history_search`
- 컨텍스트: `nx_context`, `nx_artifact_write`
- LSP: `nx_lsp_document_symbols`, `nx_lsp_workspace_symbols`, `nx_lsp_hover`, `nx_lsp_goto_definition`, `nx_lsp_find_references`
- 워크플로우: `nx_init`, `nx_sync`

**Upstream reference**: `docs/contract/harness-io.md §4-2` (nexus-core 0.15.1)

---

## 6. Consumer surface (v0.11.0+)

### CLI binary

`opencode-nexus` binary (`bin/opencode-nexus.mjs`)는 consumer의 **canonical installer/mutator**입니다.

| 역할 | 구성 요소 |
|---|---|
| Mechanical installer | CLI (bin/opencode-nexus.mjs) — file mutation, atomic writes, backups, doctor |
| Cognitive wizard | nx-setup skill — model/provider recommendation, post-install refinement |

두 표면은 역할이 다륩니다:
- **CLI**: 파일시스템 변경, config 병합, skills 복사, 진단 (opencode 없이도 동작)
- **nx-setup skill**: OpenCode 세션 낮부에서 model/provider 설정 등 refinement 수행

CLI 엔진 구성:
- `lib/install-spec.mjs` — wrapper-local canonical 상수 (plugin name, mcp config, default_agent, skills list). 향후 nexus-core 공식 export로 교체 가능한 얇은 경계.
- `lib/config-merge.mjs` — path-scoped patch engine (preserve-first, patch-empty idempotency, sibling backups, atomic write)
- `lib/skills-copy.mjs` — preserve-first skill manager (scope-aware, --purge gate)
- `lib/doctor.mjs` — state diagnostics (fresh/complete/partial/orphan classification, --fix non-destructive)
- `bin/opencode-nexus.mjs` — argv dispatch, TTY interactive, exit codes 0/1/2/3

### Bootstrap journey

1. **CLI 설치** (`bunx opencode-nexus install`) — opencode 실행 없이 mechanical setup 완료
2. **(선택) nx-setup refinement** — OpenCode 실행 후 `skill({ name: "nx-setup" })`로 cognitive refinement
