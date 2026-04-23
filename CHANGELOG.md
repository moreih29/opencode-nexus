# 변경 이력

`opencode-nexus`의 주요 변경 사항은 이 파일에 기록한다.

## [0.15.1] — 2026-04-23

### 업스트림

- `@moreih29/nexus-core` 0.19.2 → 0.20.0. Lead spec과 `nx-plan`/`nx-auto-plan`/`nx-run` skill 대규모 리팩토링. 자기편향 방어, 응답 opening scaffold, 의사결정 경계 강화 중심.

### 변경됨 (업스트림 유래)

- **Lead 응답 형식** — substantive 요청 응답이 `[Pre-check]` opening scaffold 블록으로 시작. 복잡 요청은 축별 아이템 분해.
- **Lead 의사결정 evidence 요구** — Lead 주도 판단은 추론만으로 불가. `researcher`/`explore`/`tester`/`.nexus` 기록 중 하나의 출처 인용 필수.
- **Lead context·memory 능동 제안 정책** — Lead가 먼저 제안하도록 강화.
- **nx-plan Absolute Rules 3개** — Lead 단독 결정 금지, 비교표 출력 후 강제 stop, 사용자 응답 보수적 해석.
- **nx-auto-plan Absolute Rules 3개** — 자율 결정, 결정 유도 출력 금지, 안건 사이 멈춤 금지.
- **nx-run 보고 형식 확장** — 변경사항·주요 결정·다음 단계·미해결 질문·리스크 5항목.

### 수정됨

- **cmux 사이드바 상태 pill stuck 버그 수정** — `session.error`(MessageAbortedError 포함 abort 경로)에서 `cmux clear-status nexus-state`를 호출하지 않아 이전에 설정된 `Running` pill이 해제되지 않던 문제를 수정. 추가로 `session.status` 이벤트의 `type === "idle"` variant도 명시 처리해 `session.idle` 이벤트가 fire하지 않는 경로에서도 pill이 정리되도록 방어 강화.

### 사용자 영향

- **기존 설치본에 breaking change 없음.** 기존 trigger 태그(`[plan]`, `[auto-plan]`, `[run]`)와 MCP 인터페이스 모두 동일 동작. `install`/`models`/`uninstall` CLI 변경 없음.
- 업데이트 후 Lead 응답이 `[Pre-check]` 블록으로 시작하는 것을 확인 — 정상 동작.
- 설정 재적용/재설치 불필요. `opencode-nexus install`이 기존 `opencode.json`의 plugin entry를 0.15.1로 자동 pin 갱신.
- **cmux 사용자**: abort / error 이후 사이드바에 `Running` pill이 남아 있던 현상이 해결됨. 0.15.0에 stuck된 pill은 세션 재시작 또는 `cmux clear-status nexus-state`로 수동 정리 가능.

### 검증

- `bun run check` PASS (sync:dry + tsc --noEmit 0 errors).
- `bun run test:e2e` PASS — "All integration checks passed." 기존 install/models/uninstall + cmux hook 시나리오 a~g + 신규 h/i/j 모두 통과.
  - **cmux-h**: `session.error`(root) → `log` + `notify` + `clear-status` 3개 모두 호출 assert.
  - **cmux-i**: `session.status` + `status.type === "idle"`(root) → `clear-status` 호출 assert.
  - **cmux-j**: `session.error`(non-root) → cmux 호출 0건 assert(non-root guard regression 회귀 보험).
- `npm pack --dry-run` 결과 정상 — 27 files, 70.8 kB, `README.md`/`LICENSE`/`package.json`/`bin/`/`lib/`/`src/`/`skills/` 포함, `.github/` 미포함.
- `.opencode/skills/{nx-plan,nx-auto-plan,nx-run}/SKILL.md` frontmatter 정적 검증 PASS — `name` 디렉터리명 일치, `description` 1~1024자 범위, OpenCode regex `^[a-z0-9]+(-[a-z0-9]+)*$` 만족.

## [0.15.0] — 2026-04-23

### 추가됨

**CLI 확장**

- **`opencode-nexus uninstall [--scope=project|user|both] [--dry-run] [--force]`** — install이 건든 설정을 되돌리는 신규 서브커맨드. 제거 범위는 "namespace 기반 확실한 소유는 항상 제거 / provenance 불명 leaf는 정확 일치 또는 `--force`에서만 제거 / `$schema`는 최보수 처리(기본 모드에서 건드리지 않음)" 3단계 경계:
  - 항상 제거: `plugin[]`의 `opencode-nexus`/`opencode-nexus@*` 엔트리, Nexus 스킬 3개 디렉터리(`nx-auto-plan`, `nx-plan`, `nx-run`).
  - 정확 일치일 때만 제거: `mcp.nx`(구조적 동등성), `default_agent === "lead"`, `agent.build.disable === true`, `agent.plan.disable === true`. drift 값은 warning 후 보존, `--force`로만 강제 제거.
  - 빈 컨테이너 cleanup(`plugin: []`, `mcp: {}`, `agent.build: {}`, `agent: {}`), 완전 빈 `opencode.json` 삭제, `.opencode/skills/`·`.opencode/` 비었을 때만 재귀 삭제.
  - 비-Nexus 엔트리, `agent.*.model` 같은 사용자 커스터마이즈는 모두 보존.
  - 멱등: 두 번 실행해도 안전, 이미 제거된 상태는 `nothing to remove for scope: <scope>` 출력 후 exit 0.
  - 비-TTY는 확인 프롬프트를 띄울 수 없으므로 `--force` 필수(없으면 `Use --force for non-interactive removal` 에러).
  - `--dry-run`은 `would remove:` 형식으로 계획만 출력.
- **`opencode-nexus --version` flag와 `opencode-nexus version` 서브커맨드** — 출력은 `opencode-nexus <version>` 한 줄. short flag(-v/-V)는 향후 `--verbose` 네이밍 공간 보존을 위해 이번에는 도입하지 않음.

**cmux 통합 확장**

