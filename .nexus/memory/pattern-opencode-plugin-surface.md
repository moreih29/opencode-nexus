<!-- tags: opencode, plugin, surface, integration, checklist, bump -->
# opencode-nexus의 OpenCode plugin 접점 지도

이 파일은 우리 wrapper가 `@opencode-ai/plugin` / `@opencode-ai/sdk` / `opencode.json` config schema와 연결되는 **모든 접점**을 열거한다. 다음 opencode 버전 bump 검토 시 이 지도를 re-verification 체크리스트로 사용한다.

조사 기준: v0.16.3 시점 (2026-04-23). 파일 라인 번호는 당시 기준이며 drift 가능 — 실제 위치는 grep으로 재확인.

## 1. plugin SDK 타입·hook 표면

### 1-1. Plugin entry
- `src/plugin.ts`에서 `Plugin` 타입을 직접 import. `export const OpencodeNexus: Plugin = async ({ directory }) => { ... }`.
- `PluginInput.directory`에 직접 의존 (opencode가 주입).

### 1-2. 사용 hook 5개 (signature가 바뀌면 우리 코드 수정 필요)

| Hook | 우리 쓰임 | 민감도 |
|---|---|---|
| `config` | `config.agent`에 Nexus agent 주입, `default_agent` 기본값 `lead` | **high** — config schema 변화 시 직결 |
| `event` | 아래 §1-3 이벤트 타입들 | **high** — 가장 자주 변하는 표면 |
| `tool.execute.before` | `input.tool === "question"`만 특별 취급 | **medium** — tool name 변화 시 |
| `tool` (custom tool 등록) | Plugin 반환 객체의 `tool` property로 `nexus_spawn`, `nexus_result` 등록. `nexus_spawn`은 fire-and-forget + 3s watchdog × 1 retry; `nexus_result`는 상태 조회 | **high** — 새 SDK 의존 추가 (`client.session.create`, `promptAsync`, `messages`) |
| `permission.ask` | notify만 발사 (input/output 미읽음) | **low** — signature만 유지되면 됨 |
| `chat.message` | `output.parts[]`에서 첫 `text` part rewrite | **medium** — parts 구조 변화 시 |

### 1-3. 사용 event 타입 (`event.properties` 필드 의존)

| Event type | 읽는 필드 | 분기 조건 |
|---|---|---|
| `session.created` | `info.parentID`, `info.id` | parentID 없으면 root; parentID 있으면 child로 `childSessionToTask` 맵에 등록 |
| `session.idle` | `sessionID` | root만; child는 별도 sessionID→parent 맵(`childSessionToTask`)으로 분기 |
| `session.deleted` | `info.id` | rootSessions에서 제거; child cleanup 분기 (맵에 있으면 child로 처리) |
| `session.status` | `status.type` → `busy` / `retry` / `idle` | root: pill 제어·clear-log / child: `busyObserved` 업데이트(watchdog 신호) |
| `message.part.updated` | `part.type` → `step-start` / `text`; `part.sessionID`, `part.text` | root만, step-start는 턴 경계, text는 preview 캐시; child 별 캐시 분기 (`childSessionLastText`) |
| `session.error` | `error.name`, `error.message`, `sessionID` | MessageAbortedError 식별; child status=error 분기 (sessionID로 맵 조회) |
| `permission.replied` | `sessionID` | root만, pill clear |

**주의**: OpenCode SDK types.gen.d.ts에서 이들은 discriminated union. 새 variant가 추가되거나 기존 variant가 제거되면 TypeScript 레벨에서 fail-fast.

## 2. config schema (`opencode.json`) 의존

### 2-1. `$schema` URL (SSOT)
- `https://opencode.ai/config.json` — `opencode.json:2`, `lib/install-spec.mjs:7`, `lib/install.mjs`, `lib/uninstall.mjs` 모두 동일 상수.

### 2-2. 가정하는 키 구조

