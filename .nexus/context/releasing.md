<!-- tags: release, npm, github-actions, checklist -->
# 릴리즈 체크리스트

이 문서는 에이전트가 `opencode-nexus`를 배포하기 직전에 스스로 확인할 항목만 정리한 체크리스트다.

원격 서비스 상태처럼 이 레포와 로컬 명령만으로 검증할 수 없는 항목은 포함하지 않는다.
예를 들어 npm Trusted Publisher가 실제로 연결되어 있는지는 이 문서의 체크 대상이 아니다.

## 1. 버전과 태그

- 이번 변경이 patch인지 minor인지 먼저 결정
- pre-v1 정책에 따라 breaking change가 있으면 patch가 아니라 minor를 선택
- breaking change가 없으면 patch를 우선 검토
- `package.json`의 `version`이 위 결정과 일치하는지 확인
- 생성 예정 태그가 있다면 형식이 `vX.Y.Z`인지 확인
- 생성 예정 태그 버전이 `package.json` 버전과 정확히 일치하는지 확인
- 가능하면 `npm view opencode-nexus versions --json`로 같은 버전이 이미 배포되었는지 확인

### 1-1. README 버전 표기 규칙

- **설치 / 업그레이드 명령 예시**: 항상 `opencode-nexus@latest` 를 기준으로 작성한다. 매 릴리즈마다 버전 숫자를 고칠 필요 없고, 사용자가 구 버전을 실수로 설치하는 위험도 없다.
- **옵션 pin 설명용 예시**: "특정 버전 pin 하려면 `@x.y.z`" 라는 언급 안에서만 숫자를 쓴다. 이 숫자는 illustrative 이므로 최신 버전을 채워두는 것을 권장하지만, 일치하지 않아도 릴리즈 blocker 는 아님.
- **`opencode.json` 예시 블록**: install CLI 가 "현재 실행 중인 CLI 버전"을 자동 pin 한다는 동작을 보여주는 예시다. 이 블록의 JSON 안 버전 숫자는 가급적 현재 릴리즈 버전으로 맞춰두되, 놓쳤다고 해서 release gate 가 깨지지는 않는다.
- CHANGELOG 의 각 버전 entry 는 별도 규칙 (§13) 을 따른다. `@latest` 대체 불가.

## 2. 작업트리 상태

- `git status --short`로 현재 변경사항을 확인
- 의도하지 않은 임시 파일, tarball, 테스트 산출물, 디버그 파일이 없는지 확인
- generated 파일이 최신인지 확인 (`bun run sync` 또는 `bun run sync:dry` 기준)

## 3. 자동 검증 명령

- `bun install` 실행
- `bun run check` 통과 확인
- `bun run test:e2e` 통과 확인
- `npm pack --dry-run` 결과에서 의도한 파일만 포함되는지 확인

위 네 단계 중 하나라도 실패하면 배포를 진행하지 않는다.

## 4. 패키지 결과물 점검

- `npm pack --dry-run` 결과에 다음이 포함되는지 확인
  - `README.md`
  - `LICENSE`
  - `package.json`
  - `bin/`
  - `lib/`
  - `src/`
  - `skills/`
- `npm pack --dry-run` 결과에 다음이 포함되지 않는지 확인
  - `.github/`
  - 임시 디렉토리
  - 불필요한 테스트 전용 파일

## 5. install 결과 불변조건 점검

임시 디렉토리에서 아래를 자동으로 재현해 확인한다.

1. 빈 디렉토리 생성
2. `node bin/opencode-nexus.mjs install --scope=project --skip-models` 실행
3. 생성된 `opencode.json` 확인
4. 생성된 `.opencode/skills/` 확인

반드시 확인할 항목:

- `plugin`이 현재 CLI 버전으로 pin되는지 확인
- `mcp.nx`가 `{"type":"local","command":["nexus-mcp"]}`인지 확인
- `default_agent`가 `lead`인지 확인
- `agent.build.disable === true`인지 확인
- `agent.plan.disable === true`인지 확인
- `.opencode/skills/` 아래에 `nx-auto-plan`, `nx-plan`, `nx-run`이 복사되는지 확인

