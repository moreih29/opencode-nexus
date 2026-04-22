<!-- tags: bug, triage, upstream, hotfix, decision-axis -->
# Bug Fix Routing — Upstream vs Local

## 원칙

버그나 배포 후 이슈가 발견되면 **원인 위치를 먼저 식별**한 뒤, 그 위치에 맞는 경로로 수정한다. 증상 발생 위치와 원인 위치가 다를 수 있으므로, 증상을 본 곳에서 성급히 patch 하지 않는다.

## 판단 플로우

```
1. 증상 재현 + 최소 재현 케이스 확보
2. 공식 spec / upstream docs 와 현재 동작 대조
3. 원인 위치 식별
   ├─ upstream 패키지/라이브러리 → A. Upstream 경로
   ├─ 우리 wrapper/래핑 코드       → B. Local 경로
   └─ 둘 다 관련 (계약 경계)       → C. 병행 경로
4. 사용자 영향도 평가
   ├─ critical (기능 미동작)       → 병행 우선 고려
   └─ minor (불편 수준)            → 원인 위치 단일 경로로 충분
5. 경로 실행
```

## A. Upstream 경로

- upstream repo 에 issue 등록 (최소 재현 + 공식 spec 레퍼런스 + 제안 fix + downstream 영향 포함)
- upstream fix 배포까지 **로컬 코드는 건드리지 않는다** — patch 를 쌓으면 upstream 수정 시 충돌 관리 비용 발생
- upstream 수정 완료 후 bump + 배포 + 이슈 close
- upstream repo 의 owner/maintainer 와 동일인이면 turnaround 가 짧아 이 경로 단독이 가장 깨끗함

## B. Local 경로

- wrapper/래핑 코드가 원인이면 직접 수정
- 브랜치 분기 (`fix/<slug>`) → 커밋 → PR → merge → tag → 배포
- 릴리즈 체크리스트(`.nexus/context/releasing.md`) 전체 통과 필수
- CHANGELOG + README 에 사용자 영향 명시

## C. 병행 경로 (긴급)

- 사용자 영향이 크고 upstream turnaround 가 불확실할 때
- Local 에 임시 patch 를 넣고 hotfix 배포 (예: sync 뒤에 post-process script 를 끼우는 방식)
- **patch 위치에 "upstream fix 후 제거 예정" 코멘트 필수**, 관련 upstream issue 번호 명시
- upstream 수정 완료 시 우리 patch 제거 + 새 bump 에서 반영 + 코멘트 제거

### 병행 경로 선택 기준

다음 조건 **모두** 충족 시에만 선택:
- upstream 수정 시점이 불투명 (외부 maintainer, 저자 부재 등)
- 사용자의 핵심 기능이 동작하지 않음 (불편 수준이 아니라 차단)
- Local patch 복잡도가 upstream 수정 복잡도보다 낮음

## 사례

### 2026-04-22 — opencode-nexus v0.13.1 skill 로딩 실패 (Upstream 경로)

- **증상**: `[plan]` 호출 시 OpenCode 가 `Skill "nx-plan" not found. Available skills: none`
- **원인 위치**: `@moreih29/nexus-core` 의 opencode harness sync 출력이 OpenCode 공식 spec 위반 (`name` 필드 누락, `triggers` 비표준 필드 사용)
- **경로 선택**: **A 단독** (upstream 이슈만)
- **근거**: upstream repo owner 가 wrapper 저자와 동일인 → turnaround 짧음 추정. Local patch 는 sync post-process 복잡도 대비 이득 낮음.
- **Issue / Fix / Release**: moreih29/nexus-core#57 → #60 → v0.19.1 → opencode-nexus v0.13.2 downstream 반영

### 2026-04-22 — opencode-nexus v0.13.3 MCP 서버 기동 실패 (Local 경로)

