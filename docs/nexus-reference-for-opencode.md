# Nexus Reference — 철학, 아키텍처, 코드 구조 완전 가이드

> 이 문서는 원본 `claude-nexus`의 설계 철학과 코드 구조를 분석한 historical reference다. 다른 AI 코딩 도구(opencode 등)에서 동일한 철학의 오케스트레이션 시스템을 구축할 때 참고 자료로 사용한다.

> 현재 `opencode-nexus` 저장소의 실제 구현 범위는 `docs/coverage-matrix.md`와 `docs/operations.md`를 기준으로 판단해야 한다. 이 문서는 목표 아키텍처와 원본 참조를 함께 담고 있어, 일부 항목은 현재 구현보다 앞서 있을 수 있다.

> Claude Code 전용 개념(`.claude-plugin`, `CLAUDE.md` auto sync, TeamCreate/SendMessage 등)은 이 문서에서 source analysis 용도로 유지된다. 현재 OpenCode runtime 지원 여부는 별도로 확인해야 한다.

---

## 목차

1. [설계 철학](#1-설계-철학)
2. [진화 과정과 교훈](#2-진화-과정과-교훈)
3. [프로젝트 파일 구조](#3-프로젝트-파일-구조)
4. [빌드 시스템](#4-빌드-시스템)
5. [훅 시스템 (gate.ts)](#5-훅-시스템-gatets)
6. [MCP 서버 구조](#6-mcp-서버-구조)
7. [상태 관리 패턴](#7-상태-관리-패턴)
8. [에이전트 설계](#8-에이전트-설계)
9. [스킬 설계](#9-스킬-설계)
10. [컨텍스트 엔지니어링](#10-컨텍스트-엔지니어링)
11. [Claude Code 플러그인 포맷](#11-claude-code-플러그인-포맷)
12. [핵심 설계 결정과 이유](#12-핵심-설계-결정과-이유)
13. [이식 가이드: 플랫폼 의존 vs 범용](#13-이식-가이드-플랫폼-의존-vs-범용)

---

## 1. 설계 철학

### 1.1 미션

Nexus는 사용자의 오케스트레이션 인프라다. 에이전트 카탈로그, 태스크 파이프라인, 컨텍스트 관리를 제공하여 사용자가 원하는 방식으로 작업을 조직하고 실행할 수 있게 한다.

### 1.2 핵심 원칙 5가지

#### (1) User Sovereignty (사용자 주권)

사용자가 범위, 방향, 에이전트 구성을 결정한다. Nexus는 실행 인프라를 제공하고 사용자의 방향 하에 운영된다. 단, 예스맨은 아니다 — 근거가 있으면 적극적으로 반박한다.

**실무 의미**: 자율 오케스트레이션이 아닌 사용자 주도 오케스트레이션. `[run]` 태그는 opt-in이며, 태그 없는 메시지는 사용자가 직접 지시하는 것으로 간주.

#### (2) Structural Harness (구조적 가드레일)

품질은 프롬프트 지시가 아닌 시스템 구조로 보장한다. 에이전트 행동은 태스크 파이프라인, 도구 차단, 단계별 검증 같은 구조적 메커니즘으로 제약된다.

**핵심 교훈**: 프롬프트에 "반드시 X 하라"고 쓰는 것은 약하다. `Edit/Write`를 tasks.json 없이 차단하는 것은 강하다. 구조적으로 강제할 수 있는 것만 하드레일로, 나머지는 소프트 가이드로.

#### (3) Intent Discovery on Demand (요청 시 의도 발견)

`[meet]` 태그로 진입할 때만 의도 발견 모드. 먼저 조사를 수행하고, 그 결과를 기반으로 사용자에게 질문한다. 근거 없는 질문 금지.

#### (4) User-Directed Composition (사용자 주도 구성)

사용자의 방향이 에이전트 구성을 결정한다. 사용자가 방향을 설정하면 Lead가 적절한 에이전트를 매칭하고, 에이전트를 명시적으로 지정하면 그대로 따른다.

#### (5) Progressive Depth (점진적 깊이)

의도의 명확성에 따라 탐색 깊이가 자동 조절된다. 명확한 요청은 즉시 실행, 모호한 요청은 깊은 상담으로 진입.

### 1.3 구조적 강제 vs 프롬프트 지시의 경계

Nexus 개발 과정에서 발견한 가장 중요한 원칙:

| 유형 | 예시 | 효과 |
|------|------|------|
| **구조적 강제** (작동함) | Edit/Write를 tasks.json 없이 block, Stop 시 pending 태스크 있으면 종료 차단, disallowedTools로 에이전트 도구 접근 차단 | LLM이 우회 불가 |
| **프롬프트 지시** (불안정) | "반드시 Architect를 먼저 스폰하라", "TEAM REQUIRED", additionalContext 경고 | LLM이 무시하거나 잊을 수 있음 |

**원칙**: 중요한 동작은 반드시 구조적으로 강제. 프롬프트 지시는 보조 수단.

---

## 2. 진화 과정과 교훈

### 2.1 자율 오케스트레이션의 한계

Nexus 이전 3세대의 오케스트레이터(OMC 29+ 에이전트, OMO Sisyphus+Atlas, 초기 Nexus)에서 모두 동일한 패턴이 관찰됨:

> **"오케스트레이터가 직접 하는" 패턴** — Lead가 에이전트를 위임하는 대신 자기가 직접 작업을 처리. LLM은 본질적으로 단일 턴 최적화기이므로, 위임은 훈련된 행동에 반함.

외부 연구 근거:
- Microsoft Magentic-UI: HITL(Human-in-the-Loop)이 태스크 완료율을 30.3% → 51.9%로 개선 (+71%)
- Gartner: 2027년까지 에이전트 AI 프로젝트 40%+가 자율성 한계로 취소될 것
- MAST (ACL 2025): "조직 설계가 개별 모델 능력보다 MAS 성공을 결정"

### 2.2 전환: 자율 → 사용자 주도

이 교훈으로 핵심 전환을 실시:
- 기본 동작을 자율 오케스트레이션에서 **사용자 주도**로 변경
- `[run]` 태그 = 파이프라인 opt-in (이 안에서만 Lead에게 자율권 부여)
- 태그 없는 메시지 = 사용자가 직접 지시, Lead가 실행
- 태그가 핵심 인터페이스가 됨: `[meet]`, `[d]`, `[run]`, `[rule]`

### 2.3 실패한 메커니즘들

| 메커니즘 | 문제 | 교훈 |
|----------|------|------|
| edit-tracker (수정 횟수 추적) | Lead가 트래커 파일을 리셋해버림 | "속도 방지턱"은 LLM이 우회 가능 |
| reopen-tracker (재개 횟수 추적) | 동일 | 서킷 브레이커는 LLM에 무의미 |
| 프롬프트 레벨 루프 방지 | 프롬프트는 사용자 직접 요청과 경합 → 사용자 요청이 이김 | 구조적 강제에 집중해야 함 |
| additionalContext로 "반드시 팀 생성" | Lead가 무시하고 혼자 진행 | additionalContext는 제안일 뿐, 강제가 아님 |

### 2.4 성공한 메커니즘들

| 메커니즘 | 효과 | 원리 |
|----------|------|------|
| Task Pipeline (Edit/Write 차단) | 모든 코드 변경이 태스크에 연결됨 | 도구 차단은 LLM이 우회 불가 |
| Stop nonstop (종료 차단) | pending 태스크 있으면 세션 종료 불가 | 구조적 강제 |
| disallowedTools | HOW 에이전트가 코드 수정 불가 | 플랫폼 레벨 도구 차단 |
| nx_meet_start 팀 검증 | attendees에 에이전트 있으면 실제 팀 존재 확인 | PreToolUse에서 block |
| speaker 검증 | nx_meet_discuss에서 미등록 speaker 거부 | MCP 도구 내부 데이터 검증 |

### 2.5 컨텍스트 엔지니어링 표준

개발 과정에서 확립된 표준:
- **영어**: 모든 LLM 대면 콘텐츠는 영어 (4-5배 토큰 절약, 지시 따르기 향상)
- **섹션 순서**: Role → Constraints → Context → Guidelines → Examples
- **포맷**: 마크다운 본문 + XML 섹션 태그 (Anthropic 권장 하이브리드)
- **게이트 메시지**: `<nexus>` XML 래퍼 (Claude Code의 `<system-reminder>` 패턴과 일치)
- **Lost in the Middle**: 제약사항(constraints)을 primacy position(role 직후)에 배치

---

## 3. 프로젝트 파일 구조

```
claude-nexus/
├── .claude-plugin/           # Claude Code 플러그인 메타데이터
│   ├── plugin.json           # 매니페스트 (name, version, skills, mcpServers 경로)
│   └── marketplace.json      # 마켓플레이스 등록 정보
├── .mcp.json                 # MCP 서버 등록 — node bridge/mcp-server.cjs
├── .nexus/                   # Nexus 런타임 + 지식 저장소
│   ├── .gitignore            # state/ 제외, core/+rules/+config.json+history.json만 추적
│   ├── config.json           # 설정 (statuslinePreset 등)
│   ├── history.json          # 아카이브된 사이클 (meet+tasks 이력)
│   ├── core/                 # 4계층 지식 저장소 (git 추적)
│   │   ├── identity/         # mission.md, design.md, roadmap.md, context-standard.md
│   │   ├── codebase/         # architecture.md, development.md, orchestration.md, tools.md
│   │   ├── reference/        # 외부 조사 결과
│   │   └── memory/           # 프로젝트 기억 (교훈, 패턴)
│   ├── rules/                # 팀 규칙 (git 추적, nx_rules_write로 관리)
│   └── state/                # 런타임 상태 (gitignore, 세션 한정)
│       ├── meet.json         # 활성 미팅 세션
│       ├── tasks.json        # 활성 태스크 목록
│       ├── agent-tracker.json # 에이전트 생명주기 추적
│       ├── stop-warned       # Stop 훅 무한루프 방지 플래그
│       └── artifacts/        # 에이전트 산출물
├── agents/                   # 에이전트 정의 (9개, frontmatter + 프롬프트)
│   ├── architect.md          # HOW — 기술 설계
│   ├── designer.md           # HOW — UX/UI 설계
│   ├── postdoc.md            # HOW — 연구 방법론
│   ├── strategist.md         # HOW — 비즈니스 전략
│   ├── engineer.md           # DO — 코드 구현
│   ├── researcher.md         # DO — 웹 검색, 조사
│   ├── writer.md             # DO — 기술 문서
│   ├── qa.md                 # CHECK — 테스트, 보안
│   └── reviewer.md           # CHECK — 콘텐츠 검증
├── skills/                   # 스킬 정의 (5개)
│   ├── nx-init/SKILL.md      # 프로젝트 온보딩
│   ├── nx-meet/SKILL.md      # 팀 미팅
│   ├── nx-run/SKILL.md       # 실행 파이프라인
│   ├── nx-setup/SKILL.md     # 설정 위저드
│   └── nx-sync/SKILL.md      # 코어 지식 동기화
├── src/                      # TypeScript 소스
│   ├── hooks/gate.ts         # 통합 훅 핸들러 (모든 이벤트)
│   ├── mcp/
│   │   ├── server.ts         # MCP 서버 진입점
│   │   └── tools/            # MCP 도구 모듈 (8개)
│   │       ├── meet.ts       # 미팅 세션 관리 (6개 도구)
│   │       ├── task.ts       # 태스크 관리 (4개 도구)
│   │       ├── core-store.ts # 4계층 지식 CRUD
│   │       ├── markdown-store.ts # 범용 마크다운 저장소 팩토리
│   │       ├── context.ts    # 컨텍스트 조회
│   │       ├── briefing.ts   # 역할별 브리핑 조립 (MATRIX)
│   │       ├── artifact.ts   # 산출물 저장
│   │       ├── lsp.ts        # LSP 도구 (9개)
│   │       └── ast.ts        # AST 도구 (2개)
│   ├── shared/               # 공유 유틸리티
│   │   ├── hook-io.ts        # 훅 stdin/stdout I/O
│   │   ├── paths.ts          # 경로 상수 + 디렉토리 보장
│   │   ├── tasks.ts          # readTasksSummary
│   │   ├── mcp-utils.ts      # textResult 헬퍼
│   │   └── version.ts        # VERSION 파일 읽기
│   ├── statusline/           # 상태라인 UI
│   ├── code-intel/           # LSP 클라이언트 + 언어 감지
│   └── data/tags.json        # 태그 정의 데이터
├── bridge/mcp-server.cjs     # 빌드 산출물 — MCP 서버 번들
├── scripts/
│   ├── gate.cjs              # 빌드 산출물 — 훅 번들
│   └── statusline.cjs        # 빌드 산출물 — 상태라인 번들
├── hooks/hooks.json          # 훅 이벤트 매핑 정의
├── templates/nexus-section.md # 자동 생성 시스템 프롬프트 섹션
├── test/e2e.sh               # E2E 테스트
├── esbuild.config.mjs        # 빌드 설정
├── dev-sync.mjs              # 개발용 캐시 동기화
├── release.mjs               # 릴리스 자동화
└── generate-template.mjs     # 템플릿 자동 생성
```

---

## 4. 빌드 시스템

### 4.1 esbuild.config.mjs — 3개 번들 생성

| 소스 | 산출물 | 용도 |
|------|--------|------|
| `src/mcp/server.ts` | `bridge/mcp-server.cjs` | MCP 서버 (도구 노출) |
| `src/hooks/gate.ts` | `scripts/gate.cjs` | 통합 훅 (이벤트 처리) |
| `src/statusline/statusline.ts` | `scripts/statusline.cjs` | 상태라인 UI |

공통: `platform: 'node'`, `target: 'node20'`, `format: 'cjs'`, `sourcemap: true`, `external: ['@ast-grep/napi']`

빌드 마지막에 `generate-template.mjs` 실행:
1. `agents/*.md` frontmatter 파싱 → 에이전트 테이블 생성
2. `skills/*/SKILL.md` frontmatter 파싱 → 스킬 테이블 생성
3. `src/data/tags.json` → 태그 테이블 생성
4. 결과를 `templates/nexus-section.md`에 저장
5. 프로젝트 `CLAUDE.md`의 `<!-- NEXUS:START -->...<!-- NEXUS:END -->` 마커 내부를 자동 업데이트

### 4.2 dev-sync.mjs — 로컬 개발 캐시 동기화

빌드 산출물을 2곳에 복사:
1. `~/.claude/plugins/marketplaces/nexus/` (마켓플레이스)
2. `~/.claude/plugins/cache/nexus/claude-nexus/{version}/` (캐시)

**개발 사이클**: `src/ 수정 → bun run dev (빌드+동기화) → 다른 프로젝트에서 즉시 테스트`

### 4.3 release.mjs — 전자동 릴리스

```
pre-flight → 커밋 기반 semver 자동 결정 → 3곳 버전 범프
→ CHANGELOG 자동 생성 → 빌드+타입체크+E2E → 커밋
→ 태그+push → npm publish → GitHub Release → dev-sync
```

---

## 5. 훅 시스템 (gate.ts)

### 5.1 단일 진입점 원칙

`gate.ts` 하나가 **6개 이벤트**를 모두 처리한다. `hooks.json`에서 모든 이벤트가 같은 `scripts/gate.cjs`를 실행하되, 환경변수와 페이로드로 분기.

**이유**: 상태 판단이 이벤트 간 교차됨 (UserPromptSubmit과 PreToolUse 모두 tasks.json 확인). 단일 파일이면 로직 공유 + 일관성 보장.

### 5.2 이벤트 라우팅

```
NEXUS_EVENT=SessionStart    → handleSessionStart
NEXUS_EVENT=SubagentStart   → handleSubagentStart  
NEXUS_EVENT=SubagentStop    → handleSubagentStop
else:
  event에 tool_name 있음   → handlePreToolUse
  event에 prompt 있음      → handleUserPromptSubmit
  둘 다 없음               → handleStop
```

### 5.3 SessionStart — 세션 초기화

- `.nexus/` 디렉토리 구조 보장 (`ensureNexusStructure`)
- `agent-tracker.json`을 `[]`로 초기화 (이전 세션 잔류 방지)
- 응답: `pass()`

### 5.4 UserPromptSubmit — 키워드 감지 + 컨텍스트 주입

가장 복잡한 핸들러. 실행 흐름:

```
1. CLAUDE.md 자동 동기화 — 템플릿과 마커 비교, 다르면 업데이트
2. tasks.json 리마인더 계산 — pending 상태, all completed 안내
3. meet.json 리마인더 계산 — 활성 세션 상태 표시
4. 태그/키워드 감지 (우선순위 순):
   a. [d]     → meet.json 있으면 nx_meet_decide 안내, 없으면 차단
   b. 참석자 소환 → nx_meet_join 안내
   c. [rule]  → 규칙 저장 모드
   d. [meet]  → Meet 모드 (기존/신규 세션 분기)
   e. [run]   → Run 모드 (nx-run 스킬 강제 로드)
5. 폴백 (태그 없음):
   - tasks.json 없음 → TASK PIPELINE + Branch Guard
   - pending > 0     → 스마트 resume
   - all completed   → stale cycle 감지
```

**오탐 방지**: 에러/버그 맥락("fix meet bug"), 질문 맥락("what is meet"), 인용 맥락(`` `meet` ``)에서는 태그 감지를 건너뜀.

**응답 패턴**: 항상 `respond({ continue: true, additionalContext: "<nexus>...</nexus>" })`. `withNotices()`로 여러 알림을 병합:

```typescript
function withNotices(base, tasksReminder, claudeMdNotice, meetReminder) {
  return [meetReminder, tasksReminder, base, claudeMdNotice].filter(Boolean).join('\n');
}
```

### 5.5 PreToolUse — 도구 사용 전 검증

3가지 도구 유형을 검증:

#### Edit/Write 도구
```
isNexusInternalPath? → 허용 (.nexus/state/, .claude/settings.json, CLAUDE.md 등)
tasks.json 없음?     → block ("nx_task_add 먼저")
all completed?       → block ("nx_task_close 또는 nx_task_add")
그 외               → pass
```

#### nx_meet_start MCP 도구 (v0.19.0 추가)
```
attendees에 비-Lead 에이전트 있음?
  → agent-tracker.json에서 team_name이 있는 running/team-spawning 에이전트 확인
    → 없으면 block ("TeamCreate로 팀 먼저 생성")
    → 있으면 pass
attendees 없거나 Lead만?
  → pass (리드 단독 미팅 허용)
```

#### Agent 도구
```
subagent_type: 'Explore'?  → 항상 pass
team_name 있음?            → agent-tracker에 team-spawning 기록 후 pass
[run] 모드?                → team_name 없으면 block
그 외                      → pass
```

### 5.6 Stop — 미완료 태스크 차단

```
tasks.json 없음?      → pass (종료 허용)
pending > 0?          → continue: true (nonstop — 종료 차단)
all completed?:
  stop-warned 없음?   → stop-warned 생성 + "nx_task_close" 안내 + continue: true
  stop-warned 있음?   → stop-warned 삭제 + pass (무한루프 방지 — 2회차에 해제)
```

### 5.7 SubagentStart/Stop — 에이전트 추적

- **Start**: agent-tracker.json에서 agent_type 매칭으로 `team-spawning` 엔트리 검색 → 있으면 `running`으로 업데이트 + agent_id 기록, 없으면 새 엔트리 추가
- **Stop**: `completed` + `last_message` + `stopped_at` 기록

### 5.8 훅 I/O 프로토콜

```
입력: stdin → JSON (이벤트 페이로드)
출력: stdout → JSON (응답)

응답 유형:
  { continue: true }                              → pass (계속)
  { continue: true, additionalContext: "..." }     → 컨텍스트 주입
  { decision: "block", reason: "..." }             → 도구 차단 (PreToolUse 전용)
```

---

## 6. MCP 서버 구조

### 6.1 진입점 (server.ts)

`@modelcontextprotocol/sdk`의 `McpServer` + `StdioServerTransport` 사용. 서버 이름: `nx`. 8개 도구 등록 모듈을 순서대로 호출하여 총 27개 도구 등록.

### 6.2 도구 모듈 상세

#### meet.ts — 미팅 세션 관리 (6개 도구)

| 도구 | 역할 | 핵심 로직 |
|------|------|-----------|
| `nx_meet_start` | 세션 생성 | 기존 meet.json → history.json 자동 아카이브. `research_summary` 필수 (리서치 강제). history에서 마지막 id+1 |
| `nx_meet_status` | 상태 조회 | 안건 수, 참석자, 결정사항 요약 |
| `nx_meet_update` | 안건 관리 | add/remove/edit/reopen 4개 액션 |
| `nx_meet_discuss` | 논의 기록 | **speaker 검증**: attendees에 등록된 role만 허용. "lead"/"user"는 항상 허용. pending → discussing 자동 전환 |
| `nx_meet_decide` | 결정 기록 | issue.status = 'decided'. 모든 안건 decided 시 "[run] 또는 [rule]" 안내 |
| `nx_meet_join` | 참석자 추가 | 중복 방지 |

**meet.json 스키마**:
```typescript
interface MeetFile {
  id: number;                    // 단순 숫자 (history 추적용)
  topic: string;
  attendees: MeetAttendee[];     // { role, name, joined_at }
  issues: MeetIssue[];           // { id, title, status, discussion[], decision? }
  research_summary?: string;
  created_at: string;
}
```

#### task.ts — 태스크 관리 (4개 도구)

| 도구 | 역할 | 핵심 로직 |
|------|------|-----------|
| `nx_task_add` | 태스크 추가 | `meet_issue`로 안건 연결, `owner`로 에이전트 할당, `deps`로 의존관계 |
| `nx_task_list` | 목록 조회 | summary (total, completed, pending, blocked, ready) |
| `nx_task_update` | 상태 변경 | pending/in_progress/completed |
| `nx_task_close` | 사이클 종료 | meet+tasks → history.json 아카이브 → 소스 파일 삭제. `memoryHint` 반환 |

**memoryHint**: `{ taskCount, decisionCount, hadLoopDetection, cycleTopics }` — 교훈 기록 트리거. Lead가 이 힌트를 기반으로 memory/ 계층에 기록 여부 판단.

#### core-store.ts — 4계층 지식 관리

| 도구 | 역할 | 모드 |
|------|------|------|
| `nx_core_read` | 지식 읽기 | 전체 개요 / 계층 목록 / 특정 토픽 전문 / 크로스레이어 태그 검색 |
| `nx_core_write` | 지식 쓰기 | layer/topic/content. `<!-- tags: ... -->` 프론트매터 자동 생성 |

인메모리 캐시 (filePath → content).

#### briefing.ts — 역할별 브리핑 조립

`nx_briefing(role, hint?)`: MATRIX 테이블로 역할별 계층 접근 권한 결정 → 해당 계층 파일 읽기 → decisions + rules + 4계층 문서를 마크다운으로 조립.

**MATRIX 예시**:
```
Engineer: identity ✗, codebase ✓(hint), reference ✗, memory ✓(hint)
Researcher: identity ✓, codebase ✗, reference ✓, memory ✓
Architect: identity ✓, codebase ✓, reference ✓, memory ✓ (전체 접근)
```

`hint` 파라미터로 태그 기반 필터링 — 관련 문서만 포함하여 토큰 절약.

#### 기타 모듈

| 모듈 | 도구 | 역할 |
|------|------|------|
| `markdown-store.ts` | `nx_rules_read/write` | 범용 마크다운 저장소 팩토리. rules에 사용 |
| `context.ts` | `nx_context` | branch, activeMode, tasksSummary 반환 |
| `artifact.ts` | `nx_artifact_write` | `.nexus/state/artifacts/`에 파일 저장 |
| `lsp.ts` | 9개 LSP 도구 | hover, goto, refs, diagnostics, rename, code_actions, symbols |
| `ast.ts` | `nx_ast_search/replace` | ast-grep 기반 구조 검색/치환 |

### 6.3 도구 간 의존관계

```
meet.ts ← task.ts    (readMeet, MeetFile 타입 — nx_task_close에서 meet 아카이브)
모든 도구 ← shared/paths.ts   (STATE_ROOT, NEXUS_ROOT, CORE_ROOT)
모든 도구 ← shared/mcp-utils.ts (textResult)
briefing.ts — core-store.ts와 같은 파일 시스템 접근 (직접 import 없지만 같은 경로)
```

---

## 7. 상태 관리 패턴

### 7.1 3가지 저장 영역

| 영역 | 경로 | Git | 수명 | 용도 |
|------|------|-----|------|------|
| **Core** | `.nexus/core/{layer}/` | ✓ | 영구 | 프로젝트 지식 (4계층) |
| **Rules** | `.nexus/rules/` | ✓ | 영구 | 팀 규칙/컨벤션 |
| **State** | `.nexus/state/` | ✗ | 세션/사이클 | 런타임 상태 |

### 7.2 "파일 존재 = 상태 활성" 패턴

이것이 Nexus 상태 관리의 핵심 원칙이다:

| 파일 | 존재 의미 | 부재 의미 |
|------|-----------|-----------|
| `state/meet.json` | 미팅 세션 활성 | 미팅 없음 |
| `state/tasks.json` | 태스크 사이클 활성 | 태스크 없음 |
| `state/stop-warned` | Stop 경고 1회 발생 | 미발생 |
| `state/agent-tracker.json` | 에이전트 추적 중 | 세션 미시작 |

gate.ts는 이 파일들의 **존재 여부**로 모든 상태 판단을 수행:
- `tasks.json` 존재 + `meet.json` 부재 → `[run]` 모드
- `meet.json` 존재 → 미팅 세션 활성 → meetReminder 주입
- `stop-warned` 존재 → 2번째 Stop → pass (무한루프 방지)

### 7.3 상태 전이 다이어그램

```
[meet] 시작
  → nx_meet_start → meet.json 생성
  → nx_meet_decide (모든 안건) → meet.json 유지

[run] 전환
  → nx_task_add → tasks.json 생성
  → nx_task_update → tasks.json 내 상태 변경
  
사이클 종료
  → nx_task_close → meet.json + tasks.json → history.json 아카이브 → 삭제
```

### 7.4 history.json — 영구 아카이브

```json
{
  "cycles": [
    {
      "completed_at": "ISO 8601",
      "branch": "fix/some-bug",
      "meet": { /* MeetFile 전체 */ },
      "tasks": [ /* TaskItem[] 전체 */ ]
    }
  ]
}
```

Git 추적됨. 모든 과거 사이클의 결정+태스크 영구 보존.

### 7.5 .gitignore 전략

`.nexus/.gitignore`:
```
*           # 기본: 모든 것 무시
!core/      # 예외: 지식
!rules/     # 예외: 규칙
!config.json
!history.json
!.gitignore
```

---

## 8. 에이전트 설계

### 8.1 3 카테고리 체계

| 카테고리 | 역할 | 모델 | 코드 수정 | 태스크 관리 |
|----------|------|------|-----------|-------------|
| **HOW** | 판단, 설계, 리뷰 | opus (고급) | ✗ (차단) | ✗ (차단) |
| **DO** | 구현, 조사, 작성 | sonnet (빠름) | ✓ | ✗ (추가만 차단) |
| **CHECK** | 검증, 테스트 | sonnet (빠름) | ✓ | ✗ (추가만 차단) |

**설계 이유**: 
- HOW 에이전트가 직접 코드를 수정하면 설계와 구현의 경계가 무너짐
- 태스크 생성은 Lead 전용 (단일 진실 소스 — Lead만이 태스크를 생성/관리)

### 8.2 에이전트 카탈로그

| 에이전트 | 카테고리 | 모델 | maxTurns | 역할 |
|----------|----------|------|----------|------|
| Architect | HOW | opus | 25 | 기술 설계, 코드 리뷰, 아키텍처 검증 |
| Designer | HOW | opus | 25 | UI/UX 설계, 인터랙션 패턴 |
| Postdoc | HOW | opus | 25 | 연구 방법론, 증거 평가, 합성 |
| Strategist | HOW | opus | 25 | 비즈니스 전략, 시장 분석 |
| Engineer | DO | sonnet | 25 | 코드 구현, 디버깅, codebase/ 즉시 업데이트 |
| Researcher | DO | sonnet | 20 | 웹 검색, 독립 조사, reference/ 즉시 기록 |
| Writer | DO | sonnet | 25 | 기술 문서, 프레젠테이션 |
| QA | CHECK | sonnet | 20 | 코드 검증, 테스트, 보안 리뷰 |
| Reviewer | CHECK | sonnet | 20 | 콘텐츠 검증, 출처 확인, 문법/포맷 교정 |

### 8.3 disallowedTools 패턴

| 카테고리 | 차단 도구 | 의미 |
|----------|-----------|------|
| HOW (architect, designer, strategist) | Edit, Write, NotebookEdit, nx_task_add, nx_task_update | 코드 수정 불가 + 태스크 관리 불가 |
| HOW (postdoc) | Edit, Bash, NotebookEdit, nx_task_add, nx_task_update | 코드/셸 불가 |
| DO (engineer, writer, researcher) | nx_task_add | 태스크 추가 불가 |
| CHECK (qa, reviewer) | nx_task_add | 태스크 추가 불가 |

### 8.4 에이전트 정의 파일 구조

```yaml
# agents/architect.md
---
name: architect
model: opus
description: "Technical design — evaluates How, reviews architecture..."
task: "Architecture, technical design, code review"
maxTurns: 25
disallowedTools:
  - Edit
  - Write
  - NotebookEdit
  - mcp__plugin_claude-nexus_nx__nx_task_add
  - mcp__plugin_claude-nexus_nx__nx_task_update
tags: [architecture, design, review]
alias_ko: 아키텍트
category: how
---

<role>
...역할 설명...
</role>

<constraints>
- NEVER...
- MUST...
</constraints>

<guidelines>
...상세 지침...
</guidelines>
```

### 8.5 2개 파이프라인

```
코드 파이프라인:  Architect/Designer → Engineer → QA
콘텐츠 파이프라인: Postdoc/Strategist → Researcher/Writer → Reviewer
```

### 8.6 에이전트 생명주기

```
meet 세션: HOW 에이전트 소환 → 논의 → 결정
  ↓ [run] 전환
run 세션: HOW 에이전트 유지 (설계 조언)
          DO 에이전트 스폰 (실행)
          CHECK 에이전트 스폰 (검증, 조건부)
  ↓ 완료
         DO/CHECK 에이전트 종료
         HOW 에이전트는 세션 수명 — 사용자가 종료
```

---

## 9. 스킬 설계

### 9.1 스킬 카탈로그

| 스킬 | 트리거 | 용도 |
|------|--------|------|
| **nx-meet** | `[meet]` | 팀 미팅 — 의도 발견, 논의, 결정 |
| **nx-run** | `[run]` | 실행 파이프라인 — 5단계 (intake→design→execute→verify→complete) |
| **nx-init** | `/claude-nexus:nx-init` | 프로젝트 온보딩 — 스캔 → 지식 생성 |
| **nx-setup** | `/claude-nexus:nx-setup` | 대화형 설정 위저드 |
| **nx-sync** | `/claude-nexus:nx-sync` | 코어 지식 동기화 |

### 9.2 SKILL.md 구조

```yaml
---
name: nx-meet
description: "Team meeting facilitation..."
trigger_display: "[meet]"
purpose: "Team discussion — convene agents, deliberate, decide"
triggers: ["meet", "미팅", "회의", ...]
---

<role>
...스킬의 역할 정의...
</role>

<constraints>
- NEVER execute — this skill is discussion only
- MUST use TeamCreate when attendees include non-Lead agents
...
</constraints>

<guidelines>
## Procedure
### Step 1: Intent Discovery
...
### Step 2: Research
...
</guidelines>
```

### 9.3 nx-run 실행 파이프라인 (5단계)

```
Phase 1: Intake    — Lead가 의도 확인, Branch Guard
Phase 2: Design    — Lead + HOW 에이전트 (기본 skip, 에스컬레이션 시 활성)
Phase 3: Execute   — DO 에이전트 (태스크 등록 → 구현)
Phase 4: Verify    — Lead + CHECK 에이전트 (QA 자동 스폰 조건 4가지)
Phase 5: Complete  — nx-sync → nx_task_close → 에이전트 종료 → 보고
```

**QA 자동 스폰 조건** (하나라도 해당 시):
1. 변경 파일 3개 이상
2. 기존 테스트 파일 수정
3. 외부 API/DB 접근 코드 변경
4. 해당 영역에 실패 이력 존재 (memory/)

**롤백 규칙**:
- Phase 4에서 코드 문제 → Phase 3으로 (태스크 reopen)
- Phase 4에서 설계 문제 → Phase 2로 (Design 단계 활성화)

---

## 10. 컨텍스트 엔지니어링

### 10.1 4계층 지식 구조

```
identity/   — 철학, 미션, 설계 원칙, 로드맵
codebase/   — 코드 구조, 아키텍처, 오케스트레이션, 도구
reference/  — 외부 조사 결과, 경쟁 분석
memory/     — 과거 교훈, 실패 패턴
```

**업데이트 책임**:
| 계층 | 업데이트 주체 | 타이밍 |
|------|-------------|--------|
| identity | 사용자 확인 후 Nexus | 프로젝트 방향 변경 시 |
| codebase | Engineer | 코드 수정 즉시 |
| reference | Researcher | 조사 완료 즉시 |
| memory | 자동 (task_close) | 사이클 종료 시 |

### 10.2 MATRIX 기반 브리핑

`nx_briefing(role, hint?)` 호출 시 역할별 접근 매트릭스에 따라 필요한 정보만 조립:

```
Architect: 전체 접근 (설계 판단에 전체 맥락 필요)
Engineer:  codebase + memory만 (hint 필터링, 실행에 집중)
Researcher: identity + reference + memory (코드 불필요)
```

`hint` 파라미터: `<!-- tags: gate, orchestration -->` 태그로 관련 문서만 필터링 → 불필요한 정보 제거 → 토큰 절약.

### 10.3 rules/ 태그 필터링

```markdown
<!-- tags: dev -->
# Dev Rules

## Coding Conventions
...
```

`nx_briefing(role: "engineer", hint: "dev")` → dev 태그가 있는 규칙만 브리핑에 포함.

### 10.4 Structured Delegation 포맷

Lead가 에이전트에게 태스크를 위임할 때 사용하는 4섹션 구조:

```
TASK: {구체적인 산출물}

CONTEXT:
- Current state: {관련 코드/문서 위치}
- Dependencies: {선행 태스크 결과}
- Prior decisions: {관련 결정사항}
- Target files: {대상 파일 경로}

CONSTRAINTS:
- {제약 1}
- {제약 2}

ACCEPTANCE:
- {완료 기준 1}
- {완료 기준 2}
```

---

## 11. Claude Code 플러그인 포맷

### 11.1 디렉토리 구조

```
.claude-plugin/
├── plugin.json       # 매니페스트
└── marketplace.json  # 마켓플레이스 등록
```

**plugin.json**:
```json
{
  "name": "claude-nexus",
  "version": "0.19.0",
  "description": "...",
  "author": "moreih29",
  "license": "MIT",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json"
}
```

### 11.2 hooks.json — 이벤트 매핑

```json
{
  "hooks": {
    "SessionStart": [{ "matcher": "*", "hooks": [{ 
      "type": "command", 
      "command": "NEXUS_EVENT=SessionStart node \"$CLAUDE_PLUGIN_ROOT\"/scripts/gate.cjs",
      "timeout": 5 
    }] }],
    "PreToolUse": [
      { "matcher": "Edit", ... },
      { "matcher": "Write", ... },
      { "matcher": "Agent", ... },
      { "matcher": "mcp__plugin_claude-nexus_nx__nx_task_update", ... },
      { "matcher": "mcp__plugin_claude-nexus_nx__nx_task_close", ... }
    ],
    "UserPromptSubmit": [{ "matcher": "*", ... }],
    "Stop": [{ "matcher": "*", ... }],
    "SubagentStart": [{ "matcher": "*", ... }],
    "SubagentStop": [{ "matcher": "*", ... }]
  }
}
```

**matcher**: `"*"` (모든 호출), `"Edit"` (특정 도구), `"mcp__plugin_..."` (MCP 도구).

### 11.3 훅 I/O 프로토콜 상세

```
입력: 프로세스 stdin → JSON
  - UserPromptSubmit: { prompt: "사용자 입력" }
  - PreToolUse: { tool_name: "Edit", tool_input: { file_path: "..." } }
  - Stop: {} (빈 객체)
  - SessionStart/SubagentStart/Stop: 환경변수 NEXUS_EVENT로 구분

출력: 프로세스 stdout → JSON
  - pass:    { continue: true }
  - inject:  { continue: true, additionalContext: "..." }
  - block:   { decision: "block", reason: "..." }
```

### 11.4 .mcp.json

```json
{
  "mcpServers": {
    "nx": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bridge/mcp-server.cjs"]
    }
  }
}
```

`CLAUDE_PLUGIN_ROOT`: Claude Code가 플러그인 실행 시 주입하는 환경변수.

---

## 12. 핵심 설계 결정과 이유

### (1) gate.ts 하나로 모든 훅 처리

**결정**: 6개 이벤트를 단일 파일에서 처리.

**이유**: 
- 상태 판단이 이벤트 간 교차 (UserPromptSubmit과 PreToolUse 모두 tasks.json 확인)
- 단일 파일이면 `readTasksSummary`, `getMeetReminder` 같은 상태 읽기 로직 공유
- 빌드 산출물 1개 → 배포/디버깅 단순화
- 이벤트 간 일관성 자동 보장

### (2) MCP 도구로 상태 관리 (파일 직접 접근 대신)

**결정**: 에이전트가 `Edit/Write`로 meet.json/tasks.json을 직접 수정하는 것이 아닌, MCP 도구를 통해서만 조작.

**이유**:
- 스키마 무결성 보장 (잘못된 JSON 방지)
- 비즈니스 로직 보장 (자동 전이: pending→discussing, 자동 아카이브)
- 입력 검증 (Zod 스키마)
- 부가: 도구 호출이 로깅됨 → 감사 추적

### (3) agent-tracker를 파일 기반으로

**결정**: 에이전트 추적을 인메모리가 아닌 `.nexus/state/agent-tracker.json`으로.

**이유**:
- 훅(gate.cjs)은 매 호출마다 새 프로세스로 실행 → **인메모리 상태 불가**
- MCP 서버는 장기 실행이지만 훅은 아님
- 파일이 훅과 MCP 서버 간 유일한 공유 상태
- SessionStart에서 `[]`로 초기화 → 세션 간 잔류 방지

### (4) Task pipeline이 Edit/Write를 차단

**결정**: tasks.json 없이는 코드 수정 불가.

**이유**:
- "태스크 없이 수정 = 추적 안 되는 변경"
- 모든 코드 변경이 태스크에 연결 → 이력 추적 가능
- 예외: `.nexus/state/`, `CLAUDE.md` 등 인프라 파일은 태스크 없이 허용

### (5) How/Do/Check 카테고리

**결정**: 3 카테고리로 에이전트 분류, disallowedTools로 강제.

**이유**:
- HOW = "어떻게" → opus, 코드 수정 불가 → 설계와 구현의 경계 유지
- DO = "실행" → sonnet, 코드 수정 가능 → 실행 속도 우선
- CHECK = "검증" → sonnet, 리포트만 → 독립적 품질 검증

**실용적 효과**: HOW 에이전트가 "내가 직접 고치는 게 빠르겠다"며 코드를 수정하는 것을 플랫폼 레벨에서 차단.

### (6) 리드 단독 미팅 허용

**결정**: `[meet]` 모드에서 에이전트 없이 리드만으로 미팅 가능.

**이유**:
- meet.json의 결정사항이 `[run]` 전환 시 context로 사용됨
- "논의하고 결정하는 자리"라는 의미 자체가 가치
- 에이전트 스폰 오버헤드 없이 결정 기록 가능

### (7) meet → run 전환 시 에이전트 보존 전략

**결정**: HOW 에이전트는 유지, DO/CHECK는 해산.

**이유**:
- HOW 에이전트는 설계 결정의 맥락을 보유 → run 중 설계 질문 시 즉시 답변 가능
- DO/CHECK는 run에서 새로 스폰 (태스크별 맥락이 다름)

---

## 13. 이식 가이드: 플랫폼 의존 vs 범용

### 13.1 반드시 재구현해야 하는 것 (플랫폼 의존)

| 기능 | Claude Code API | 이식 시 필요한 것 |
|------|----------------|-------------------|
| **Hooks API** | hooks.json, stdin/stdout JSON | 이벤트 감지 + 응답 메커니즘. opencode의 이벤트 시스템에 맞춰 재구현 |
| **Agent/TeamCreate/SendMessage** | Claude Code 내장 도구 | 멀티에이전트 스폰, 팀 생성, 에이전트 간 메시징. opencode의 에이전트 API 사용 |
| **MCP 프로토콜** | @modelcontextprotocol/sdk | opencode가 MCP를 지원하면 재사용 가능. 도구 이름 매핑은 플랫폼별 |
| **플러그인 포맷** | .claude-plugin/ | opencode의 플러그인/확장 시스템에 맞춰 변환 |
| **Skills 시스템** | skills/*/SKILL.md | opencode의 프롬프트 로딩 메커니즘에 맞춰 변환 |
| **에이전트 정의** | agents/*.md frontmatter | model/maxTurns/disallowedTools → opencode의 에이전트 설정 방식 |
| **additionalContext** | 훅 응답 필드 | opencode의 시스템 프롬프트 주입 방식 |
| **CLAUDE_PLUGIN_ROOT** | 환경변수 | opencode의 플러그인 경로 해결 방식 |

### 13.2 그대로 가져갈 수 있는 것 (범용 패턴)

| 패턴 | 설명 | 이식 비용 |
|------|------|-----------|
| **"파일 존재 = 상태 활성" 패턴** | meet.json/tasks.json/stop-warned. 어떤 플랫폼이든 파일 I/O만 있으면 됨 | 없음 |
| **4계층 지식 관리** | identity/codebase/reference/memory. 태그 기반 검색. Git 추적 | 없음 |
| **MATRIX 기반 브리핑** | 역할별 지식 접근 권한 매트릭스 | JSON 테이블 정의 |
| **How/Do/Check 카테고리** | 판단/실행/검증 역할 분리 | 도구 차단 메커니즘은 플랫폼별 |
| **태그 시스템** | [meet], [d], [run], [rule]. 자연어 + 명시적 태그 + 오탐 방지 | 정규식 파싱 로직 |
| **Task pipeline** | meet → decisions → tasks → execute → verify → close → archive | 도구 차단은 플랫폼별, 워크플로우는 범용 |
| **history.json 아카이브** | 사이클 단위 아카이브 (meet+tasks) | JSON 파일 |
| **Structured Delegation** | TASK/CONTEXT/CONSTRAINTS/ACCEPTANCE 위임 포맷 | 프롬프트 패턴 |
| **rules/ 태그 필터링** | `<!-- tags: ... -->`로 규칙 분류 → 브리핑 시 관련 규칙만 포함 | 마크다운 파싱 |
| **memoryHint** | 사이클 종료 시 교훈 기록 트리거 | 메타데이터 패턴 |
| **Agent tracker** | 파일 기반 에이전트 생명주기 추적 | 파일 I/O |
| **오탐 방지 정규식** | 에러/질문/인용 맥락에서 키워드 무시 | 정규식 로직 |
| **템플릿 자동 생성** | agents/skills frontmatter → 시스템 프롬프트 섹션 | 코드 생성 패턴 |
| **meet→run 전환 전략** | HOW 에이전트 유지, DO/CHECK 해산 | 생명주기 관리 |

### 13.3 이식 우선순위 제안

**Phase 1 (코어 — 이것 없으면 의미 없음)**:
1. 상태 파일 패턴 + 상태 전이 로직
2. Task pipeline (도구 차단 메커니즘)
3. 4계층 지식 구조

**Phase 2 (에이전트 — 이것이 차별화)**:
4. How/Do/Check 카테고리 + disallowedTools
5. MATRIX 기반 브리핑
6. Structured Delegation 포맷

**Phase 3 (워크플로우 — 사용자 경험)**:
7. 태그 시스템 + 키워드 감지
8. meet → run 파이프라인
9. history.json 아카이브 + memoryHint

**Phase 4 (코드 인텔리전스 — 보너스)**:
10. LSP 통합
11. AST 검색/치환

---

## 부록: 주요 파일 경로 참조

| 파일 | 역할 |
|------|------|
| `src/hooks/gate.ts` | 통합 훅 핸들러 — 모든 이벤트 처리 |
| `src/mcp/server.ts` | MCP 서버 진입점 |
| `src/mcp/tools/plan.ts` | Plan 세션 관리 (8개 도구) |
| `src/mcp/tools/task.ts` | 태스크 관리 (4개 도구) |
| `src/mcp/tools/briefing.ts` | MATRIX 기반 역할별 브리핑 |
| `src/mcp/tools/core-store.ts` | 4계층 지식 CRUD |
| `src/shared/hook-io.ts` | 훅 I/O 프로토콜 (readStdin, respond, pass) |
| `src/shared/paths.ts` | 경로 상수 + 디렉토리 보장 |
| `hooks/hooks.json` | 이벤트 매핑 정의 |
| `agents/*.md` | 에이전트 정의 (frontmatter + 프롬프트) |
| `skills/*/SKILL.md` | 스킬 정의 (frontmatter + 절차) |
| `.nexus/core/identity/design.md` | 설계 원칙 문서 |
| `.nexus/core/identity/mission.md` | 미션 문서 |
| `.nexus/core/codebase/orchestration.md` | 오케스트레이션 상세 문서 |
| `.nexus/core/memory/identity-redesign-session.md` | 자율→사용자주도 전환 교훈 |