### 5-1. Skill frontmatter 스펙 준수 (OpenCode Agent Skills spec)

OpenCode는 `name` / `description` 두 필드가 모두 있어야 skill을 등록한다. 이 검증을 생략하면 skill이 말없이 사라지며 "Available skills: none" 만 남는다. 배포된 후에야 사용자 신고로 발견하면 hotfix 릴리즈가 불가피하다.

생성된 각 `.opencode/skills/<name>/SKILL.md`에 대해 확인한다:

- frontmatter에 `name: <name>` 라인이 존재하는지 확인 (디렉토리명과 정확히 일치)
- frontmatter에 `description:` 라인이 존재하는지 확인 (1-1024자)
- `name` 값이 regex `^[a-z0-9]+(-[a-z0-9]+)*$` 를 만족하는지 확인
- `name` 값이 `-` 로 시작/끝나지 않고 `--` 를 포함하지 않는지 확인
- OpenCode가 인식하지 않는 프런트매터 필드(예: `triggers`) 는 무시되므로 필수가 아니지만, 있다면 번들 크기를 낭비할 뿐임을 인지

### 5-2. Live load smoke test (권장)

정적 검증만으로는 OpenCode 런타임에서 실제로 load되는지 확신할 수 없다. 최소 한 가지 방법으로 실제 로드를 확인한다:

- OpenCode를 실행해 `/skills` 또는 `skill` 툴 응답에 `nx-plan`, `nx-auto-plan`, `nx-run` 3개가 모두 보이는지 확인
- 또는 `[plan]` 태그로 메시지를 보내 `Skill "nx-plan" not found` 가 발생하지 않는지 확인

이 단계를 수동으로라도 한 번 거친다. 특히 업스트림 nexus-core의 generate 로직이 바뀐 릴리즈는 반드시 수행한다.

### 5-3. MCP binary reachability + handshake (필수)

OpenCode는 `opencode.json`의 `mcp.nx.command`를 spawn하는 방식으로 MCP 서버를 구동한다. 이 구동은 세 단계로 나눠 각각 검증해야 한다. 어느 한 단계라도 통과 못하면 OpenCode는 `nx_*` 툴을 unavailable로 처리하고 사용자 세션은 아무 에러 없이 broken 상태로 계속 돌아간다. 스펙 위반이 아니라 실행 경로/런타임 조건 문제라 정적 검증만으로는 절대 잡을 수 없다.

격리된 임시 prefix로 글로벌 설치를 시뮬레이션한다:

```bash
TEMPDIR=$(mktemp -d)
npm pack --pack-destination "$TEMPDIR"
export NPM_CONFIG_PREFIX="$TEMPDIR/npm-prefix"
mkdir -p "$NPM_CONFIG_PREFIX"
npm install -g "$TEMPDIR"/opencode-nexus-*.tgz
```

이어서 세 단계를 모두 확인한다.

#### (a) PATH 노출

- `$NPM_CONFIG_PREFIX/bin/`에 `opencode-nexus` **와** `nexus-mcp` 심볼릭 링크가 모두 생성되는지 확인
- `opencode.json`의 `mcp.nx.command`에 쓰이는 모든 실행 파일명이 해당 bin 디렉터리에 실제로 존재하는지 확인

의존성이 제공하는 바이너리를 wrapper의 `command`에 그대로 쓰는 경우, 그 바이너리를 wrapper의 `package.json` `bin` 섹션에도 re-export 선언하는 것이 원칙이다. 그렇지 않으면 transitive dep의 bin은 글로벌 PATH에 symlink되지 않는다.

#### (b) Handshake 응답 수신

PATH에 노출됐다고 서버가 살아있음을 의미하지는 않는다 (**v0.13.4에서 이 단계를 놓쳐 2차 hotfix가 필요했다**). `</dev/null`로 stdin을 닫고 "에러 없이 종료되면 OK"로 처리하면 **실패를 성공으로 오인**한다. 반드시 실제 MCP handshake를 보내서 응답을 받아야 한다:

