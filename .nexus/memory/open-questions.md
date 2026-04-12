# 04-OPEN_QUESTIONS.md — opencode-nexus 미결 사항

> **선행 필독**: `../00-ECOSYSTEM_PRIMER.md`, `01-BRIEFING.md`, `02-DECISIONS.md`, `03-IMPLEMENTATION_GUIDE.md`

이 문서는 plan session #1에서 결정되지 않았거나, 결정은 있으나 구체적 실행 방식이 미정인 항목을 기록한다. 각 항목은 별도 [plan] 세션 또는 엔지니어링 세션에서 논의가 필요하다.

---

## Q1: Phase 1 → Phase 1b → Phase 2 전환 순서와 진입 조건

### 무엇을 논의해야 하는가

Phase 1은 opencode-nexus가 nexus-core를 처음 소비하는 단계다. Phase 1b는 nexus-code가 nexus-core consumer로 합류하는 단계다. Phase 2는 claude-nexus가 합류하는 단계다. 이 세 단계의 구체적 순서와 각 단계 진입 기준이 정의되어 있지 않다.

Primer §5.2는 Phase 2 trigger 조건이 "참고 지표일 뿐 엄격한 게이트가 아니다"라고 완화하고 있으나, Phase 1 완료의 정의 자체가 없다.

논의 필요 사항:
- "Phase 1 완료"의 정의: bridge 계획 §8 항목을 모두 완료해야 하는가, 아니면 핵심 subset(예: tags.yml 동적 등록 + 최소 1개 에이전트 정의 소비)만으로 충분한가?
- Phase 1b와 Phase 2는 직렬인가, 병렬로 진행 가능한가?
- 각 단계 전환을 결정하는 주체와 기준 — 작성자 재량만인가, 아니면 기능적 체크포인트가 있는가?

### 현재 정보 부족분

- bridge 계획 §8의 항목 목록 중 Phase 1 완료로 인정할 최소 기준
- claude-nexus의 현재 상태(Phase 2 진입 전 사전 준비 여부)
- nexus-code가 nexus-core를 소비하기 위해 선행되어야 하는 기술 작업 목록

---

## Q2: bridge §9.2 runtime 배제 원칙의 nexus-code 합류 후 유효성

### 무엇을 논의해야 하는가

bridge 계획 §9.2는 runtime 공유 배제 원칙을 명시한다. 이 원칙은 opencode-nexus가 nexus-core를 빌드 타임에만 소비해야 한다는 것이다.

nexus-code가 3rd consumer로 합류하면서 이 원칙의 적용 범위에 대한 재논의 여지가 생겼다. nexus-code는 장시간 실행되는 워크벤치 앱으로서, nexus-core를 빌드 타임 번들링이 아니라 런타임 파일 읽기 방식으로 소비할 수도 있다.

논의 필요 사항:
- §9.2 원칙이 nexus-code에도 동일하게 적용되어야 하는가?
- nexus-code의 런타임 파일 읽기 방식이 §9.2 위반으로 간주되는가, 아니면 다른 consumer 유형으로 취급되는가?
- opencode-nexus는 §9.2를 그대로 준수한다는 입장이 이번 세션에서 변경되지 않았으나, nexus-code의 다른 접근이 §9.2 재정의를 유도할 가능성이 있는가?

### 현재 정보 부족분

- nexus-code의 예상 nexus-core 소비 방식(빌드 타임 번들 vs 런타임 디렉토리 읽기)
- bridge 계획 §9.2의 원칙이 "모든 consumer"에 적용되는 것인지, "opencode-nexus 전용"인지의 명확한 해석

---

## Q3: opencode-nexus evaluator와 nexus-code ApprovalBridge 간 역할 경계

### 무엇을 논의해야 하는가

opencode-nexus에는 evaluator 컴포넌트가 있다. 이 evaluator는 `editsAllowed` 체크를 통해 에이전트의 파일 수정을 허용 또는 차단하는 패턴을 사용한다(throw 패턴).

nexus-code의 OpenCode adapter는 `POST /permission/:id/reply` 엔드포인트를 통해 외부에서 permission 요청에 응답한다. 이 두 컴포넌트가 동일한 permission 요청 이벤트를 각각 처리하면 이중 가드가 된다.

논의 필요 사항:
- opencode-nexus evaluator의 editsAllowed throw가 발생하면 `permission.asked` 이벤트가 SSE로 방출되는가, 아니면 evaluator가 이를 차단하기 때문에 이벤트가 방출되지 않는가?
- 두 컴포넌트의 전담 영역을 어떻게 나눌 것인가: evaluator는 "세션 내부 정책 집행", ApprovalBridge는 "외부 사용자 승인"으로 분리 가능한가?
- 두 컴포넌트가 각자 독립적으로 전담 영역을 가진다면, 이중 가드가 아니라 계층적 가드다. 이 구분이 명확히 문서화되어 있는가?

### 현재 정보 부족분