| 키 | 타입/값 | install/uninstall 취급 |
|---|---|---|
| `plugin` | string array | `opencode-nexus@<version>` entry 추가/정규화 |
| `mcp.nx` | `{ type: "local", command: ["nexus-mcp"] }` | 우리 값과 정확 일치일 때만 안전 제거 |
| `default_agent` | string (`"lead"`) | 비어 있으면 주입, 그 값이면 제거 가능 |
| `agent.build.disable`, `agent.plan.disable` | boolean (`true`) | install이 강제, uninstall이 leaf 단위 제거 |
| `agent.<id>.model` | string | 사용자 preference, 건드리지 않음 |

이 구조가 업스트림 schema 변경으로 바뀌면 install/uninstall이 wrong merge 할 수 있음 — 가장 위험한 축.

## 3. 버전 pin 위치 (현재 = 1.14.21)

| 위치 | tracked? | SSOT 역할 |
|---|---|---|
| 루트 `package.json` | **tracked** | published wrapper 지원선 (compile/runtime dep) |
| 루트 `bun.lock` | **tracked** | 루트 설치 해상도 |
| `.opencode/package.json` | untracked (.opencode/.gitignore) | 개발자 로컬 OpenCode sandbox |
| `.opencode/package-lock.json` | untracked | sandbox 해상도 (npm) |
| `.opencode/bun.lock` | untracked, **존재 금지** | v0.16.3에서 삭제 + .gitignore 명시 |

bump 작업 시 수정 대상: 루트 `package.json`만. `bun install`로 `bun.lock` 자동 재생성. `.opencode`는 optional (dev 환경 정합 목적).

## 4. `opencode` CLI 바이너리 의존

- `lib/agent-models.mjs`의 `listAvailableModels()`가 `opencode models --pure`를 spawn.
- `bin/opencode-nexus.mjs`의 `models` 경로가 여기 호출. install/uninstall/version은 CLI 의존 없음.
- e2e는 temp PATH에 mock `opencode` 바이너리 심어서 검증 — 실제 opencode 본체 실행 회피.

## 5. skill 구조 (sync 의존)

- `nexus-sync --harness=opencode --target=./`로 skills 생성.
- **CORE_SKILLS**: `["nx-auto-plan", "nx-plan", "nx-run"]` (SSOT: `lib/install-spec.mjs:14`)
- 복사 경로: bundled `skills/` → `.opencode/skills/`
- **SKILL.md frontmatter 스펙**: `name` + `description` 필수. `name`은 디렉터리명과 일치, regex `^[a-z0-9]+(-[a-z0-9]+)*$`, `description`은 1~1024자.
- 이 frontmatter 스펙은 OpenCode가 skill을 load할 때 필수 조건 — 위반 시 silent failure. `.nexus/context/releasing.md` §5-1에서 매 릴리즈 재검증.

## 6. 다음 opencode bump 시 re-verification checklist

이 순서로 따라가면 회귀를 최소화할 수 있다.

### 6-1. 사전 조사
1. `external-opencode-plugin-versions.md`의 §6 절차 따라 점프 성격 파악 (renumbering인지 실질 변화인지).
2. GitHub Release notes에서 "Plugin API" 섹션 필터.
3. `types.gen.d.ts` diff — 위 §1-3 이벤트 타입들 signature 확인.

### 6-2. 우리 접점 확인
1. §1-2의 6개 hook signature 변화 없음 확인. 있으면 `src/plugin.ts` 수정 필요.
2. §1-3의 event payload 필드 변화 없음 확인. 특히 `status.type`, `part.type`, `error.name` discriminator.
3. §2-2의 config schema 키 구조 변화 없음 확인. 바뀌었으면 `lib/install.mjs` / `lib/uninstall.mjs` 업데이트.
4. Phase 1 async child session SDK API 의존 확인. 변화 시 `src/plugin.ts` 수정 필요:
   - `client.session.create({parentID})` 반환 shape
   - `client.session.promptAsync({sessionID, text})` 동작
   - `client.session.messages({path: {id: sessionID}})` 반환 shape
   - `session.created` / `session.deleted` 이벤트의 `info.parentID` 필드 보장 및 `childSessionToTask` 맵 유지