```bash
(echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'; sleep 1) \
  | timeout 3 "$NPM_CONFIG_PREFIX/bin/nexus-mcp" 2>&1
```

확인 항목:
- stdout에 `"jsonrpc":"2.0"`, `"id":1`, `"serverInfo":{"name":"nexus-core"...}`가 포함된 JSON-RPC 응답이 돌아오는지 확인
- stderr에 fatal 에러 메시지가 없는지 확인
- 서버가 조용히 즉시 종료되지 않는지 (즉 timeout에 걸려서 kill되는 게 정상) 확인

#### (c) `opencode mcp list` 확인

로컬에 OpenCode가 설치되어 있고 `opencode.json`이 우리 pinned 버전을 가리키는 경우, 실제 호스트 수준에서도 확인한다:

```bash
opencode mcp list
```

- `nx` 항목이 `failed` 없이 떠야 함 (예: `✗ nx failed. Executable not found in $PATH` 또는 `MCP error -32000: Connection closed`는 모두 fail)
- PATH 노출과 handshake가 모두 통과되었으면 여기서도 녹색으로 떠야 한다

이 세 단계를 생략하면 사용자 환경에서 MCP가 조용히 기동되지 않는 회귀(v0.13.1~v0.13.4에서 반복 발생)가 또 나온다. "spawn이 에러 없이 종료된다" 와 "MCP가 정상 동작한다"는 완전히 다른 조건이라는 점을 기억하라.

## 5-4. uninstall 결과 불변조건 점검

빈 임시 디렉터리에서 install → uninstall --force 수행 후 확인:

- `opencode.json` 파일이 존재하지 않음(완전 빈 객체로 귀결).
- `.opencode/` 디렉터리가 존재하지 않음.

비-Nexus 엔트리가 섞인 기존 config가 있을 때 install → uninstall --force:

- `plugin[]`에서 `opencode-nexus@*` 엔트리만 제거, 다른 plugin 엔트리는 그대로.
- `mcp`에서 `nx`만 제거, 다른 mcp 엔트리는 그대로.
- `default_agent`가 `"lead"`였으면 제거.
- `agent.build.disable=true`/`agent.plan.disable=true`였으면 해당 leaf 제거, 다른 agent 속성·다른 agent는 그대로.
- `$schema`는 기본 모드에서 그대로 유지.
- Nexus 스킬 3개(`nx-auto-plan`, `nx-plan`, `nx-run`) 디렉터리 삭제.

drift 상태(`default_agent`나 `mcp.nx.command`를 수정핸 상태)에서 uninstall:

- 기본 모드: Nexus 소유가 명확한 plugin/스킬은 제거되지만 drift된 leaf는 warning과 함께 보존. warning 문구: `left mcp.nx unchanged (use --force to remove)` 같은 install 대칭 형식.
- `--force`: drift된 leaf도 강제 제거.

비-TTY(non-interactive)에서 `--force` 없이 uninstall 호출:

- exit code != 0, stderr에 `Use --force for non-interactive removal` 포함.
- 파일/디렉터리 상태 미변경.

두 번 연속 uninstall 실행:

- 두 번째 호출은 에러 없이 exit 0.
- 출력에 `nothing to remove` 포함.

빈 컨테이너 자동 정리:

- leaf 제거 후 `plugin`이 `[]`, `mcp`가 `{}`, `agent.build`/`agent.plan`이 `{}`, `agent`가 `{}`면 각각 해당 키 제거.
- `.opencode/skills/` 또는 `.opencode/`가 비면 디렉터리 삭제. 다른 파일이 하나라도 있으면 보존.

### 5-5. cmux 통합 동작 점검

#### 5-5-1. cmux 활성 환경에서 확인 (CMUX_WORKSPACE_ID 설정 + OPENCODE_NEXUS_CMUX 미설정/1)

