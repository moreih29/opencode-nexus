<!-- tags: plan, phase, sync, macro, verification, scope, lesson -->
# Sync 매크로 사용처는 추정이 아닌 verified evidence로 확인해야 한다

우리는 cycle 11에서 "Phase 2 = DO/CHECK 에이전트까지 post-sync 치환 확대"라는 계획을 세웠고, cycle 12에서 이것이 **phantom scope**였음을 확인했다. 계획 수립 당시 "agent.ts가 sync 타겟이니까 매크로가 거기 있을 것"이라는 추정을 검증 없이 계획에 포함시켰고, 실제로는 skill body에만 매크로가 있었다.

## 현상

cycle 11 Issue 6 decision에서 Phase 2를 "DO/CHECK 4명(engineer/researcher/writer/reviewer/tester)까지 치환 확대"로 계획했다. 실행 단계에서는 `scripts/post-sync-asyncify.mjs`가 9개 agent 파일을 allowlist에 넣되 실제 치환은 0건, 8건 치환은 오직 `.opencode/skills/{nx-plan,nx-auto-plan}/SKILL.md`에서 발생했다. Task 4 engineer가 "caveat"으로 남긴 관찰:

> Caveat: `src/agents/{lead,architect,designer,postdoc,strategist}.ts` currently contain no `task({ subagent_type: ... })` spawn calls in the generated upstream output, so they receive `0` replacements and still have no `nexus_spawn(` string.

이 caveat 자체가 Phase 2의 "DO/CHECK 확대" 계획이 **실체 없음**을 이미 보여주고 있었으나, Phase 2는 즉시 재정의되지 않고 문서·계획에 원문이 그대로 남았다. cycle 12의 Issue 4 논의에서 `nexus-core/spec/agents/*/body.md`에 `subagent_spawn` 매크로가 **없음**(역할 정의만 있고, 스폰은 skill body가 담당)을 explicit하게 확인한 뒤에야 재정의됐다.

## 근본 원인 (planning-time 추정의 오류)

계획 수립 당시 다음 추정이 검증 없이 사용됐다:

1. **"sync 타겟이면 거기에 매크로가 있을 것"** — `harness/opencode/layout.yml`이 `agent: src/agents/{id}.ts`를 sync 타겟으로 지정한다는 사실에서 "agent body에도 매크로가 있다"를 유추. **틀린 추정**. layout은 sync 경로(어디에 파일을 만드는가)일 뿐이고, 매크로 등장 여부는 `spec/*/body.md`에 달렸다.
2. **"nexus-core의 role 구분(HOW/DO/CHECK)이 spawn 매크로 위치에도 반영돼 있을 것"** — nexus-core의 role 구분은 문서화·권한 모델 측면이지 spawn invocation 측면이 아님. **카테고리 오해**.

## 재발 방지 — Phase 계획 시 verify 절차 3단계

### 1. 실제 sync 생성물에서 매크로 등장 위치를 grep으로 실증 확인

```bash
# 예: subagent_spawn 매크로가 실제로 어디에 등장하는지
grep -rn 'subagent_spawn' /Users/kih/workspaces/areas/nexus-core/spec/

# sync 생성물에서 renderer가 매크로를 어디에 emit하는지
grep -rn 'task({ subagent_type:' /Users/kih/workspaces/areas/opencode-nexus/.opencode/skills/
grep -rn 'task({ subagent_type:' /Users/kih/workspaces/areas/opencode-nexus/src/agents/
```

결과가 예상과 다르면 계획을 **그 자리에서 재정의**한다. 추정을 "나중에 맞는지 확인하자"로 넘기지 않는다 — planning phase 안에서 결판이 나야 task decomposition의 scope가 정확해진다.

### 2. Phase 계획 decision text에 "확인된 등장 위치 + 예상 치환 건수"를 명시

- ❌ 추정 기반: "Phase 2에서 DO/CHECK까지 확대" — 어디에 있는지, 얼마만큼인지 없음.
- ✅ 검증 기반: "Phase 2에서 `nx-plan`/`nx-auto-plan` 외에 spec body에 `subagent_spawn`이 추가로 등장하면 on-demand 확대. 2026-04-24 기준 grep으로 확인한 현재 등장 위치: `nx-plan` 4건, `nx-auto-plan` 4건, 그 외 0건. 추가 등장이 실제로 발생할 때까지 Phase 2는 대기 상태."

### 3. Phase 1 실행 중 발견한 caveat은 후속 phase 재정의 트리거

DO 에이전트가 "caveat"·"note"로 남기는 관찰은 **주의 신호**다. planning 단계의 추정과 execution 단계의 실제 관찰이 어긋나는 순간, 그 자리에서:
- 현재 Phase의 결과를 확정한 뒤
- 후속 Phase(이번 cycle 후속 또는 다른 cycle) 계획을 즉시 재평가·보정한다.

이번 사례에서 Task 4 engineer의 caveat이 Phase 2 재정의를 즉시 트리거했더라면 cycle 11 CHANGELOG·pattern memory에 phantom Phase 2 문구가 포함되지 않았을 것이다.

## 응용 범위

이 교훈은 post-sync-asyncify나 nexus-core 매크로 체계에 국한되지 않는다. 일반화하면:

- **"sync 타겟 = 내용 소유자"**가 아님. sync 경로와 콘텐츠 원천은 분리됨.
- **role 분류(HOW/DO/CHECK)는 multi-axis**다. 권한, 문서, 스폰 권한, invocation site가 각각 다른 축을 가질 수 있음.
- **Phase 계획은 "다음에 X를 할 것"**이라는 추상보다 **"현재 Y 상태이고 조건 Z가 되면 X를 할 것"**이라는 구체 계약이 drift를 줄인다.

## 연관 cycle · 기록

- **cycle 11** (2026-04-24): Phase 2 phantom scope를 포함한 Issue 6 decision 생성. `.nexus/history.json`에 archive됨 (plan_id=11).
- **cycle 12** (2026-04-24): Phase 2 phantom scope 공식 인정, "on-demand 확대"로 재정의. Issue 4 decision.

## 연관 메모리

- `pattern-opencode-plugin-surface.md` §8 — post-sync asyncify layer의 dependency contract
- `external-opencode-plugin-versions.md` — 업스트림 가정 검증 사례
- `pattern-bug-fix-routing.md` — upstream vs local 경로 분리

## 조사 원본

cycle 12 (2026-04-24) planning 중 Lead의 관찰 + architect의 phantom scope 확인 + Task 4 engineer caveat 인용. 원본은 `.nexus/history.json`의 cycle 12 archive에 보존.
