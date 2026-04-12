<!-- tags: codebase, agents, skills, orchestration, pipeline -->
# 에이전트, 스킬, 오케스트레이션

## 1. 에이전트 카탈로그

모든 에이전트는 `NexusAgentProfile` 타입으로 정의된다. 카테고리는 `how / do / check` 세 가지.

### HOW 에이전트 — 자문 역할, 파일 수정 불가

| ID | 이름 | 설명 | 금지 도구 |
|---|---|---|---|
| `architect` | Architect | 아키텍처 및 기술 설계 검토 | edit, write, patch, multiedit, nx_task_add, nx_task_update |
| `designer` | Designer | UI/UX 및 인터랙션 설계 결정 | edit, write, patch, multiedit, nx_task_add, nx_task_update |
| `postdoc` | Postdoc | 연구 방법론 및 증거 합성 | edit, write, patch, multiedit, bash, nx_task_add, nx_task_update |
| `strategist` | Strategist | 비즈니스 및 제품 전략 검토 | edit, write, patch, multiedit, nx_task_add, nx_task_update |

### DO 에이전트 — 실행 역할

| ID | 이름 | 설명 | 금지 도구 |
|---|---|---|---|
| `engineer` | Engineer | 구현 및 디버깅 | nx_task_add |
| `researcher` | Researcher | 독립적인 웹 및 문서 조사 | nx_task_add |
| `writer` | Writer | 기술 문서 작성 | nx_task_add |

### CHECK 에이전트 — 검증 역할

| ID | 이름 | 설명 | 금지 도구 |
|---|---|---|---|
| `qa` | QA | 검증, 테스트, 품질 검사 | nx_task_add |
| `reviewer` | Reviewer | 팩트체크 및 콘텐츠 검증 | nx_task_add |

### 프라이머리 에이전트 (Nexus)

ID `nexus`. 오케스트레이션 리드. 위임을 기본으로 하되, 단순 질문이나 단일 파일 소규모 변경은 직접 처리.

### 에이전트 프롬프트 구조

에이전트 프롬프트 본체는 `@moreih29/nexus-core`를 canonical source로 하며, 빌드 타임 generator(`scripts/generate-from-nexus-core.mjs`)가 `src/agents/prompts.generated.ts`를 생성한다. `src/agents/prompts.ts`는 이를 re-export하는 thin barrel이다. `src/agents/catalog.ts`(에이전트 메타) 및 `src/skills/catalog.ts`(스킬 메타)는 as-is canonical로 유지된다.

공통 구조: `<role>` → `<constraints>` → `<guidelines>`

- HOW 출력 형식: 현재 상태 / 문제 / 권고안 / 트레이드오프 / 리스크
- CHECK 출력 형식: 수행한 검사 / 항목별 PASS/FAIL / 심각도별 발견 사항 / 권장 조치
- 공통 증거 요건: 주장은 반드시 문서 URL, 코드 경로, 이슈 번호, 또는 커맨드 출력으로 뒷받침

## 2. 스킬 카탈로그

| ID | 트리거 | 목적 |
|---|---|---|
| `nx-plan` | `[plan]` | 구조화된 플래닝 및 결정 기록 |
| `nx-run` | `[run]` | 실행 파이프라인 (intake → design → execute → verify → complete) |
| `nx-init` | `nx-init` | 온보딩 — 코어 구조 및 기반 지식 초기화 |
| `nx-sync` | `nx-sync` | 태스크 사이클 완료 후 코어 지식 동기화 |
| `nx-setup` | `nx-setup` | 설정 마법사 — 권한 및 오케스트레이션 기본값 구성 |

### nx-plan 절차

1. 의도 파악 → 2. 리서치 → 3. 팀 구성 → 4. 이슈별 토론(`nx_plan_discuss`) → 5. 후속 연속성(`nx_plan_followup`) → 6. 옵션 제시 → 7. 결정 기록(`nx_plan_decide`) → 8. 갭 확인 → 9. `[run]` 전환 제안

### nx-run 흐름

1. **Intake** — 방향 확인, plan 결정 검토, 브랜치 가드
2. **Design** — 필요 시 HOW 에이전트 투입
3. **Execute** — 태스크 분해, `nx_task_add` 등록, 구조화된 페이로드로 위임
4. **Verify** — 빌드·커맨드 확인, QA/Reviewer 트리거
5. **Complete** — `nx_sync`, `nx_task_close`로 사이클 종료