- `session.idle`(root) → `cmux notify --title "opencode-nexus" --body <...>` + `cmux set-status nexus-state "Needs Input" --icon bell.fill --color "#007AFF"` 둘 다 호출된다. 기본 모드에서는 `--body`에 응답 텍스트의 첫 100자(공백 collapse + 초과 시 `…`)가 들어가고 `[Pre-check]` 블록은 자동 skip된다. `OPENCODE_NEXUS_NOTIFY_PREVIEW=0` 또는 `false` 환경에서는 고정 문자열 `"Response ready"`로 복원된다. 응답 텍스트 캐시가 비어 있거나 Pre-check만 있는 경우에도 `"Response ready"` fallback. pill은 `clear-status`가 아니라 `Needs Input`으로 전환되므로 사이드바에 사용자 턴 신호가 남는다.
- `session.status` + `status.type === "busy"`(root) → `cmux set-status nexus-state "Running" --icon bolt --color "#007AFF"`가 호출된다. 내부 text 캐시는 이 시점에 건드리지 않는다(v0.16.2 변경). OpenCode가 한 턴에 busy를 여러 번 fire하므로 busy에서 캐시를 지우면 assistant text가 캐시되자마자 다시 삭제되어 session.idle preview가 무너진다.
- `session.status` + `status.type === "busy"`(root, **idle→running 전이 첫 fire**) → `cmux clear-log`가 `set-status Running` **앞서** 호출된다(v0.16.4 추가). 이전 턴에서 기록된 `[nexus] [error] ...` 엔트리(예: stale MessageAbortedError)가 새 사용자 턴 시작과 함께 자동 제거되도록 하는 turn-boundary reset. 같은 턴 내 후속 busy 이벤트는 `sessionRunning: Set<string>` 기반 dedup으로 `clear-log`를 재호출하지 않는다(OpenCode가 턴당 busy를 ~4회 fire). 턴 종료 이벤트(`session.idle` / `session.status idle` / `session.error` abort·fatal / `session.deleted`)에서 sessionRunning에서 delete되어 다음 busy가 다시 전이로 감지된다. `permission.replied`는 mid-turn 재개이므로 delete하지 않는다. `cmux clear-log` CLI가 `--source` 필터를 지원하지 않아 호출 시 workspace 전 로그가 지워지는 부수 효과는 의도된 트레이드오프(자세히는 `empirical-cmux-log-turn-reset.md`). e2e cmux-t/u/v/w가 이 경로를 회귀 확인한다.
- `session.status` + busy(non-root) → 어떤 cmux 호출도 발생하지 않는다.
- `tool.execute.before` + `tool === "question"` → `cmux notify --title "opencode-nexus" --body "Waiting for your input"`와 `cmux set-status nexus-state "Needs Input" --icon bell.fill --color "#007AFF"`가 모두 호출된다.
- `permission.ask` hook → `cmux notify --title "opencode-nexus" --body "Permission requested"`와 `cmux set-status nexus-state "Needs Input" --icon bell.fill --color "#007AFF"`가 모두 호출된다.
- `permission.replied`(root) → `cmux clear-status nexus-state`가 호출된다.
- `session.error`(root) → `cmux log --level error --source nexus -- <요약>`, `cmux notify --title "opencode-nexus" --body "Session error"`, 그리고 `cmux clear-status nexus-state`가 모두 호출된다. 마지막 clear-status가 빠지면 MessageAbortedError 같은 abort 경로에서 `Running` pill이 stuck된다(v0.15.1에서 수정된 회귀 사례).
- `session.error` + `error.name === "MessageAbortedError"`(root) → `cmux notify` 없음, `cmux log --level error` 없음, `cmux set-status nexus-state "Needs Input" --icon bell.fill --color #007AFF` 호출 확인.
- `session.error` + `error.name !== "MessageAbortedError"`(root, 예: DatabaseError) → 기존 경로 유지(log error + notify "Session error" + clear-status) 확인.
- `session.status` + `status.type === "idle"`(root) → `cmux set-status nexus-state "Needs Input" --icon bell.fill --color "#007AFF"`가 호출된다. `session.idle` 이벤트가 fire하지 않는 경로에 대한 2차 방어선이며 pill 전환 방향은 session.idle과 동일(사용자 턴). 이 bullet이 빠지면 특정 abort/정상 완료 시나리오에서 pill이 `Running`으로 stuck된다.
- `session.status` + `status.type === "retry"` → `cmux log --level warning --source nexus -- <메시지>`가 호출되고 pill은 변경되지 않는다.
- **cmux CLI 호출은 직렬화(serialize)된다** — 여러 훅에서 연속 발행된 `cmux set-status` / `cmux clear-status` / `cmux notify` 등이 plugin이 의도한 순서 그대로 cmux 서버에 도달해야 한다. 예를 들어 `session.status busy` 직후 `session.idle`이 fire되면 반드시 `set-status` → `clear-status` 순서로 처리되어야 pill이 최종 clear 상태가 된다. 이 직렬화가 깨지면(이전 fire-and-forget detached spawn 구조처럼 OS fork 스케줄링에 맡겨지면) `clear`가 `set`보다 먼저 socket에 도달해 pill이 `Running`으로 stuck된다(v0.16.0에서 수정된 회귀 사례). e2e의 cmux-k scenario가 이 순서 보장을 회귀 확인한다.
- **assistant 턴 경계는 `message.part.updated`의 `step-start` marker로 판별된다** (v0.16.2). `session.status busy`가 아니라 step-start에서 assistant 턴을 시작으로 표시하고 내부 text 캐시를 초기화한다. 그 뒤 오는 text part만 preview 캐시에 반영된다. 이 경계 판정이 무너지면 (예: user input text까지 캐싱) preview에 엉뚱한 문자열이 나오거나, 반대로 assistant text가 캐싱되지 못해 fallback `"Response ready"`가 뜬다. e2e의 cmux-l(positive)·cmux-p(이전 턴 누출 방지)·cmux-q(step-start 없는 text 거부)가 이 경계를 회귀 확인한다.

