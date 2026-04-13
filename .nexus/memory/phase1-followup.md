# Phase 1 후속 작업 추적

> opencode-nexus가 `@moreih29/nexus-core ^0.1.2`를 채택한 Phase 1(2026-04-11 완료, v0.2.0 release)의 후속 작업과 트리거 조건. 다음 plan session에서 가장 먼저 참조하는 문서.

---

## Phase 1 최종 상태 (2026-04-12)

- **버전**: opencode-nexus@0.2.0 (npm published, OIDC Trusted Publishing 첫 사용)
- **Plan session**: #16 (5 decisions, 20 tasks, history.json archive)
- **Branch sequence** (main에 머지됨):
  - `81978b3` Merge PR #1 (OIDC workflow, chore/oidc-trusted-publishing)
  - `bdc4db5` Merge PR #2 (Phase 1 cutover, phase1-nexus-core-adoption)
- **4-commit bisectable** (PR #2 내부): `a9cb773` → `4df4451` → `ff813e6` → `ee52ed5`

---

## 진행 중인 후속 작업

### 1. moreih29/nexus-core#3 (Gap 1-4) 추적

opencode-nexus 통합 이슈로 4개 Gap을 제출. upstream 결정에 따라 cleanup PR.

| Gap | Priority | 현재 workaround | upstream resolve 시 cleanup |
|---|---|---|---|
| 1. `no_shell_exec` reconsideration | Should | `scripts/generate-from-nexus-core.lib.mjs`의 `CATALOG_CONSISTENCY_EXEMPT`에 postdoc skip | exempt 제거, postdoc capabilities에 `no_shell_exec` 추가 |
| 2. skill `manual_only` runtime semantic | Must | Plan #18 Issue #5 Option D: B-leg 자동 주입에서 nx-setup/nx-init/nx-sync 제외 + system prompt nudge (`src/plugin/system-prompt.ts`) | generate-from-nexus-core에 manual_only skill skip 로직 명시 + opencode-nexus runtime에 isManualOnly(id) 체크 도입 |
| 3. generate-from-nexus-core lib shared | Should | `scripts/generate-from-nexus-core.{mjs,lib.mjs}` 복사 포팅 (claude-nexus 94997d1) | upstream lib import로 교체, scripts/ 삭제 |
| 4. natural language tag detection 경계 | Should | `src/shared/tag-parser.ts:4-15` 로컬 하드코딩 | upstream opinion에 따라 유지 또는 vocabulary 편입 |

**상류 이슈**: https://github.com/moreih29/nexus-core/issues/3

### 2. nx-setup manual_only 처리

**Plan session #18 Issue #5 결정: Option D (best-effort nudge)**

opencode runtime은 skill 호출을 강제 차단하는 API를 제공하지 않으므로 `manual_only` 속성을 runtime enforce할 수 없다. 따라서 B-leg 자동 주입에서 해당 skill을 제외하고 system prompt nudge로 대체한다.

**구현 내용:**

- B-leg 자동 주입 대상에서 `nx-setup`, `nx-init`, `nx-sync` 제외
- `src/plugin/system-prompt.ts`에 nudge 1-2줄 추가: "nx-setup/nx-init/nx-sync는 사용자가 명시적으로 호출하는 skill임, 자동 트리거 금지"

**Option C(skill 전체 제거) 승격 트리거:**

다음 중 하나 발생 시 Option D에서 Option C로 승격:

1. dogfooding 또는 end-user 보고에서 LLM이 nx-setup/nx-init/nx-sync를 자동 호출해 혼란을 야기한 사례 1건 이상
2. nexus-core#3 Gap 2 머지 후에도 `isManualOnly(id)` 체크를 runtime에 도입하는 것이 기술적으로 불가 판정

**관련**: nexus-core#3 Gap 2 — `manual_only` runtime semantic 명세 미확정 (아래 추적 테이블 참조).

### 3. NPM_TOKEN secret 삭제 (사용자 수동)

OIDC Trusted Publishing으로 전환 완료. GitHub repo `moreih29/opencode-nexus`의 Settings → Secrets and variables → Actions에서 `NPM_TOKEN` secret을 **수동 삭제** 필요. 미삭제 시 legacy token 경로가 잔존한다.

### 4. claude-nexus postdoc Bash 차단 PR (별도 트랙)

`docs/bridge/nexus-core-bootstrap.md` §10.1의 required action: claude-nexus의 `agents/postdoc.md` frontmatter에 `Bash`를 `disallowedTools`로 추가. 이는 nexus-core#3의 결과와 별개로 진행 가능. opencode-nexus 작업 아니지만 작성자 동일 인물이므로 추적 대상.

### 5. `core/` 4-layer 도구 인프라 redesign (✅ 완료, plan #22 + plan #23)

2026-04-12 `refactor/flatten-nexus-structure`에서 사람 작성 문서를 `.nexus/context/`로 flat화했으나 **도구 인프라**(`nx_init`, `nx_sync`, `nx_core_read`, `nx_core_write`, `nx_briefing`)가 사용하는 `core/{identity,codebase,memory,reference}` 4-layer는 코드 차원에서 유지됐다. plan #22(2026-04-13)에서 4-layer 코드 인프라를 완전 폐지했다.

**plan #22 결정 (원안)**: 자동 생성물 위치 → `.nexus/state/auto/`

**plan #23 정정**: 자동 생성물 자체 폐지. derived cache는 nexus-core canonical nx-sync(LLM-driven `.nexus/context/` update)와 misalign이며 사용처 0건 dead write로 확인됐다. `.nexus/state/auto/` 인프라(AUTO_ROOT) 및 관련 파일 생성 로직 전체를 plan #23에서 완전 폐지.

**완료된 작업 항목 (plan #22):**

- [x] `nx_core_read` / `nx_core_write` 도구의 layer 파라미터 제거 (`src/tools/core-store.ts`) — **core-store.ts 삭제, 도구 폐지**
- [x] `nx_briefing`의 role-based access matrix 재설계 (`src/tools/briefing.ts`) — **MATRIX 제거, 3-디렉토리 collect 방식으로 교체**
- [x] `nx_init` / `nx_sync`의 layer 기반 디렉토리 생성 + `syncIdentityDocs` 재작성 (`src/tools/workflow.ts`) — **4-layer mkdir 제거**
- [x] `src/plugin/hooks.ts:347` layer 순회 로직 — **제거 완료**
- [x] `src/shared/state.ts`의 4-layer mkdir 제거 — **완료**
- [x] `scripts/e2e-smoke.mjs:75` 검증 경로 수정 — **완료 (T5에서 e2e 일괄 정리 진행)**

**추가 완료 항목 (plan #23 — derived cache 폐지):**

- [x] `nx_sync` 단순화 — `ensureNexusStructure` 호출 + nx-sync skill 워크플로 안내 메시지만 출력. 자동 생성물 write 로직 전체 제거 (`src/tools/workflow.ts`)
- [x] `writeMemoryCycleNote` 제거 (`src/tools/task.ts`) — cycle note auto-write 폐지
- [x] `AUTO_ROOT` 경로 상수 제거 (`src/shared/paths.ts`)
- [x] `AUTO_ROOT` mkdir 제거 (`src/shared/state.ts`)

**수정된 코드 파일 (plan #22):**

- `src/shared/paths.ts` — CORE_ROOT 제거 (AUTO_ROOT는 plan #23에서 추가 후 즉시 폐지)
- `src/shared/state.ts` — 4-layer mkdir 제거
- `src/tools/core-store.ts` — 삭제
- `src/tools/index.ts` — nx_core_read / nx_core_write export 제거
- `src/tools/briefing.ts` — MATRIX 제거, 3-디렉토리 collect
- `src/tools/workflow.ts` — 4-layer mkdir 제거
- `src/plugin/hooks.ts` — 4-layer 순회 제거

**추가 수정 파일 (plan #23):**

- `src/tools/workflow.ts` — nxSync 단순화: 자동 생성물 write 제거, ensureNexusStructure + 안내 메시지로 교체
- `src/tools/task.ts` — writeMemoryCycleNote 제거
- `src/shared/paths.ts` — AUTO_ROOT 제거
- `src/shared/state.ts` — AUTO_ROOT mkdir 제거

---

## Phase 2 트리거 조건

`docs/bridge/nexus-core-bootstrap.md` §11.2 + UPSTREAM.md "Phase 2 Trigger Reference":

```
Phase 2 = Signal 1 AND (Signal 2 OR Signal 3)
```

- **Signal 1** (Commit velocity reversal): `commits_14d(opencode-nexus) > commits_14d(claude-nexus) × 1.5`가 14 consecutive days 지속
- **Signal 2** (Author declaration): plan session, UPSTREAM.md, GitHub release note에서 명시 선언
- **Signal 3** (Sync direction reversal): opencode-nexus → nexus-core PR이 30-day window에서 claude-nexus → nexus-core PR보다 많음

§11.4 Phase 2 실행 단계는 claude-nexus 측 작업이며 opencode-nexus는 직접 관여하지 않는다.

---

## 90-day re-evaluation window

- **Phase 1 완료**: 2026-04-11
- **다음 re-evaluation**: 2026-07-10 (90일 후)
- **트리거 무관 조건부 진입**: re-evaluation 결과 opencode-nexus에 nexus-core와 동기화되지 않은 prompt 개선이 5개 이상 누적됐거나, drift ledger가 줄어들지 않으면 Phase 2 조기 진입

---

## 운영 주의사항 (다음 release까지 유효)

### prompts.generated.ts 업데이트

nexus-core 새 버전이 release되면 다음 절차:

1. `bun update @moreih29/nexus-core` 또는 `bun add -D @moreih29/nexus-core@^x.y.z`
2. `bun run generate:prompts` 실행 → prompts.generated.ts 자동 재생성
3. `bun run test:e2e` 24개 전량 green 확인
4. `git diff src/agents/prompts.generated.ts` 등으로 본문 drift 검토 (특히 skills 본문)
5. 본문 drift 있으면 rationale 기록, commit
6. version bump (semver-policy 적용) + tag push → publish workflow 자동 트리거

### Capability resolution drift

opencode-nexus의 `src/agents/catalog.ts`와 generated `AGENT_META`는 `verifyCatalogConsistency`로 매 build마다 cross-check. 새 capability가 nexus-core에 추가되면:

1. catalog.ts에서 해당 agent의 disallowedTools 수동 업데이트 (§8.6 as-is)
2. consistency check pass 확인
3. 만약 nexus-core 결정에 동의하지 않는 divergence라면 `CATALOG_CONSISTENCY_EXEMPT`에 추가하고 upstream issue 인용

### CONSUMING.md 5-file upgrade protocol

nexus-core upgrade 시 항상 다음 5개 파일 확인:

1. `node_modules/@moreih29/nexus-core/package.json` (version)
2. `node_modules/@moreih29/nexus-core/manifest.json` (body_hash snapshot)
3. nexus-core CHANGELOG.md의 `<!-- nx-car:vX.Y.Z:start/end -->` marker
4. nexus-core MIGRATIONS/{from}_to_{to}.md (있으면)
5. nexus-core .nexus/rules/semver-policy.md

---

## Plan session #16 결정 (요약)

상세는 `.nexus/history.json`의 cycle 43 참조. 핵심:

1. **Migration 전략**: Big-Bang Cutover, 4-commit bisectable, 7일 브랜치 수명 상한
2. **Lib 재사용**: Option γ Hybrid (claude-nexus lib 복사 포팅 + upstream 제안)
3. **하드코딩 제거**: 4-commit 매트릭스 + HANDLED_TAG_IDS 정적 상수 + isEditLikeTool 교체
4. **nexus-core 이슈**: 4 Gap 통합 이슈, commit #1 직후 제출 → moreih29/nexus-core#3
5. **OIDC Trusted Publishing**: Must 5 + Should 3 적용, 별도 PR로 Phase 1 시작 전 머지 → 첫 v0.2.0 release에서 검증 완료

---

## Deferred Items (from docs/)

### Phase 1 커버리지 현황 요약 (docs/coverage-matrix.md)

Phase 1 항목(state file pattern, task pipeline guardrails, 4-layer knowledge)은 모두 Complete. Phase 2 항목 중 How/Do/Check 카탈로그, nexus primary orchestration lead, structured delegation은 Complete; MATRIX briefing, init/setup/sync workflows, CLAUDE.md migration handling은 Partial; Claude-native slash skill runtime은 Missing. Phase 3+ 항목은 대부분 Partial 또는 Missing — team_name semantics는 coordination label로만 지원되고, Claude-native team messaging(TeamCreate/SendMessage)은 대체 없이 Missing. Phase 4 LSP/AST 도구는 등록됐으나 heuristic/lightweight 수준으로 Partial.

### D8: `[m]` / `[m:gc]` / `[sync]` 태그 (완전 해결)

**Plan session #18 Issue #3 결정: Option A (claude-nexus parity 복원)**

`[m]`, `[m:gc]`, `[sync]` 태그의 runtime handler를 claude-nexus와 동등한 수준으로 완성. 수정 파일:

- `src/shared/tag-parser.ts` — 태그 파싱 및 dispatch 로직
- `src/plugin/system-prompt.ts` — system prompt 내 태그 안내 문구
- `src/plugin/hooks.ts` — `experimental.chat.system.transform` handler에서 [m]/[m:gc]/[sync] 분기 처리

원래 미구현 상태(`HANDLED_TAG_IDS` 등록만 있고 워크플로 미연결)에서 claude-nexus parity 달성. 추가 deferred 없음.

### D9: `resume_tier` 스킴 미구현 (from docs/deferred-from-claude-nexus.md)

- **현황**: opencode-nexus 런타임이 `resume_tier` 값을 읽고 활용하는 로직 없음. orchestration core는 invocation 단위 등록만 처리. nexus-core `meta.yml`에 필드 정의됐어도 런타임에서 무시됨.
- **미구현 이유**: orchestration core 확장이 필요한 runtime decision logic — Phase 1 prompt-only scope 밖.
- **재검토 조건**: 복잡한 멀티턴 서브에이전트 작업에서 재현성 요구 발생 시, 또는 Phase 2 이후 양 harness 동등 feature 정렬 시점.

### D10: `nx_history_search` 도구 부재 (from docs/deferred-from-claude-nexus.md)

- **현황**: `src/tools/`에 `nx_history_search` 미존재. 현재 구현 도구는 `nx_plan_*`, `nx_task_*` 계열. topic / decisions / research_summary 기준 과거 사이클 검색 불가.
- **미구현 이유**: MCP tool 구현 + history 저장소 구조 + 검색 인덱스 전략 설계가 모두 필요한 런타임 작업 — Phase 1 scope 밖.
- **재검토 조건**: opencode-nexus 사용자가 history 검색 유스케이스(이전 plan 세션 결정 조회 등)를 명시적으로 요청할 때.
