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

### 현재 상태 (Phase 1 완료 + v0.2.0 Upgrade)

Phase 1이 2026-04-11에 완료되었다. opencode-nexus는 `@moreih29/nexus-core ^0.1.2`를 devDependency로 consume하는 Big-Bang Cutover 전환을 완료했다(`phase1-nexus-core-adoption` 브랜치, 4-commit bisectable sequence: `a9cb773` → `4df4451` → `ff813e6` → `ee52ed5`).

2026-04-12에 nexus-core v0.2.0 upgrade를 적용했다(`chore/nexus-core-0.2.0-upgrade` 브랜치). 주요 변경: `harness_mapping` 제거에 대응하여 consumer-local `capability-map.yml` 도입(X3 semantic schema: `blocks_semantic_classes` → opencode tool 매핑), `SKILL_PURPOSE_OVERRIDE` 제거 및 manifest `summary` 필드 사용, CI capability-map coverage assertion 추가.

#### v0.4.0 Upgrade (2026-04-13, `chore/nexus-core-0.4.0-upgrade`)

`@moreih29/nexus-core ^0.3.0` → `^0.4.0` 업그레이드. v0.4.0이 도입한 `rule:harness-state-namespace` 규칙을 적용하여 harness-local 상태 파일을 `.nexus/state/opencode-nexus/` 네임스페이스로 이동했다.

주요 변경:

- `plan.opencode.json` → `.nexus/state/opencode-nexus/plan.extension.json` (plan sidecar 파일명 및 위치 변경)
- `orchestration.opencode.json` → `.nexus/state/opencode-nexus/orchestration.json` (공통 state 루트에서 독립 분리)
- `.nexus/state/audit/` → `.nexus/state/opencode-nexus/audit/` (audit 로그 네임스페이스 이동)
- `.nexus/state/tool-log.jsonl` 제거 (미사용 파일 정리)
- 루트에 `state-schemas/` 디렉토리 신설: `plan.extension.schema.json`, `orchestration.schema.json`, `audit-log.schema.json`
- `package.json`에 `validate:conformance` 스크립트 추가, `test:e2e` 앞단에 편입. 다만 nexus-core v0.4.0 npm tarball에 `scripts/conformance-coverage.ts`가 누락되어 `scripts/validate-conformance.mjs` shim이 graceful skip 처리 중 (upstream fix 대기)

#### v0.5.0 Upgrade (2026-04-13, `chore/nexus-core-consuming-sync`)

`@moreih29/nexus-core ^0.4.0` → `^0.5.0` 업그레이드. v0.5.0이 도입한 4개의 breaking change에 모두 대응했다.

주요 변경:

- **runtime.json writer 신설** — `src/shared/runtime.ts` 추가, `session.created` hook이 v0.5.0 schema(`harness_id="opencode-nexus"`, `harness_version`, `teams_enabled`, `session_started_at`)로 `runtime.json`을 (over)write. opencode 플랫폼이 자동 작성하던 `plugin_version` 필드는 더 이상 사용되지 않음.
- **agent-tracker.json 분해** — `AgentTrackerItemSchema`에서 `agent_type` 제거 후 `harness_id` + `agent_name`을 required 분리 필드로 도입. `status` enum에서 `team-spawning` 제거 (모두 `running`으로 통일). `agent_id`/`resume_count` required 승격. opencode-nexus 자체 필드(`team_name`, `coordination_label`, `lead_agent`, `purpose`)는 optional로 유지하여 운영 의미 보존.
- **plan_decide 파라미터 정리** — `nxPlanDecide`에서 `summary` input 제거 (`decision`만 사용). state field 명칭과 input 명칭이 align됨.
- **history.json schema_version 도입** — `appendHistory`가 매 cycle에 `schema_version: "0.5"`를 자동 주입하고 파일 최상위에도 동일 값 기록. `HISTORY_SCHEMA_VERSION` 상수를 `src/shared/history.ts`로 export.
- **conformance bin 직접 호출** — v0.4.0 `scripts/validate-conformance.mjs` graceful skip shim 제거. `bunx nexus-validate-conformance`를 spawn하는 단순 wrapper로 교체. v0.5.0이 `package.json#bin`과 `files` whitelist에 `scripts/`를 포함시킨 결과로 npm tarball에서 직접 실행 가능.

claude-nexus는 Phase 2에서 동일 패키지를 consume하는 방향으로 전환한다. 두 프로젝트는 여전히 sibling 관계이며, `@moreih29/nexus-core`가 canonical source다.

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

### `.nexus/` 구조 — fully resolved (2026-04-13)

**사람 작성 문서**는 claude-nexus 표준과 동일한 flat 구조를 채택했다 (2026-04-12 `refactor/flatten-nexus-structure`):

- `.nexus/context/` — 정적 설계 문서 (architecture, orchestration, principles, build-and-release, tools)
- `.nexus/memory/` — lessons learned, follow-up, anti-patterns
- `.nexus/rules/` — 강제 컨벤션
- `.nexus/state/` — runtime 데이터 + audit log

**도구 인프라** 4-layer (`.nexus/core/{identity,codebase,memory,reference}`) 및 `nx_core_read` / `nx_core_write` 도구는 plan #22 (2026-04-13)에서 완전 폐지됐다. `nx_briefing`은 3-디렉토리 collect 방식으로 교체됐다. plan #22에서 임시 도입된 `.nexus/state/auto/` derived cache 인프라는 plan #23에서 추가 폐지됐다 — derived cache가 nexus-core canonical nx-sync(LLM-driven `.nexus/context/` update)와 misalign이며 사용처 0건 dead write로 확인됐기 때문이다. `nx_sync`는 `ensureNexusStructure` + nx-sync skill 워크플로 안내 메시지만 출력하는 방식으로 단순화됐다.

### 기타 divergence

추가 intentional divergence는 `docs/deferred-from-claude-nexus.md`를 참조한다.