- **증상**: 유저 스코프 설치 후 세션에서 `nx_plan_*` MCP 툴 전부 unavailable. `opencode mcp list` → `✗ nx failed. Executable not found in $PATH: "nexus-mcp"`.
- **원인 위치**: **wrapper (opencode-nexus) 자체** — install CLI 가 `opencode.json` 의 `mcp.nx.command` 에 `["nexus-mcp"]` 를 기록하지만, `nexus-mcp` 바이너리는 `@moreih29/nexus-core` 가 선언한 bin 이라 **글로벌 설치 시 opencode-nexus 의 nested `node_modules/.bin/` 에만 존재**하고 글로벌 `$PATH` 에는 symlink 되지 않음. npm/bun 모두 transitive dep 의 bin 을 글로벌 PATH 에 노출하지 않는 것이 표준 동작.
- **공식 스펙 대조**: OpenCode MCP 스펙 (https://opencode.ai/docs/mcp-servers/) 은 `command` 배열을 `$PATH` 또는 절대경로 기준으로 해석 — 우리 config 자체는 스펙 준수, 단 execution 조건을 wrapper 가 보장해야 함.
- **경로 선택**: **B 단독** (local fix)
- **근거**: nexus-core 는 자기 bin 을 적법하게 선언하고 있고, wrapper 가 의존성 bin 을 재노출해야 하는 책임이 분명히 local 쪽. upstream 이 개입할 영역 아님.
- **Fix**: `bin/nexus-mcp.mjs` 에 `await import("@moreih29/nexus-core/mcp")` shim 을 두고 `package.json` 의 `bin` 섹션에 `"nexus-mcp": "./bin/nexus-mcp.mjs"` 추가. 글로벌 설치 시 bun/npm 이 이 bin 도 PATH 에 symlink → 기존 사용자 `opencode.json` 의 `command: ["nexus-mcp"]` 가 그대로 정상 동작 (config 변경 불필요).
- **Release**: opencode-nexus v0.13.4

### 두 사례의 대비

| 축 | Skill 사건 | MCP 사건 |
|---|---|---|
| 증상 발생 위치 | OpenCode 가 skill 등록 거부 | OpenCode 가 MCP 서버 spawn 실패 |
| 스펙 위반? | ✅ upstream 출력이 OpenCode 스펙 위반 | ❌ 설정은 스펙 준수 |
| 원인 위치 | upstream (nexus-core) | local (opencode-nexus) |
| 원인 유형 | 생성된 본문의 내용 오류 | wrapper 가 실행 경로를 노출하지 않음 |
| 해결 주체 | upstream fix 후 downstream bump | local fix 단독 |
| 체크리스트 보강 | §5-1 (static), §5-2 (live load) | §5-3 (binary reachability) |

**교훈**: 증상이 같은 "OpenCode 가 우리 기능을 쓰지 못함" 이더라도 원인 위치는 완전히 다를 수 있다. 공식 spec 대조만으로는 후자 같은 설치-경로 문제를 찾지 못한다. 정적 검증 + 격리된 설치 시뮬레이션 + 런타임 smoke test 세 층을 모두 거쳐야 사각지대가 사라진다.

## 부수 교훈 — 체크리스트 보완 후보

이번 사례에서 릴리즈 체크리스트(`.nexus/context/releasing.md`) §5 가 "파일 생성" 만 검증하고 "파일이 실제 OpenCode 에 의해 load 되는지" 는 검증하지 않았던 게 구멍이었다. 다음 중 하나를 체크리스트에 보강하는 것이 타당:

- 실제 OpenCode 에 install 후 `skill({name})` 호출 시 load 되는지 smoke test
- 생성된 `SKILL.md` frontmatter 가 OpenCode 공식 spec (`name` required, `description` required, `name ^[a-z0-9]+(-[a-z0-9]+)*$`, 디렉터리명 일치) 을 만족하는지 정적 검증

## Anti-patterns

- **증상 위치에서 patch 하기**: 원인이 upstream 인데 wrapper 에 band-aid 를 붙이면 upstream 수정 후 유령 코드가 남는다.
- **Local hotfix 없이 무작정 upstream 대기**: 사용자가 critical 영향을 받는 상태를 방치하면 신뢰 손상. C 경로 검토 필요.
- **경로를 정한 후 다른 경로 섞기**: A 로 결정했는데 중간에 local 이 급해 patch 쌓기 시작하면 나중에 upstream merge 와 충돌. 경로 전환 시에는 결정 자체를 다시 내리고 기록.
- **원인 식별 생략**: 증상만 보고 바로 경로 선택 금지. 재현 + spec 대조 + 원인 위치 확정이 선행되어야 한다.
- **"spawn 성공 = 기능 동작"으로 착각**: 프로세스가 에러 없이 종료되는 것과 실제로 서비스가 기동되어 요청을 처리하는 것은 완전히 다른 조건이다. 특히 stdin-driven 서버에서 `</dev/null` 로 보낸 뒤 exit 0 을 보고 "OK" 로 처리하면 실패를 성공으로 오인한다. 실제 프로토콜 요청을 보내 응답 수신까지 확인해야 한다. v0.13.4 가 이 착각으로 반쪽 fix 로 배포되어 v0.13.5 hotfix 가 필요했다. 이어서 §5-3 이 세 단계(PATH 노출 / handshake 응답 / `opencode mcp list`)로 분해됐다.
- **"shim 이 import 만으로 충분"으로 착각**: 재사용하려는 upstream 엔트리가 `isDirectRun` 같은 가드로 보호되어 있으면 dynamic import 만으로는 main 이 호출되지 않는다. 반드시 exported entrypoint 를 이름 기준으로 import 해서 명시적으로 호출하라. 단순히 `await import("@pkg/entry")` 는 upstream 이 "direct run" 을 전제로 설계된 경우 no-op 이 된다.