- **사이드바 상태 pill** — 기존 토스트 알림에 더해 cmux 사이드바의 `cmux set-status` API로 작업 상태를 `nexus-state` pill에 표시. 상태머신: 
  - root session이 busy로 전환되면 `Running` (bolt 아이콘, `#007AFF` iOS system blue).
  - `question` 툴 호출 또는 `permission.ask` hook 시 `Needs Input` (bell 아이콘, 동일 파란색).
  - `session.idle`, `session.deleted`, `session.error`, `permission.replied`에서 pill clear(특히 permission.replied는 deny/cancel 경로에서 stale pill 방지를 위한 명시적 clear).
- **Permission 알림** — `"permission.ask"` hook 신규. 권한 요청 시 "Permission requested" 토스트 + Needs Input pill 자동 표시. output은 건드리지 않음(사용자 동의/거부 흐름 가로채지 않음).
- **Error 로그·알림** — `session.error` 이벤트에서 `cmux log --level error --source nexus <1줄 요약>` + "Session error" 토스트. 메시지 요약은 `error.message || name || type || code || "unknown"` 순 fallback. `session.status` retry는 pill 변경 없이 `cmux log --level warning`만 기록(recoverable retry는 사이드바 상태를 어지럽히지 않음).
- **내부 리팩터링** — `cmuxNotify`를 공용 `cmuxSpawn` 헬퍼 위에 얇게 재구성. 모든 cmux 호출이 동일한 fire-and-forget + 가드 경로를 통과.

### 변경됨

- README.en.md의 `"Waiting for input"` → `"Waiting for your input"`로 수정(실제 notify body와 일치).
- 릴리즈 체크리스트(`.nexus/context/releasing.md`)에 `§5-4 uninstall 결과 불변조건 점검`과 `§5-5 cmux 통합 동작 점검`(cmux 활성/비활성 두 축) 섹션 추가, `§7` UX 점검에 uninstall interactive 체크 3항목 추가.

### 업스트림

- `@moreih29/nexus-core` 버전 변경 없음(0.19.2 유지).

### 사용자 영향

- **기존 설치본에 영향 없음, breaking change 없음.** 기존 `install`/`models` 명령 동작은 regression 없이 동일.
- `uninstall` 명령은 기본적으로 "우리가 건든 것만" 엄격히 되돌리므로 사용자가 `mcp.nx`/`default_agent` 등을 수정해뒀다면 기본 모드에서는 warning과 함께 보존됨. 강제 제거는 `--force`.
- cmux 사용자: 자동으로 사이드바 pill과 permission/error 알림이 활성화됨. 비-cmux 환경 또는 `OPENCODE_NEXUS_CMUX=0` 설정 시 모든 cmux 호출이 silent no-op(기존 동작 보존).
- 비-TTY 환경에서 `uninstall`을 쓰는 스크립트는 `--force` 플래그 추가 필요.

### 검증

- `bun run check` PASS
- `bun run test:e2e` PASS — 기존 install/models + 신규 uninstall 시나리오 A·B·C·D + version 시나리오 E + cmux hook 시나리오 cmux-a~g 포함 총 91개 assert 통과.
- 릴리즈 체크리스트 §5-4(uninstall 불변조건), §5-5(cmux 통합 동작) 수동 재현 PASS.
- cmux shim 기반 hook 호출 검증 — permission.ask / session.status busy(root·non-root) / permission.replied / session.error / session.idle / cmux disabled env 모든 케이스 기대 동작 확인.

## [0.14.0] — 2026-04-22

### 추가됨

- **cmux 데스크톱 통합** — cmux 터미널 안에서 OpenCode 를 실행 중일 때, Nexus plugin 이 다음 두 시점에 `cmux notify` 를 호출해 OS 알림을 띄운다. cmux 외부 환경에서는 자동으로 no-op 이므로 다른 사용자 환경에는 영향 없음.
  - **응답 완료 (`session.idle`)** — Lead 가 한 턴의 응답을 마쳤을 때 "Response ready" 알림. subagent 세션이 idle 되는 경우는 알림 스팸 방지를 위해 제외 (root session 만 추적).
  - **사용자 입력 대기 (`tool.execute.before` + tool === `question`)** — Lead 또는 서브에이전트가 사용자에게 질문 툴을 호출한 순간 "Waiting for your input" 알림.
- 활성화 조건: `CMUX_WORKSPACE_ID` 환경변수가 설정되어 있어야 한다 (cmux 가 cmux 터미널에 주입하는 env). 또한 `OPENCODE_NEXUS_CMUX=0` 또는 `false` 로 명시 비활성화 가능.
- fire-and-forget 구조 (spawn → detached → unref) 로 plugin 흐름을 blocking 하지 않으며, cmux CLI 가 PATH 에 없는 경우 spawn 에러는 silent 처리.

### 변경됨

- **README 설치 예시를 `@latest` 기준으로 전환** — 지금까지 README (ko/en) 의 `npm install -g opencode-nexus@x.y.z` 예시가 매 릴리즈마다 하드코딩 업데이트 대상이었고, 사용자가 구 버전을 실수로 설치할 수 있는 drift 위험이 있었다. 이제 설치/업그레이드 예시는 `@latest` 로 고정하고, 버전 pin 예시는 본문 안 설명용 illustrative 숫자로만 남긴다. 릴리즈 체크리스트 §1 에 이 규칙을 §1-1 로 추가하여 "README 의 모든 버전 숫자를 매번 동기화" 부담을 제거했다.

### 업스트림

- `@moreih29/nexus-core` 버전 변경 없음 (0.19.2 유지).

### 사용자 영향

- **cmux 사용자**: 알림이 자동 활성화된다. cmux notification center 에 "opencode-nexus" 출처 알림이 뜸. 비활성화하려면 shell 환경에 `OPENCODE_NEXUS_CMUX=0` export.
- **cmux 미사용자**: 변경 없음. `CMUX_WORKSPACE_ID` env 가 없으면 모든 notify 호출이 no-op.
- install / models / publish 흐름 변경 없음. 기존 설정 재설치 불필요. v0.14.0 을 설치하면 plugin 코드가 새 hook 두 개를 자동으로 추가 활성화.