### 6-3. 검증 실행 (releasing.md 체크리스트)
1. `bun install` — peer dep 충돌 없음
2. `bun run check` — 타입 에러 없음 (TypeScript가 event payload 변경을 잡아줌)
3. `bun run test:e2e` — cmux 시나리오 전부 PASS (event timing 회귀 가장 잘 잡힘)
4. `npm pack --dry-run` — publish 아티팩트 정합
5. §5-1 skill frontmatter 재검증
6. §5-5-1 cmux 통합 회귀 (9단계 시퀀스 argv assert)

### 6-4. 변경이 있다면
- plugin hook이나 event payload 구조가 실제로 바뀐 경우 → `[plan]` cycle로 격상해 영향 분석부터.
- 단순 숫자 bump는 [auto-plan] 또는 Lead 직접 처리 가능.

## 7. 연관 메모리

- `external-opencode-plugin-versions.md` — 업스트림 버전 궤적과 renumbering typo
- `empirical-cmux-pill-clear-paths.md` — cmux 통합 회귀 방지 원리 (set-clear pair, spawn serialize)
- `pattern-bug-fix-routing.md` — upstream vs local 경로 분리

## 8. Post-sync asyncify layer

`scripts/post-sync-asyncify.mjs`는 opencode-nexus sync 파이프라인의 정규 layer다. `bun run sync`가 `nexus-sync --harness=opencode`를 실행한 뒤 체이닝되어, (1) subagent_spawn 매크로가 opencode 하네스에서 렌더된 `task({subagent_type,...})`를 `nexus_spawn({agent_id,...})`로 치환하고, (2) upstream sync가 덮어쓰는 9개 agent의 Lead-monopoly permission(`nexus_spawn: "deny"`, `nexus_result: "deny"`)을 재주입한다.

### 장기 유지 정책

nexus-core 메인테이너가 [#68](https://github.com/moreih29/nexus-core/issues/68)(closed, not planned)에서 이 downstream post-process 패턴을 legitimate integration으로 명시 인정했다. 우리는 cycle 12 Issue 2 α1 결정에 따라 이 레이어를 영구 유지하며, variant 협력 이슈를 선제 제기하지 않는다. 자동 합류 조건: opencode runtime이 task tool에 native async를 추가하거나 nexus-core가 self-initiated harness variant를 도입하는 경우 — 그때 별도 cycle에서 제거 재평가.

### Dependency contract

- `nexus-core harness/opencode/invocations.yml:5` — subagent_spawn template이 정확히 `task({ subagent_type: "{target_role}", prompt: "{prompt}", description: "{name}" })` 형태임을 전제. bump 시 이 라인이 변경되면 `scripts/post-sync-asyncify.mjs`의 regex 업데이트 필요.
- Assertion 3개(치환 8 / 파일 9 / entry 18)가 fail-fast drift 감지. 실패 시 stderr에 "Likely causes:" 진단 힌트 출력.
- `nexus-core spec/agents/*/body.md` — subagent_spawn 매크로 **미사용**(역할 정의만). Phase 계획 시 이 사실을 추정이 아닌 grep으로 verified evidence로 확인할 것. 근거: `empirical-sync-macro-usage-verification.md`.

### Phase 2 phantom scope 관찰 기록

Note: 원래 Phase 2 계획("expand replacement scope to DO/CHECK agents")은 phantom scope였음. nexus-core spec 구조상 agent body에 subagent_spawn 매크로가 없고, 스폰은 skill body가 담당. 권한 주입은 이미 9 agents × 2 entries = 18 entries로 Phase 1에서 완료. 향후 skill body에 새 subagent_spawn 사용처가 추가되면 on-demand 확대.

관련 경험 기록: [`empirical-opencode-async-session.md`](./empirical-opencode-async-session.md), [`empirical-sync-macro-usage-verification.md`](./empirical-sync-macro-usage-verification.md)

## 조사 원본

이 파일은 v0.16.3 cycle(2026-04-23)의 explore subagent 조사 + Lead 확인 결과를 통합. 원본 artifact `explore/opencode-touch-points.md`는 `.nexus/history.json` archive에 보존되며 이 memory로 대체.
