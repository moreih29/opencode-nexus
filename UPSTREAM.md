<!-- upstream relationship document for opencode-nexus. for contributors and maintainers. -->

# Upstream Relationship

opencode-nexus와 claude-nexus의 관계, 업데이트 방향 정책, 장기 진화 모델을 정의한다.

---

## Relationship

opencode-nexus는 `@moreih29/nexus-core`(Shared Prompt Library)를 consume하는 OpenCode 오케스트레이션 런타임이다.

claude-nexus는 동일한 `@moreih29/nexus-core`를 consume하는 Claude Code 오케스트레이션 런타임이다.

**두 프로젝트는 sibling(자매) 관계다. parent/child 관계가 아니다.**

- opencode-nexus는 claude-nexus의 downstream이 아니다.
- claude-nexus는 opencode-nexus의 upstream이 아니다.
- 두 harness는 동일한 behavioral spec(`@moreih29/nexus-core`)을 독립적으로 consume한다.
- `@moreih29/nexus-core`가 유일한 canonical source다.

### 현재 상태 (Phase 1)

Phase 1 기간 동안 claude-nexus는 아직 nexus-core를 consume하지 않는다. opencode-nexus가 먼저 nexus-core 통합을 완료하며, claude-nexus는 Phase 2에서 동일 패키지를 consume하는 방향으로 전환한다. 이 시점까지 두 프로젝트는 독립적으로 운영되나, sibling 관계임은 변하지 않는다.

---

## Bidirectional Flow Policy

`@moreih29/nexus-core`는 항상 canonical source다. 두 harness 중 어느 쪽도 상대방의 변경을 직접 consume하지 않는다. 변경은 반드시 nexus-core를 통해 전파된다.

### 업데이트 방향

**작성자(author)가 현재 주력으로 사용하는 harness가 업데이트 방향을 결정한다.**

- 작성자가 opencode-nexus를 주력으로 사용 중 → opencode-nexus에서 프롬프트 변경 → nexus-core에 반영 → claude-nexus가 다음 consume 시 동기화
- 작성자가 claude-nexus를 주력으로 사용 중 → claude-nexus에서 프롬프트 변경 → nexus-core에 반영 → opencode-nexus가 다음 consume 시 동기화

### Flip 모델

어느 harness가 "업데이트하는 쪽"인지는 시간이 지나면서 바뀔 수 있다(bidirectional flip). 이는 설계상 의도된 동작이다. 특정 harness를 영구적으로 "primary"로 고정하지 않는다.

flip이 발생해도 `@moreih29/nexus-core`가 canonical source라는 원칙은 유지된다.

---

## 90-Day Re-evaluation Rule

Phase 1 상태를 90일마다 검토한다. 검토 항목:

1. **누적 프롬프트 변경량** — opencode-nexus에서 nexus-core와 동기화되지 않은 변경이 얼마나 누적됐는가
2. **nexus-core 소유권** — claude-nexus 측에서 nexus-core seed를 실질적으로 운영하고 있는가
3. **불균형 탐지** — 두 harness 간 변경 속도 차이가 지속되는 경우 Phase 2 조기 전환을 고려한다

검토는 plan 세션 형태로 진행한다. 검토 결과는 `.nexus/state/plan.json`에 기록한다.

---

## Phase 2 Trigger Reference

다음 세 가지 신호 중 하나 이상이 충족되면 Phase 2 전환을 고려한다.

1. **Commit velocity 1.5× 기준** — 한 harness의 nexus-core 관련 커밋 속도가 상대 harness 대비 1.5배 이상인 상태가 2주 이상 지속
2. **작성자 명시적 선언** — 작성자가 plan 세션에서 "Phase 2 전환"을 명시적으로 선언
3. **동기화 방향 역전** — opencode-nexus → nexus-core 흐름이 반복적으로 claude-nexus 방향으로 역전되는 패턴 관측

Phase 2 전환 절차 전체는 `docs/bridge/nexus-core-bootstrap.md` §11을 참조한다. (해당 문서는 Phase 1 stale-doc 정리 작업에서 생성된다.)

---

## Intentional Divergences

### 4-layer 지식 계층 구조

opencode-nexus는 `.nexus/core/{identity,codebase,memory,reference}` 4계층 디렉터리 구조를 사용한다.

claude-nexus v0.24.1+ 이후 flat 구조인 `.nexus/{memory,context,rules}`로 전환했다.

**이 차이는 의도적 divergence다.** opencode-nexus가 4계층 구조를 유지하는 이유:

- 역할 기반 접근 행렬(role-based access matrix) 지원을 위해 계층 분리가 필요하다
- `identity`, `codebase`, `memory`, `reference` 각각의 접근 범위와 갱신 주기가 다르다

flat 구조로의 전환은 별도 plan 세션의 설계 결정 사항이다. Phase 1 또는 Phase 2 scope에 포함되지 않는다.

### 기타 divergence

추가 intentional divergence는 `docs/deferred-from-claude-nexus.md`를 참조한다.