### 검증

- `bun run check` PASS
- `bun run test:e2e` PASS
- **§5-1 / §5-2 / §5-3 (a)(b)** 회귀 PASS
- **cmux 통합 단위 테스트** — plugin hooks 를 직접 호출하여 4 케이스 검증:
  - `tool.execute.before` (tool=question) → fire ✅
  - `session.created` (root) + `session.idle` → fire ✅
  - `session.idle` (non-root sessionID) → no-fire ✅
  - `tool.execute.before` (tool=bash) → no-fire ✅

### 향후

- cmux 의 `claude-hook` 통합 (sidebar status `running` / `idle` 반영) 은 범용 OpenCode plugin 에서 바로 쓰기 애매한 부분이 있어 이번에는 제외. 사용자 요청 있으면 후속 minor 에서 추가 검토.

---

## [0.13.5] — 2026-04-22

### 수정됨 (Hotfix — v0.13.4 반쪽 수정 보완)

- **nexus-mcp shim 이 서버 기동을 skip 하던 버그 수정** — v0.13.4 에서 `opencode-nexus` 의 `bin.nexus-mcp` 를 노출시켜 `$PATH` 문제는 해소했지만, shim 이 `await import("@moreih29/nexus-core/mcp")` 만 호출하는 구조였다. upstream `dist/mcp/server.js` 의 `main()` 은 `isDirectRun = import.meta.url === "file://${process.argv[1]}"` 가드 안에 있어, import 경로로 로드되면 guard 가 false 가 되어 `main()` 이 호출되지 않는다. 결과적으로 `StdioServerTransport` 가 열리지 않고 프로세스가 즉시 event loop 종료로 빠져나가, OpenCode 가 `MCP error -32000: Connection closed` 로 실패.
- 수정: shim 이 `main` 을 이름 기반 import 후 명시적으로 `await main()`. 이제 `nexus-mcp` 가 실제 stdio 서버로 기동되어 OpenCode 의 MCP handshake (initialize 요청) 에 정상 응답한다.
- **기존 사용자 조치**: v0.13.5 로 CLI 재설치. `opencode mcp list` 에서 `nx` 가 failed 없이 뜨면 복구 완료. `opencode.json` 수정 불필요.

### 변경됨

- 릴리즈 체크리스트 (`.nexus/context/releasing.md`) **§5-3 를 3단계로 재구성**:
  - (a) **PATH 노출**: 기존 검사
  - (b) **Handshake 응답**: 실제 MCP `initialize` 요청을 보내 `serverInfo` 포함 JSON-RPC 응답을 받는지 확인 (신규)
  - (c) **`opencode mcp list` 확인**: 호스트 OpenCode 에서 `failed` 없이 뜨는지 확인 (신규)
- v0.13.4 가 (a) 만 검증하고 (b)(c) 를 놓쳐 반쪽짜리로 배포된 원인을 직접 차단한다.
- `.nexus/memory/pattern-bug-fix-routing.md` 의 anti-patterns 에 두 항목 추가:
  - "spawn 성공 = 기능 동작" 착각 (v0.13.4 의 실제 원인)
  - "shim 이 import 만으로 충분" 착각 (이 hotfix 의 직접 원인)

### 업스트림

- 이번 릴리즈는 업스트림 패키지 버전 변경 없음 (`@moreih29/nexus-core` 0.19.2 유지). wrapper 의 bin shim 로직만 수정.

### 사용자 영향

- **v0.13.4 를 글로벌 설치한 모든 사용자**: MCP 서버가 보이기는 있지만 `Connection closed` 로 즉시 실패 상태. v0.13.5 로 업그레이드 후 `opencode mcp list` 로 복구 확인.
- **신규 설치**: 자동 정상 동작.

### 검증

- `bun run check` PASS
- `bun run test:e2e` PASS
- **§5-1 / §5-2** PASS (skill 관련 기존 검증)
- **§5-3 (a) PATH 노출** PASS
- **§5-3 (b) MCP handshake 응답** PASS — 격리된 npm prefix 에 설치 후 stdio 로 `initialize` 보내면 `"serverInfo":{"name":"nexus-core","version":"0.19.2"}` 포함 응답 수신 확인
- **§5-3 (c) `opencode mcp list`** PASS — 호스트 환경 업그레이드 후 `nx` 항목이 failed 없이 뜸을 확인 (본 릴리즈 배포 후 사용자 환경에서 검증 완료)

---

## [0.13.4] — 2026-04-22

### 수정됨 (Hotfix)

- **MCP 서버 기동 실패 수정** — 글로벌 설치 환경에서 OpenCode 세션의 `nx_*` MCP 툴이 전부 unavailable 이던 회귀를 수정했다. v0.13.1 ~ v0.13.3 에 공통으로 영향.
- 원인: `opencode-nexus install` 이 `opencode.json` 의 `mcp.nx.command` 에 `["nexus-mcp"]` 를 기록했지만, 이 바이너리는 `@moreih29/nexus-core` 의 transitive bin 이라 글로벌 설치 시 `opencode-nexus` 의 nested `node_modules/.bin/` 에만 존재하고 글로벌 `$PATH` 에는 symlink 되지 않았다 (npm/bun 표준 동작). OpenCode 는 `✗ nx failed. Executable not found in $PATH: "nexus-mcp"` 로 조용히 기동 실패.
- 수정: `bin/nexus-mcp.mjs` re-export shim 을 추가하고 `package.json` 의 `bin` 섹션에 `"nexus-mcp": "./bin/nexus-mcp.mjs"` 를 선언했다. 이제 `opencode-nexus` 를 글로벌 설치하면 `nexus-mcp` 도 함께 글로벌 bin 에 symlink 되어 OpenCode 의 `command: ["nexus-mcp"]` 가 정상 resolve 된다.
- **기존 사용자 조치**: v0.13.4 로 CLI 를 업그레이드하면 된다. `opencode.json` 의 `mcp.nx.command` 값은 변경 불필요 — 같은 `nexus-mcp` 문자열이 이제 `$PATH` 에 노출된다. `opencode mcp list` 에서 `nx` 가 failed 없이 뜨면 복구 완료.