#### 5-5-2. cmux 비활성 환경에서 확인 (CMUX_WORKSPACE_ID 미설정 또는 OPENCODE_NEXUS_CMUX=0/false)

- `session.idle`(root)를 재생해도 `cmux` 바이너리가 호출되지 않는다.
- `session.status` + `status.type === "busy"`(root)를 재생해도 `cmux` 바이너리가 호출되지 않는다(set-status뿐만 아니라 v0.16.4에서 추가된 `clear-log`도 마찬가지로 미호출).
- `tool.execute.before` + `tool === "question"`를 재생해도 `cmux` 바이너리가 호출되지 않는다.
- `permission.ask` hook을 재생해도 `cmux` 바이너리가 호출되지 않는다.
- `permission.replied`(root)를 재생해도 `cmux` 바이너리가 호출되지 않는다.
- `session.error`(root)를 재생해도 `cmux` 바이너리가 호출되지 않는다.
- `session.status` + `status.type === "retry"`를 재생해도 `cmux` 바이너리가 호출되지 않는다.
- plugin의 다른 기능(`install`, `models`, `chat.message` 등)에 영향이 없다.

## 6. 병합 동작 점검

기존 설정 파일이 있을 때도 의도한 키만 바뀌는지 확인한다.

- 기존 `plugin`의 unrelated entry가 보존되는지 확인
- 기존 `mcp`의 unrelated entry가 보존되는지 확인
- 기존 `default_agent` 또는 `mcp.nx` 충돌 시 `--force` 없이 덮어쓰지 않는지 확인
- 기존 bare package entry가 있으면 현재 버전 pin 하나로 정규화되는지 확인

## 7. CLI UX 점검

이 항목은 사람이 손으로 눌러보는 대신, 가능한 한 재현 가능한 방식으로 확인한다.

- install interactive 첫 화면이 scope 선택으로 시작하는지 확인
- models interactive 첫 화면이 scope 선택으로 시작하는지 확인
- models 메인 화면에 다음이 모두 보이는지 확인
  - `lead`
  - `general`
  - `explore`
  - Nexus subagent 전체