위임 페이로드: `TASK / CONTEXT / CONSTRAINTS / ACCEPTANCE`

병렬화: 파일이 겹치지 않는 독립 태스크는 병렬, 겹치면 직렬.

## 3. 오케스트레이션 모델

### 코어 상태

파일 기반 JSON 저장소 (`.nexus/state/orchestration.opencode.json`). 각 인보케이션은 `invocation_id`, `agent_type`, `status`(running/completed/failed/cancelled), `coordination_label`, `team_name`, `purpose`, `continuity`, 타임스탬프를 포함.

### 위임 흐름

`buildDelegationTemplate()`이 구조화된 위임 텍스트 생성. 입력: task, currentState, dependencies, priorDecisions, targetFiles, constraints, acceptance.

### 연속성 관리

- `registerStart` / `registerEnd` — 인보케이션 생애주기 등록
- `pickContinuity` — agent_type + coordination_label로 재개 가능한 인보케이션 선택
- `buildDelegationPlan` — 연속성이 있으면 resume_task_id, resume_session_id 포함

### 팀 정책

- `requiresTeamInRunMode` — do/check 에이전트는 run 모드에서 팀 레이블 필수
- `canJoinMeetWithoutTeam` — lead만 팀 없이 plan 참여 가능

### Plan / Run 연속성 어댑터

- Plan: `coordination_label=plan-panel` + `agent_type` 조합 우선 조회
- Run: agent_type + coordination_label 조합 우선 → agent_type만으로 fallback. 재개 필드 자동 주입

## 4. 파이프라인

### Evaluator

태스크 사이클 상태: `none` → `empty` → `active` → `completed-open`

| 출력 | 조건 |
|------|------|
| `editsAllowed` | empty 또는 active일 때만 true |
| `canCloseCycle` | completed-open일 때만 true |
| `shouldTriggerQa` | canCloseCycle이고 QA 신호 존재 |
| `nextGuidanceKey` | 다음 행동 지침 키 |

### QA 자동 트리거

`git diff --name-only`로 변경 파일 조회. 트리거 조건: 변경 파일 3개 이상, 테스트 파일 변경, API/DB 영역 변경, 과거 실패 신호.

---

### 운영 규칙 (from docs/operations.md)

#### 절차적 기대 (Procedural Expectations)

- `[plan]`은 토론 전용 모드. 리서치를 먼저 하고 meeting을 시작하거나 재개할 것.
- `[run]`은 태스크 기반 모드. `tasks.json`을 실행의 단일 소스 오브 트루스로 취급.
- Branch Guard: run 모드에서 `main` / `master`에 직접 실질적 작업을 하지 않는다.

#### 인스트럭션 파일 (Instruction Files)

- OpenCode 기본 인스트럭션 경로: `AGENTS.md` + `opencode.json.instructions`
- `CLAUDE.md`는 `nx_init` 마이그레이션 입력으로만 스캔됨. 런타임 인스트럭션 소스가 아님.

#### 호환성 주의사항 (Compatibility Notes)

- `plan.json`은 canonical하고 플랫폼 중립. OpenCode 전용 연속성 데이터는 `plan.opencode.json`에 저장.
- `plan.opencode.json`은 best-effort. 없거나 무시되더라도 OpenCode는 canonical `.nexus` 파일만으로 계속 동작해야 함.
- Claude ↔ OpenCode 전환은 canonical-first handoff로 취급. 동시 공동 편집이 아님.

#### HOW 패널 연속성 절차 (HOW-panel Continuity)

- HOW 서브에이전트 호출 시 OpenCode는 `task_id` / `session_id` 핸들을 `plan.opencode.json` 사이드카에 저장.
- 후속 질문 전에 `nx_plan_resume`으로 현재 재개 핸들과 마지막 요약을 확인. `recommendation` 페이로드로 기존 참가자 재개 vs 요약 기반 재수화 여부 판단.
- 위임 준비된 후속 가이던스가 필요하면 `nx_plan_followup` 사용 — 연속성 데이터를 구체적인 프롬프트와 suggested resume handle 필드로 패키징.
- `nx_context` / `nx_plan_status`는 follow-up 준비된 HOW 역할을 노출하므로 후속 질문 전에 참조 가능.