### 변경됨

- 릴리즈 체크리스트 (`.nexus/context/releasing.md`) §5 에 **§5-3 MCP binary reachability** 검증 항목 추가. 격리된 임시 prefix 에서 `npm pack → npm install -g → ls global bin → spawn test` 로 모든 MCP 바이너리가 글로벌 PATH 에 노출되는지 정적 + 동적 혼합 확인.
- `.nexus/memory/pattern-bug-fix-routing.md` 에 이번 사이클의 local fix 경로 사례를 추가하고, v0.13.2 의 upstream 경로 사례와 대비한 비교표를 기록했다. 같은 증상이라도 원인 위치가 local vs upstream 으로 완전히 갈리는 대표 예제가 된다.

### 업스트림

- 이번 릴리즈는 업스트림 패키지 버전 변경 없음 (`@moreih29/nexus-core` 0.19.2 유지). wrapper 내부의 bin 노출 구조 수정만 포함.

### 사용자 영향

- **유저 스코프로 v0.13.1 ~ v0.13.3 설치했던 사용자**: MCP 가 조용히 기동 실패 상태였음. v0.13.4 로 업그레이드 후 `opencode mcp list` 로 복구 확인.
- **새 설치**: 자동 정상 동작.

### 검증

- `bun run check` PASS
- `bun run test:e2e` PASS
- **§5-1 skill frontmatter static check** PASS
- **§5-2 live load smoke test** PASS
- **§5-3 MCP binary reachability** PASS — 격리된 npm prefix 에 `npm install -g` 한 결과 `opencode-nexus` 와 `nexus-mcp` 둘 다 글로벌 bin 에 symlink, `nexus-mcp` spawn 시 stdio 대기 상태 정상 진입 확인

---

## [0.13.3] — 2026-04-22

### 변경됨