- 각 agent 줄이 `[ ] name  > current-model` 형태로 보이는지 확인
- 메인 화면에 `Next`, `Done`, `Cancel`이 함께 보이는지 확인
- provider 선택 -> model 선택 -> 메인 화면 복귀 흐름이 유지되는지 확인
- direct mode로 `lead`, `general`, `explore` 모델 override가 실제 파일에 기록되는지 확인
- uninstall 인터랙티브 실행 시 `--scope` 미지정이면 scope 선택 화면이 project/user 두 옵션으로 먼저 뜨는지(install과 동일 패턴)
- `--force` 없을 때 TTY에서 `Remove opencode-nexus config from <scope>?` 확인 프롬프트가 기본값 "Cancel"(no)로 뜨는지
- `--scope=both` 호출 시 확인 프롬프트와 dry-run 헤더에 `project AND user`가 명시되는지

UI를 변경한 릴리즈라면 `expect` 같은 도구로 첫 화면 캡처까지 남기는 것이 좋다.

## 8. 문서 정합성 점검

- README가 `Node.js >= 22` 요구사항을 명시하는지 확인
- README가 `node` 실행 기반이고 `bun`은 설치 도구로 지원한다고 설명하는지 확인
- README의 install 예시가 현재 실제 CLI 흐름과 일치하는지 확인
- README의 upgrade 설명이 현재 install 동작과 일치하는지 확인

## 9. GitHub Actions 점검

- `.github/workflows/validate.yml`가 존재하는지 확인
- `.github/workflows/publish-npm.yml`가 존재하는지 확인
- publish workflow 경로/파일명이 Trusted Publishing 계약과 맞는지 레포 기준으로 확인
- `validate.yml`가 `bun run check`, `bun run test:e2e`, `npm pack --dry-run`을 실행하는지 확인
- `publish-npm.yml`가 태그 push에서 동작하도록 설정되어 있는지 확인
- `publish-npm.yml`가 `npm publish --provenance --access public`를 사용하는지 확인
- `publish-npm.yml`가 `id-token: write` 권한을 선언하는지 확인
- `publish-npm.yml`가 git tag와 `package.json` 버전 일치 여부를 검증하는지 확인

## 10. PR 규칙

- 릴리즈에 포함될 수정사항은 가능하면 `main`에 직접 커밋하지 않고 작업 브랜치에서 정리한다
- 배포 전에 브랜치에 릴리즈 관련 수정이 남아 있다면 `main` 병합은 PR 경로를 우선 사용한다
- PR을 만들기 전 최소한 다음 로컬 검증이 끝나 있어야 한다
  - `bun run check`
  - `bun run test:e2e`
  - `npm pack --dry-run`
- PR 설명에는 최소한 다음 내용을 포함한다
  - 왜 이 릴리즈가 필요한지
  - 버전 결정 근거 (patch/minor)
  - 사용자에게 보이는 변경점
  - install/models UX나 publish 흐름에 영향이 있는지 여부
- validate workflow가 있는 변경은 PR 병합 전에 `validate.yml` 기준이 깨지지 않도록 유지한다
- 태그 생성은 PR 병합 후 `main` 기준 상태에서 진행하는 것을 원칙으로 한다

## 11. 브랜치 정리 규칙

- PR이 병합되어 더 이상 작업이 남지 않은 브랜치는 정리 대상이다
- 다음 브랜치는 삭제하지 않는다
  - 현재 작업 중인 브랜치
  - 아직 병합되지 않은 브랜치
  - 후속 릴리즈나 hotfix를 위해 유지하기로 명시한 브랜치
  - 기본 브랜치 (`main`, `master`)
- 정리 대상 브랜치는 병합 완료 후 로컬 브랜치부터 삭제한다
- 원격 브랜치도 더 이상 필요 없으면 같이 삭제한다
- 브랜치를 삭제하기 전에는 그 브랜치에만 남아 있는 미출시 커밋이 없는지 확인한다
- 릴리즈 태그는 브랜치 정리 대상이 아니므로 삭제 규칙과 분리해서 다룬다

