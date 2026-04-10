<!-- tags: deferred, claude-nexus, non-goals -->

# Deferred from claude-nexus

Phase 1 scope 밖으로 명시적 연기된 claude-nexus 기능 목록. 각 항목은 런타임 변경이 필요해 `@moreih29/nexus-core`(prompt-only shared library)로 해결 불가.

---

## D8: `[m]` / `[m:gc]` / `[sync]` 태그 부재

### claude-nexus에 있는 것

claude-nexus v0.24.1+는 메모리/컨텍스트 동기화 워크플로를 태그로 제공한다.

- `[m]` — 교훈과 참조를 `.nexus/memory/`에 압축 저장
- `[m:gc]` — memory 파일을 병합/삭제하는 garbage collection
- `[sync]` — plan/task 사이클 완료 후 `.nexus/context/` 설계 문서를 갱신

이 태그들은 Lead가 사이클 종료 시점에 호출하며, 프로젝트 지식을 세션을 넘어 지속시키는 핵심 메커니즘이다.

### opencode-nexus에 없는 것

`[m]`, `[m:gc]`, `[sync]` 태그 트리거가 `src/shared/tag-parser.ts` 또는 `src/shared/tags.ts`에 정의되어 있지 않다. 이에 대응하는 워크플로도 구현되어 있지 않다.

### Phase 1에서 제외한 이유

런타임 변경이 필요하다. 구체적으로:

- 각 태그에 대한 hook 핸들러 구현
- `.nexus/memory/` 쓰기 및 병합을 처리하는 MCP 도구 추가
- `[sync]` 트리거를 받아 design.md 계열 파일을 갱신하는 로직

`@moreih29/nexus-core`는 prompt-only shared library다. 런타임 hook과 MCP 도구는 Phase 1 scope 밖이다.

### 재검토 조건

- opencode-nexus 사용자가 memory compression 기능을 명시적으로 요청할 때
- 또는 Phase 2 완료 후 양 harness에 동등 feature로 도입하기로 결정할 때

---

## D9: `resume_tier` 스킴 부재

### claude-nexus에 있는 것

claude-nexus v0.25.0은 서브에이전트 지속성 tier 스킴을 도입했다. 각 에이전트 frontmatter에 `resume_tier` 필드가 존재한다.

- `ephemeral` — 매 호출마다 fresh spawn
- `bounded` — 태스크 단위로 재사용
- `persistent` — 세션을 넘어 상태 유지

Lead는 `resume_tier` 값에 따라 서브에이전트를 resume할지 fresh spawn할지 결정한다.

### opencode-nexus에 없는 것

`resume_tier` 개념 자체가 없다. orchestration core는 invocation 단위 등록만 처리한다. `@moreih29/nexus-core`의 `meta.yml`에 `resume_tier` 필드가 정의되어 있더라도, opencode-nexus 런타임이 이 값을 읽고 활용하는 로직이 구현되어 있지 않다.

### Phase 1에서 제외한 이유

런타임 decision logic이 필요하다. orchestration core를 확장하여 각 서브에이전트 호출 시 `resume_tier`를 평가하고 spawn 방식을 결정하는 로직을 추가해야 한다. 이는 prompt-only scope인 Phase 1 밖이다.

### 재검토 조건

- 복잡한 멀티턴 서브에이전트 작업에서 재현성 요구가 발생할 때
- 또는 Phase 2 이후 양 harness 간 동등 feature 정렬 시점에 도입을 검토할 때

---

## D10: `nx_history_search` 도구 부재

### claude-nexus에 있는 것

claude-nexus v0.25.0은 `nx_history_search` MCP 도구를 신규 도입했다. 과거 plan/task 사이클을 다음 기준으로 검색한다.

- `topic` — 관련 주제 키워드
- `decisions` — 이전 plan 세션의 결정 내역
- `research_summary` — 조사 요약 기반 검색

이를 통해 Lead와 서브에이전트는 이전 계획 세션의 맥락을 즉시 조회할 수 있다.

### opencode-nexus에 없는 것

`nx_history_search`라는 이름으로 구현된 tool이 `src/tools/`에 존재하지 않는다. 현재 구현된 tool은 `nx_plan_*`, `nx_task_*` 계열이다. history 검색 기능에 해당하는 tool이 없다.

### Phase 1에서 제외한 이유

구체적인 MCP tool 구현이 필요하며, 이는 opencode-nexus 런타임에 특정된 작업이다. `@moreih29/nexus-core` shared library scope 밖이다. tool 인터페이스 설계, history 저장소 구조, 검색 인덱스 전략 모두 별도 설계 결정이 필요하다.

### 재검토 조건

- opencode-nexus 사용자가 history 검색 유스케이스(이전 plan 세션 결정 조회 등)를 명시적으로 요청할 때 구현을 검토한다.