- **`@moreih29/nexus-core` `0.19.1` → `0.19.2`** 로 승격.
- 번들 planning skill 의 HOW resume 지시가 자연어 설명에서 하네스별 concrete invocation 으로 **구체화**됐다 (업스트림 moreih29/nexus-core#65). OpenCode 의 경우 이제 `task({ task_id: "<id>", prompt: "<resume prompt>" })` 호출이 직접 명시된다.
  - `skills/nx-plan/SKILL.md` Step 4 의 resume bullet
  - `skills/nx-auto-plan/SKILL.md` 동일 위치
- runtime 코드 / generate 로직 / frontmatter 구조 변경 없음. skill 본문 2줄만 재싱크 영향.

### 업스트림

- nexus-core v0.19.2 `fix(plan)`: planning skill 의 resume 지시가 "continue with the existing session" (자연어) 에서 `{{subagent_resume agent_id=<id> prompt=<resume prompt>}}` 매크로로 바뀌어, OpenCode 하네스에서는 `task(...)` 호출로 치환된다 (moreih29/nexus-core#65).

### 사용자 영향

- **기존 사용자**: 업데이트 필수 아님 (v0.13.2 정상 동작). 다만 Lead 가 resume 호출 시 더 명확한 가이드를 받으려면 `opencode-nexus install` 재실행 권장.
- **신규 설치**: 자동 반영, 추가 조치 불필요.

### 검증

- `bun run check` PASS
- `bun run test:e2e` PASS
- **§5-1 skill frontmatter static check** PASS (3/3 skill 스펙 준수 재확인)
- **§5-2 live load smoke test** PASS (`opencode debug skill` 3개 skill 정상 반환)

---

## [0.13.2] — 2026-04-22

### 수정됨 (Hotfix)

- **번들 skill 로딩 실패 수정** — v0.13.1 (그리고 사실상 그 이전 모든 OpenCode 계열 릴리즈) 에서 생성된 `SKILL.md` frontmatter 는 OpenCode 공식 Agent Skills 스펙 (https://opencode.ai/docs/skills/) 을 위반해 있었다. `name` 필드가 누락되고, OpenCode가 인식하지 않는 `triggers` 필드가 emit 되어 있었다. 결과적으로 OpenCode는 어떤 skill 도 등록하지 않았고 `[plan]` / `[auto-plan]` / `[run]` 호출 시 `Skill "nx-plan" not found. Available skills: none` 으로 실패했다.
- 업스트림 `@moreih29/nexus-core` v0.19.1 (moreih29/nexus-core#60) 에서 opencode harness 의 frontmatter emit 로직이 수정되어, 이번 릴리즈부터 재싱크된 skill 은 `name: <id>` 를 포함하고 `triggers` 는 emit 되지 않는다.
- **기존 사용자 조치**: v0.13.2 로 CLI 를 업그레이드한 뒤 `opencode-nexus install` 을 다시 실행하면 `.opencode/skills/` 또는 `~/.config/opencode/skills/` 아래 SKILL.md 가 교체되어 skill 로딩이 정상 복구된다.

### 변경됨

- **`@moreih29/nexus-core` `0.19.0` → `0.19.1`** 로 승격.
- 번들 planning skill Step 3 (HOW 분석 기록) 및 Lead 의 Subagent ID Recording Practice 섹션이 **더 엄격하게** 재정의됐다 (업스트림 moreih29/nexus-core#61). `nx_plan_analysis_add` / `nx_task_update` 의 `agent_id` 에는 **반드시 하네스 spawn 툴이 반환한 agent id** 를 넘겨야 하며, 사람이 읽기 쉬운 assigned name 으로 대체하지 않는다. name 은 활성 세션 메시징용일 뿐, 종료된 세션을 안전하게 재개할 수 있는 식별자가 아니기 때문이다.
- 릴리즈 체크리스트 (`.nexus/context/releasing.md`) §5 에 **§5-1 skill frontmatter 스펙 정적 검증** 과 **§5-2 live load smoke test** 를 추가했다. 이번 사건 (v0.13.1 에 broken skill 을 배포한) 의 직접적 원인이 이 검증의 부재였다.

### 추가됨

- `.nexus/memory/pattern-bug-fix-routing.md` — 버그 발견 시 원인 위치에 따라 upstream 이슈 경로와 로컬 수정 경로 중 어느 쪽으로 가는지 판단하는 결정 패턴을 명문화. 이번 사이클의 실제 사례 (moreih29/nexus-core#57 → v0.19.1 fix → 이 릴리즈) 를 포함.

### 업스트림

- nexus-core v0.19.1 `fix(opencode)` — opencode harness sync 가 `SKILL.md` frontmatter 에 `name: <id>` 를 주입하고 `triggers` emit 을 중단 (moreih29/nexus-core#60). 우리 이슈 moreih29/nexus-core#57 의 fix.
- nexus-core v0.19.1 `fix(plan)` — `nx_plan_analysis_add` / `nx_task_update` 의 agent_id strict 화 (moreih29/nexus-core#61). 사람이 읽기 쉬운 name 대체 불허.
- nexus-core v0.19.1 `fix(codex)` — codex 자식 agent 가 부모 세션의 `nx` MCP launcher 를 보존 (moreih29/nexus-core#62). OpenCode 하네스에는 영향 없음.

### 사용자 영향

- **기존 v0.13.1 사용자**: skill 이 로드되지 않는 상태 → 이 hotfix 로 복구. `opencode-nexus install` 재실행 권장.
- **신규 설치**: 자동으로 정상 동작.
- **plan session 운영자**: `nx_plan_analysis_add` / `nx_task_update` 호출부에서 agent_id 에 스폰 툴 응답 id 를 사용하고 있는지 점검. name 을 쓰고 있었다면 strict 가이드 위반으로 향후 `nx_plan_resume` / `nx_task_resume` 재개가 실패할 수 있음.

### 검증

- `bun run check` PASS
- `bun run test:e2e` PASS
- §5-1 skill frontmatter 정적 검증 PASS
- §5-2 live load smoke test PASS

---

## [0.13.1] — 2026-04-22

### 변경됨

- **`@moreih29/nexus-core` `0.18.2` → `0.19.0`** 로 승격.
- 번들되는 planning skill 본문을 `nx_plan_decide` 최신 계약에 맞춰 재싱크했다 (`skills/nx-plan/SKILL.md`, `skills/nx-auto-plan/SKILL.md` Step 5 문단).
- **dev workspace 일관성 정리**: repo 자체의 dogfooding 용 install 산출물을 gitignore 로 통합했다. 대상은 `opencode.json` (plugin pin + mcp.nx + default_agent + agent.build/plan disable + **개인별 agent.*.model overrides**) 과 `.opencode/skills/*/SKILL.md` 3개, `.opencode/package-lock.json`. 모두 `opencode-nexus install` / `opencode-nexus models` CLI 가 자동 write 하는 머신 출력물이고, 특히 per-agent model 은 provider 별 개인 취향이라 다른 contributor 에게 강제되면 첫 실행을 깨뜨릴 수 있다. `.opencode/` 내부 `.gitignore` 의 셀프-참조 구조 대신 root `.gitignore` 에 단일화했고, 기존 tracked 파일들은 `git rm --cached` 로 해제 (working copy 는 유지).
- **bootstrap 스크립트 도입**: `bun run bootstrap` = `bun run sync` + `opencode-nexus install --scope=project --yes`. clone 직후 한 번으로 dev workspace 의 `.opencode/` 가 완성된다.
- README (ko/en) 의 Development 섹션 및 설치 예시의 하드코딩 버전을 `0.13.1` 로 갱신.

### 업스트림

- nexus-core v0.19.0 `fix(plan)`: `nx_plan_decide` 입력 스키마를 `{issue_id, decision}` 로 축소하고 `issue.analysis` 에 append 하지 않도록 수정 (#56). HOW 분석 기록은 `nx_plan_analysis_add` 경유로만 누적된다.
- Wrapper 런타임은 `nx_plan_decide` 를 직접 호출하지 않기 때문에 코드 변경 없음. 영향 범위는 번들 skill 문서 2개 파일의 Step 5 표현뿐.

### 사용자 영향

- **기존 사용자 (end user)**: 새 skill 본문을 반영하려면 `opencode-nexus install` 을 다시 실행하기를 권장. plan session 을 운영 중인 프로젝트라면 `nx_plan_decide` 호출부에서 `how_agents` / `how_summary` / `how_agent_ids` 필드를 제거하고, HOW 분석 기록은 `nx_plan_analysis_add` 로 이관.
- **신규 설치**: v0.13.1 CLI 가 최신 계약을 반영한 skill 을 그대로 설치한다. 추가 조치 불필요.
- **이 repo 의 contributor**: clone 후 `bun install && bun run bootstrap` 으로 dev workspace 를 초기화해야 한다. bootstrap 은 `opencode.json` 과 `.opencode/skills/` 를 기본값으로 새로 쓰며, per-agent model 은 이어서 `opencode-nexus models` 로 각자 설정한다. 기존 clone 을 유지하는 경우에는 local `opencode.json` 의 model 설정이 그대로 보존된다 (tracked 해제만 되고 파일 자체는 삭제되지 않음).

### 검증

- `bun run check` PASS
- `bun run test:e2e` PASS
- `bun run bootstrap` PASS (dev workspace `.opencode/skills/*` 재생성 확인)

---

## [0.13.0] — 2026-04-22

### 추가됨

- **Interactive install flow** 추가 — `opencode-nexus install`이 scope 선택부터 시작하고, 필요하면 바로 agent model 설정으로 이어진다.
- **Ink 기반 models wizard** 추가 — `lead`, OpenCode built-in (`general`, `explore`), Nexus subagent 전체를 지원한다.
- **스크립트용 direct model override** 지원 추가: `opencode-nexus models --agents=... --model=provider/model`
- **GitHub Actions 워크플로우** 추가:
  - `validate.yml`: `bun run check`, `bun run test:e2e`, `npm pack --dry-run`
  - `publish-npm.yml`: Trusted Publishing 기반 npm 배포
- **릴리즈 운영 문서** 추가: `.nexus/context/releasing.md`

### 변경됨

- **현재 기준 OpenCode wrapper**로 패키지를 재구성했다 (`@moreih29/nexus-core 0.18.2`).
- install은 이제 **현재 실행 중인 CLI 버전만** `opencode.json`에 pin한다. 더 이상 cross-version pinning을 허용하지 않는다.
- install 기본값을 **Nexus 기준으로 정규화**했다:
  - `default_agent: "lead"`
  - `agent.build.disable: true`
  - `agent.plan.disable: true`
- 번들되는 skill 구성을 현재 nexus-core OpenCode 출력에 맞췄다: `nx-auto-plan`, `nx-plan`, `nx-run`
- runtime agent registration은 사용자 config가 아니라 plugin layer에서 주입하도록 바꿨다.
- README를 Node 기반 CLI 실행, Bun 설치 지원 기준으로 다시 정리했다.

### 제거됨

- CLI에서 **cross-version install flow** 제거. install 중에 다른 버전 패키지를 fetch/unpack하지 않는다.
- 현재 nexus-core 계약에 포함되지 않는 구형 skill set 및 wrapper 전용 legacy install 가정 제거.

### 브레이킹 변경 (pre-v1 minor)

- **신규 설치/업그레이드가 현재 wrapper 계약을 기준으로 동작**한다. `0.13.0`으로 올린 뒤에는 다음을 반영하려고 `opencode-nexus install`을 다시 실행해야 한다.
  - pinned plugin entry
  - Nexus 기본 agent 설정
  - 복사되는 skill 파일
- **배포되는 skill 구성이 바뀌었다**. 현재 OpenCode/nexus-core 출력인 `nx-auto-plan`, `nx-plan`, `nx-run`을 기준으로 동작하므로, 이전 bundled skill을 기대하던 문서나 흐름은 갱신해야 한다.
- install은 더 이상 **임의의 target package version**을 고르지 않는다. 다른 버전을 설치하려면 먼저 그 버전의 CLI를 설치한 뒤 `opencode-nexus install`을 다시 실행해야 한다.

### 검증

- `bun run check` PASS
- `bun run test:e2e` PASS
- `npm pack --dry-run` PASS

---

## [0.12.0] — 2026-04-20

### 변경됨

- **Adopted `@moreih29/nexus-core ^0.16.2`** — 3-harness consumer plugin I/O contract realignment, OpenCode fragment 제거, smoke-consumer gate. Canonical OpenCode contract: `harness-io.md §4-2` (sync outputs = `package.json`/`src/plugin.ts` Template + `src/index.ts`/`src/agents/*.ts`/`.opencode/skills/*` Managed; `plugin: ["<name>"]` auto-register; `agents` array in consumer config is invalid).
- `@opencode-ai/plugin` bumped to `1.4.9`.
- `.nexus/memory/anti-patterns.md` §9.2 / §9.5 re-contextualized — `opencode.json.fragment`을 v0.15.x 이전의 legacy 로 명시, 원칙(fragment-as-install-SSOT 금지) 유지.
- `.nexus/context/architecture.md` + `build-and-release.md` — v0.16 adoption + v0.12.0 타겟 반영.

### 추가됨

- e2e `scripts/e2e-nexus-integration.mjs` blocks:
  - **E. hook manifest resolves** — manifest JSON load + `handlerPath` existsSync for every entry (prompt-router 포함).
  - **F. prompt-router self-contained load** — dynamic `import()` sanity of the packaged prompt-router handler.
  - **C block** fragment-absence assertion — `sync --dry-run` stdout must not mention `opencode.json.fragment`.
- `.nexus/memory/upstream-docs-drift.md` — record of observed upstream nexus-core docs drift (SSOT vs tutorial/template), kept for future upstream follow-up outside this cycle.

### 제거됨

- **`opencode.json.fragment`** — no longer produced by `nexus-core` v0.16.0+ `sync`. Stale tracked file removed from the repo, `.gitignore` updated to prevent accidental re-introduction.
- **`.opencode/plugins/opencode-nexus.js`** — legacy shim that re-exported a stale `dist/index.js`. Not referenced by OpenCode loader (canonical registration is `plugin: ["opencode-nexus"]` → `package.json exports` → `./src/plugin.ts`), not in `files` whitelist, confirmed removable.

### 업스트림

- nexus-core v0.15.2 `fix(hooks)` — `dist/hooks/*.js` CLI bootstrap 주입.
- nexus-core v0.16.0 `feat(contract)` — 3-harness consumer plugin I/O 계약 재정렬 + OpenCode fragment 제거 + smoke gate (#45).
- nexus-core v0.16.1 `fix(hooks)` — prompt-router 번들 self-contained화 + smoke-consumer gate (#46, #47).
- nexus-core v0.16.2 `fix(codex)` — Codex `disabled_tools`를 `[mcp_servers.nx]` 블록으로 이동 (#48, #49); OpenCode harness 에는 영향 없음.
- Tier A bootstrap audit: subpath exports 3/3 PASS, manifest handlerPath resolve 4/4 PASS (`session-init`, `prompt-router`, `agent-finalize`, `agent-bootstrap`), `src/plugin.ts` tsc PASS.
- Tier B SSOT diff review: sync output fully aligned with `docs/contract/harness-io.md §4-2` (v0.16.2).

### 검증

- `bun run check` PASS (sync:dry + `tsc --noEmit`).
- `bun run test:e2e` PASS (blocks A–F).
- `bun run test:cli` PASS (B1–B15, 15/15).

### 참고

- Plan #59 (`opencode-nexus: adopt nexus-core v0.16.x`) — 4 decisions (caret bump + v0.12.0 target; B-tier diff verification; Tier A + targeted Tier B audit; e2e manifest/prompt-router/fragment-absence assertions).

---

## [0.11.0] — 2026-04-20

### 추가됨

- **`opencode-nexus` CLI binary** — canonical installer/mutator for OpenCode config and skills:
  - `install [--scope=user|project|both] [--yes] [--dry-run] [--force] [--skills=...] [--normalize]`
  - `uninstall [--scope=user|project|both] [--yes] [--purge]`
  - `doctor [--scope=user|project|both] [--json] [--fix]`
- **Scope model**: `user` (~/.config/opencode), `project` (./opencode.json), `both` (ownership split — user owns plugin+mcp, project owns default_agent+skills)
- **Intelligent merge engine** (lib/config-merge.mjs):
  - Path-scoped patching — only managed keys (`plugin`, `mcp.nx`, `default_agent`, `$schema`) touched; consumer-owned fields (`agent`, `instructions`, `permission`, other `mcp.*`, other `plugin` entries) preserved
  - Preserve-first plugin handling — bare/pinned duplicates warned, auto-collapse only with `--normalize`
  - Patch-empty ⇒ no-op (no backup, no write)
  - Sibling timestamped backups (`.backup-YYYYMMDD-HHMMSS`), keep last 5
  - Atomic temp+rename writes
  - JSON strict only, JSONC detection with fail-safe error (no silent comment stripping)
  - Formatting preserve (indent 2/4 detection, trailing newline)
- **Doctor diagnostics** (lib/doctor.mjs):
  - State classification: fresh / complete / partial_config / partial_skills / orphan_* / jsonc_error
  - Per-scope checks: plugin entry, mcp.nx canonical, default_agent, skills installed, modified detection, backup accumulation, agent.lead declaration advisory
  - `--fix`: non-destructive normalize (plugin dedup collapse, empty container cleanup)
  - `--json`: machine-readable output
- **Skills management** (lib/skills-copy.mjs):
  - Preserve-first install (existing files skipped, `--force` to overwrite)
  - `--purge` opt-in on uninstall (default: preserve)
  - SKILLS_TO_COPY whitelist ensures user-authored skills never deleted
- **E2E regression suite** (scripts/e2e-cli.mjs): 15 blocks covering install/uninstall/doctor × scope × edge cases (preserve-first, duplicate plugin, dry-run, backup rotation, atomic write, JSONC, postinstall silence)
- `bin` field in package.json
- `test:cli` script

### 변경됨

- **postinstall role minimized** — no filesystem mutation. Prints hint message pointing to `bunx opencode-nexus install`. Self-install guard preserved.
- **README restructured** — CLI-first Quick Install as primary path; scope ownership table; package-manager matrix (bun/npm/pnpm/yarn)
- **Bun trust reframed** — no longer a prerequisite for setup; CLI works without trust. trust only affects whether postinstall hint runs.
- **nx-setup role redefined** — CLI handles bootstrap (mechanical install); nx-setup remains as post-install configuration wizard (cognitive refinement)

### 제거됨

- **`opencode.json.fragment` dependency** — CLI does not read the fragment; install spec is wrapper-local hardcoded (future migration to nexus-core official export when available). Aligns with upstream nexus-core#43 (fragment deprecate discussion).
- Previous postinstall-driven skills copy flow (superseded by CLI)

### BREAKING (v0.11.0, pre-1.0 minor)

Pre-1.0 semver permits breaking changes in minor bumps, but consumers should be aware:

- **Postinstall no longer copies skills automatically** — even with Bun `pm trust`. Run `bunx opencode-nexus install --scope=project` after package install.
- **Manual opencode.json edit no longer needed** — CLI handles it. If you previously edited manually, existing keys are preserved; re-run `install` to add any missing Nexus-managed keys.
- **CLI is the canonical mutator** — direct file edits or scripted patches should be replaced with `install` / `uninstall` to maintain idempotency and backup guarantees.

At the time of `0.11.0`, a separate migration guide was provided for common upgrade scenarios.

### 업스트림

- nexus-core#43 (opencode.json.fragment deprecate) — CLI design intentionally fragment-independent to support Option A.

---

## [0.10.1] — 2026-04-20

### 수정됨

- **Published OpenCode consumer config example was invalid** — v0.10.0 문서에 포함된 `agents` 배열 + `module` 필드 예시는 opencode canonical schema에 존재하지 않는 키를 사용해 consumer가 그대로 복사 시 `Unrecognized key: "agents"` 오류로 opencode 기동이 실패했습니다.
- **Canonical minimal config로 교체**:
  ```json
  {
    "plugin": ["opencode-nexus"],
    "mcp": { "nx": { "type": "local", "command": ["nexus-mcp"] } },
    "default_agent": "lead"
  }
  ```
- `plugin: ["opencode-nexus"]` 등록만으로 10 agents가 자동 등록되므로 `agent` 섹션/배열은 불필요합니다(override 용도만).
- `opencode.json.fragment` 참조 언급 제거 (upstream nexus-core#43에서 deprecate 검토 중).

### 참고

- v0.10.0은 기능적으로 동일하지만 문서 예시가 invalid했으므로 **v0.10.1 적용을 강력히 권장**합니다.
- v0.11.0에서 CLI (install/uninstall/doctor)로 이 설정을 자동화할 예정입니다.

---

## [0.10.0] — 2026-04-20

### BREAKING CHANGE — nexus-core 0.15.1 shared runtime substrate 전면 수용

opencode-nexus는 자체 Nexus 오케스트레이션 런타임에서 @moreih29/nexus-core 0.15.1+ shared runtime substrate 래퍼로 재정의됐다.

### 사용자 조치 필요

기존 v0.9.x 사용자는 다음 단계를 따라야 한다:

1. **Bun post-install 신뢰 설정** (Bun 1.3+):
   ```bash
   bun pm trust opencode-nexus
   ```
   이 설정 없이는 postinstall이 실행되지 않아 consumer `.opencode/skills/`가 생성되지 않습니다.

2. **opencode.json 구성 업데이트**:
   ```json
   {
     "plugin": ["opencode-nexus"],
     "mcp": {
       "nx": { "type": "local", "command": ["nexus-mcp"] }
     },
     "default_agent": "lead"
   }
   ```
   - **MCP 키는 `mcp` (not `mcp_servers`)** — opencode config validator 요구사항
   - **`plugin` 등록만으로 10 agents 자동 활성화** — `agent`/`agents` 섹션 불필요 (v0.10.0 초기 문서의 `agents` 배열 예시는 invalid였으며 v0.10.1에서 수정됨)
   - 이전 isolated config (`.opencode/nexus/config.json`)는 제거됨 — agent별 model override는 `agent.<name>.model`로 직접 지정

3. **Node 런타임 업그레이드**: Node.js >= 22 필요 (`import ... with { type: "json" }` 구문 요구). 이전에 Node 20을 사용 중이면 업그레이드 필수.

4. **기존 `.opencode/skills/` 커스터마이즈 백업**: postinstall이 nx-init/plan/run/sync를 생성하지만 **기존 파일 존재 시 보존**. 안전을 위해 커스터마이즈 분은 별도 백업 권장. deploy skill은 opencode-nexus 고유이며 postinstall 대상 아님.

5. **CLI 명령어 제거**: 이전 버전의 `opencode-nexus setup / migrate / install / update` 명령어는 제거됨. 신규 설치는 opencode.json plugin 배열 + bun trust로 완료.

6. **AGENTS.md 자동 sync 중단**: 프로젝트의 AGENTS.md `<!-- NEXUS:START/END -->` 블록 자동 sync 기능 제거. 수동 관리 또는 삭제.

7. **Plan/run session의 task_id auto-wiring 제거**: HOW 에이전트 resume 시 LLM이 prior task 출력에서 task_id를 수동으로 참조해야 함. opencode-nexus 고유 auto-injection 로직이 canonical nexus-core skill flow로 대체.

### 제거된 기능

**Category 1: Plugin hooks (12개)**
- exit guard (tool.execute.before/after based)
- team-policy injection
- knowledge-index injection
- plan/run continuity auto-injection
- AGENTS.md template sync
- mode-aware playbook text injection
- memory-access observation
- agent-tracker reset preservation
- tool-log edit-like scope limiting
- compaction snapshot
- task-after-owner warning
- edit gate scope enforcement

**Category 2: Tools (4개)**
- `nx_context` — use nexus-mcp instead
- `nx_ast_search/replace` — migrate to nexus-mcp
- `nx_lsp_document_symbols/workspace_symbols/goto_definition` — migrate to nexus-mcp
- `nx_init/nx_sync` workflow wrappers — use skill triggers instead

**Category 3: CLI/Setup (4개)**
- isolated config (`.opencode/nexus/config.json`)
- `opencode-nexus setup/migrate/install/update` CLI commands
- `installSkillFiles` backup/restore
- nx-setup skill

**Category 4: Agent/Orchestration (6개)**
- `src/agents/primary.ts` (nexus identity)
- `team-policy.ts`
- `delegation.ts`
- `run-continuity-adapter.ts`
- `plan-continuity-adapter.ts`
- `knowledge-index.ts`
- `plan-how-panel.ts`

### 추가됨

- `scripts/postinstall.mjs`: consumer `.opencode/skills/`로 nx-init/plan/run/sync 4 skill 자동 복사
- `scripts/e2e-nexus-integration.mjs`: MCP handshake, mountHooks, sync idempotency, plugin load 회귀 검증
- `src/plugin.ts`: mountHooks 엔트리 (sync-managed template)

### 변경됨

- Version: 0.9.1 → 0.10.0 (minor bump, pre-v1 convention)
- dependencies 승격: @moreih29/nexus-core devDep → dep (^0.15.1)
- engines.node: >=20 → >=22
- main: dist/index.js → src/plugin.ts (TypeScript 직접 로드)
- bin 필드 제거 (CLI 전면 삭제)
- Primary agent: `nexus` identity → nexus-core canonical `lead` (mode: primary)

### 업스트림

nexus-core v0.13.0 ~ v0.15.1 adoption 경로에서 발견된 upstream 이슈들이 모두 resolved:
- nexus-core#26 hook-manifest export (resolved v0.14.0)
- nexus-core#28 dist ROOT resolution (resolved v0.14.1)
- nexus-core#30 sync subdir prepend (resolved v0.15.0)
- nexus-core#32 distribution I/O contract RFC (resolved v0.15.0 + harness-io.md §4-2)
- nexus-core#36 fresh-install 2 bugs (resolved v0.15.1)
- nexus-core#37 distribution-invariant CI gate meta (resolved v0.15.1)

### 전환 단계

Phase 1 (빌드 타임 prompt consumer) → Phase 2 (runtime substrate consumer) 전환 시기였다.

---

## 이전 버전

### [0.9.1] — 2026-04-19
- Fix: @opencode-ai/plugin dependencies 승격 (devDep-only 선언 버그 수정)

### [0.9.0] — 2026-04-18
- Feature: isolated config 도입 (`.opencode/nexus/config.json`)
- Feature: CLI setup/migrate/install/update 명령어

### [0.8.0] — 2026-04-16
- Feature: AGENTS.md template sync
- Feature: plan/run continuity auto-injection

### [0.7.0] — 2026-04-15
- Feature: knowledge-index injection
- Feature: memory-access observation

### [0.6.0] — 2026-04-14
- Feature: team-policy injection
- Feature: agent-tracker reset preservation

### [0.5.0] — 2026-04-13
- nexus-core v0.5.0 adoption: runtime.json writer, agent-tracker.json 분해

### [0.4.0] — 2026-04-13
- nexus-core v0.4.0 adoption: harness-state-namespace 규칙 적용

### [0.3.0] — 2026-04-12
- nexus-core v0.2.0 upgrade: capability-map 도입

### [0.2.0] — 2026-04-11
- Phase 1 Big-Bang Cutover: nexus-core ^0.1.2 devDependency adoption

### [0.1.0] — 2026-04-10
- Initial release