## 12. GitHub Release 규칙

- GitHub Release는 릴리즈 태그와 1:1로 대응시킨다
- Release 제목과 태그는 같은 버전 문자열을 사용한다 (`vX.Y.Z`)
- Release는 `main`에 병합된 기준 상태와 일치해야 한다
- validate 실패 상태, publish 실패 상태, 버전 불일치 상태에서는 Release를 확정하지 않는다
- GitHub Release 본문은 해당 버전의 `CHANGELOG.md` 항목을 기준으로 작성한다
- Release를 먼저 쓰고 CHANGELOG를 나중에 맞추지 않는다. 기준은 항상 CHANGELOG다
- CHANGELOG에 없는 내용을 Release 본문에 임의로 추가하지 않는다. 필요하면 먼저 CHANGELOG를 수정한 뒤 Release에 반영한다
- Release 본문에는 최소한 다음 내용을 포함한다
  - 이번 릴리즈의 핵심 변경 요약
  - 최종 사용자에게 보이는 변경점
  - install 또는 models UX에 영향이 있는지 여부
  - breaking change 여부
  - breaking change가 있다면 필요한 대응 또는 migration 안내
- pre-v1 정책상 minor에 breaking change가 들어갈 수 있으므로, minor 릴리즈에서는 호환성 영향 여부를 본문에 명시한다
- 검증 결과를 Release 본문에 남길 수 있으면 다음을 함께 적는다
  - `bun run check`
  - `bun run test:e2e`
  - `npm pack --dry-run`
- GitHub Release를 작성할 때 npm 패키지 버전, git tag, README 예시 버전이 서로 어긋나지 않는지 다시 확인한다
- 자동 생성된 릴리즈 노트를 그대로 쓰기보다, 실제 사용자 관점에서 중요한 변경과 주의사항을 수동으로 정리하는 쪽을 우선한다

## 13. CHANGELOG 정리 규칙

- `CHANGELOG.md`는 정식 운영 대상이며, 릴리즈 태그를 만들기 전에 같은 변경셋 안에서 반드시 함께 업데이트한다
- CHANGELOG 항목의 버전은 `package.json` 버전, git tag, GitHub Release 버전과 일치해야 한다
- GitHub Release 본문은 해당 버전의 CHANGELOG 항목을 요약하거나 재구성한 것이어야 한다
- CHANGELOG는 커밋 목록 복붙이 아니라 최종 사용자 관점의 변경 요약만 남긴다
- 내부 리팩터링처럼 사용자 영향이 거의 없는 내용은 필요할 때만 간단히 적고, 기본적으로는 사용자 영향이 있는 변경을 우선 기록한다
- install, models, publish 흐름처럼 사용 방식이 바뀌는 수정은 반드시 CHANGELOG에 남긴다
- breaking change가 있으면 별도 표시를 두고, 필요한 migration 또는 대응 방법을 함께 적는다
- pre-v1 minor 릴리즈에 breaking change가 들어간 경우, minor bump 이유가 CHANGELOG에서 드러나야 한다
- CHANGELOG와 GitHub Release가 서로 모순되지 않게 유지한다
- CHANGELOG는 장기 누적 기록으로, GitHub Release보다 더 안정적이고 압축된 서술을 목표로 한다
- GitHub Release 본문은 배포 시점 안내와 강조 포인트 중심으로 쓰되, 내용의 출처는 CHANGELOG여야 한다
- CHANGELOG에 새 버전 항목을 추가했다면, 같은 PR 안에서 README 예시 버전과 릴리즈 문서도 함께 맞춘다

## 14. 배포 직전 종료 조건

- 위 항목 중 하나라도 확인 실패 시 태그를 만들지 않는다
- 로컬/레포만으로 검증 불가능한 외부 상태를 "확인됨"으로 간주하지 않는다
- 자동 검증, 패키지 점검, CLI 점검이 모두 통과했을 때만 태그 생성 및 push를 진행한다