- opencode-nexus evaluator의 현재 구현 — editsAllowed throw가 발생하는 시점과 그 이후 OpenCode 내부 처리 흐름
- `permission.asked` SSE 이벤트가 방출되는 정확한 시점(evaluator 실행 전인가, 후인가)
- nexus-code 설계 문서에서 ApprovalBridge가 담당하는 결정 범위 정의

---

## Q4: ACP question tool hang 업스트림 추적 방식

### 무엇을 논의해야 하는가

실험 E4에서 `opencode acp` 모드의 question tool hang 문제가 확인되었다(GitHub issue #17920, PR #13750). 이 문제는 opencode-nexus가 ACP 경로를 사용하는 시나리오에서 직접 영향을 미친다.

현재는 ACP 경로 사용 결정이 내려지지 않았고(nexus-code의 OpenCode adapter 소관), opencode-nexus가 직접 ACP를 사용하지는 않는다. 그러나 이 버그의 상류 해결 여부가 nexus-code adapter 설계 선택(HTTP/SSE vs ACP stdio)에 영향을 미친다.

논의 필요 사항:
- 이 버그의 추적 책임은 누구인가? nexus-code인가, opencode-nexus인가, 아니면 별도 리서처 태스크인가?
- PR #13750의 병합 여부와 배포 버전을 주기적으로 확인하는 방식이 있는가?
- 버그가 해결될 경우 nexus-code의 adapter 설계 결정 재검토를 위한 트리거가 있는가?

### 현재 정보 부족분

- GitHub issue #17920의 현재 상태 및 PR #13750 병합 여부
- OpenCode 배포 주기 및 nexus-code가 참조하는 OpenCode 버전 관리 방침

---

## Q5: src/plugin/hooks.ts의 tags.yml 기반 동적 등록 전환 타이밍

### 무엇을 논의해야 하는가

02-DECISIONS.md §Issue #4에서 hooks.ts의 태그 핸들러 이름은 tags.yml의 handler 필드값과 일치해야 한다고 결정되었다. 전환 시점은 "Phase 1 consume 구현 시점"으로 명시되었다.

그러나 Phase 1 consume 구현이 언제 시작되는지 구체적 일정이 없고, 현재 hooks.ts에 하드코딩된 이름이 tags.yml과 얼마나 다른지도 확인되지 않았다.

논의 필요 사항:
- 현재 hooks.ts의 핸들러 이름 목록과 tags.yml이 정의할 handler 필드값을 사전에 대조해서 불일치 범위를 파악할 필요가 있는가?
- 전환 전까지 하드코딩된 이름이 tags.yml과 다를 경우 어떤 런타임 오류가 발생하는가?
- 동적 등록으로 전환하는 구체적 구현 방식: tags.yml을 import하는가, 아니면 파일 시스템 경로로 읽는가? 이 선택이 §9.2 원칙과 충돌하는가?

### 현재 정보 부족분

- 현재 hooks.ts의 태그 핸들러 이름 목록(하드코딩 여부 포함)
- nexus-core tags.yml이 정의할 handler 필드의 명명 규칙
- Phase 1 consume 시작 예정 일정

### Resolution (plan session #16, 2026-04-11)

Q5는 재정의되어 해소되었다. 원래 질문은 "동적 등록 전환 타이밍"이었으나, claude-nexus의 검증 패턴(moreih29/claude-nexus의 `gate.ts HANDLED_TAG_IDS` + 빌드 타임 drift check)을 참고하여 다음과 같이 해결했다:

**구현**: `src/shared/tag-parser.ts`에 `HANDLED_TAG_IDS = ['plan', 'run', 'sync', 'd', 'm', 'm-gc', 'rule'] as const` 정적 상수를 도입. `scripts/generate-from-nexus-core.mjs`가 빌드 타임에 이 상수를 regex로 추출하여 `node_modules/@moreih29/nexus-core/vocabulary/tags.yml`의 tag id 집합과 교차 검증(`verifyTagDrift`). drift 발생 시 hard-fail.

**요지**: 동적 로딩은 필요 없다. 정적 상수 + 빌드 타임 교차 검증으로 handler 이름의 single source of truth를 확보하면서 §9.2 runtime 공유 배제 원칙을 준수. claude-nexus와 동일 패턴.

**구현 커밋**: Phase 1 commit #3 (`ff813e6`) in branch `phase1-nexus-core-adoption`.

**구현 위치**:
- `src/shared/tag-parser.ts` — `HANDLED_TAG_IDS` 정적 상수
- `scripts/generate-from-nexus-core.lib.mjs` — `loadHandledTagIdsFromGate()`, `verifyTagDrift()`
- `scripts/generate-from-nexus-core.mjs` — `verifyTagDrift(tagsVocab, gateSrcPath)` 호출

Q4 (ACP question tool hang)는 여전히 미해결 상태로 남아 있음 — 변경 없음.

---

*plan session #1, 2026-04-10*
