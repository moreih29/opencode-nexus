# opencode-nexus

OpenCode에서 Nexus Core 기반 에이전트, 스킬, MCP 구성을 빠르게 설치하고 유지하기 위한 플러그인입니다.

- npm: https://www.npmjs.com/package/opencode-nexus
- 라이센스: https://github.com/moreih29/opencode-nexus/blob/main/LICENSE
- English README: https://github.com/moreih29/opencode-nexus/blob/main/README.en.md

## 무엇을 해주나요?

`opencode-nexus`는 OpenCode 프로젝트에 아래 구성을 자동으로 맞춥니다.

- `plugin: ["opencode-nexus@<현재버전>"]` pin
- `mcp.nx` 등록 (`nexus-mcp`)
- `default_agent: "lead"`
- OpenCode 기본 primary인 `build`, `plan` 숨김
- Nexus Core 스킬 복사
  - `nx-auto-plan`
  - `nx-plan`
  - `nx-run`
- `lead`, `general`, `explore`, Nexus subagent용 모델 설정 도우미 제공

## 요구사항

- `Node.js >= 22`
- OpenCode 설치 및 사용 가능 환경

CLI 실행은 `node` 기준입니다. `bun`으로 패키지를 설치할 수는 있지만, `opencode-nexus` 명령 자체는 Node로 실행됩니다.

## 설치

가장 권장하는 방법은 전역 설치입니다.

```bash
npm install -g opencode-nexus@latest
opencode-nexus install
```

일회성 실행만 원하면:

```bash
npx opencode-nexus@latest install
```

`bun`으로 설치해도 됩니다.

```bash
bun install -g opencode-nexus@latest
opencode-nexus install
```

특정 버전에 고정하려면 `@latest` 대신 `@x.y.z` 형태로 지정하세요 (예: `npm install -g opencode-nexus@0.18.1`).

설치된 CLI 버전은 `opencode-nexus --version` 또는 `opencode-nexus version`으로 확인할 수 있습니다.

## install이 하는 일

interactive terminal에서 `opencode-nexus install`을 실행하면:

1. 설치 scope 선택
2. 지금 agent model을 설정할지 선택

설치 결과로 아래가 반영됩니다.

- `opencode.json` 생성 또는 병합
- `.opencode/skills/` 아래에 Nexus 스킬 복사
- 현재 실행 중인 CLI 버전으로 plugin pin

`install`은 항상 **현재 실행 중인 CLI 버전**을 plugin entry에 기록합니다. 예를 들어 현재 설치된 CLI가 `0.18.1`이면 다음과 같이 기록됩니다.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-nexus@0.18.1"],
  "mcp": {
    "nx": {
      "type": "local",
      "command": ["nexus-mcp"]
    }
  },
  "default_agent": "lead"
}
```

추가로 install은 아래 기본값도 함께 맞춥니다.

- `agent.build.disable: true`
- `agent.plan.disable: true`

## Scope

- `project`: 현재 프로젝트의 `./opencode.json`에 기록
- `user`: `~/.config/opencode/opencode.json`에 기록
- `both`: user/project에 나눠서 기록

직접 지정하고 싶으면:

```bash
opencode-nexus install --scope=project
```

모델 설정 wizard를 건너뛰려면:

```bash
opencode-nexus install --scope=project --skip-models
```

## Agent Models

모델 설정 화면은 언제든 다시 열 수 있습니다.

```bash
opencode-nexus models
```

지원 대상:

- `lead`
- OpenCode built-in: `general`, `explore`
- Nexus subagents:
  - `architect`
  - `designer`
  - `postdoc`
  - `strategist`
  - `engineer`
  - `researcher`
  - `writer`
  - `reviewer`
  - `tester`

interactive 화면에서는:

- 체크박스로 여러 agent를 한 번에 선택
- provider 선택
- model 선택
- 메인 화면으로 복귀 후 반복 설정

자동화나 스크립트 용도로는 direct mode도 지원합니다.

```bash
opencode-nexus models --scope=project --agents=lead,general,explore --model=openai/gpt-5.4
```

## Uninstall

설치한 Nexus 구성을 되돌리려면 `uninstall` 명령을 사용합니다.

```bash
opencode-nexus uninstall --scope=project
```

지원하는 scope는 `project`, `user`, `both`입니다. `Scope` 섹션의 설명이 uninstall에도 그대로 적용됩니다.

interactive 터미널에서 `--scope`를 생략하면 install과 동일하게 scope 선택 화면이 먼저 표시됩니다. `--force`가 없으면 `Remove opencode-nexus config from <scope>?` 확인 프롬프트가 뜨며, 기본값은 "Cancel"(no)입니다.

비-TTY 환경(CI나 스크립트)에서는 `--force`가 필수입니다. 없으면 `Use --force for non-interactive removal` 에러와 함께 종료됩니다.

```bash
opencode-nexus uninstall --scope=project --force
```

`--dry-run`을 주면 실제 변경 없이 제거 계획만 출력합니다(install의 `--dry-run`과 대칭).

```bash
opencode-nexus uninstall --scope=project --dry-run
```

### 되돌리는 대상

uninstall은 다음 항목만 제거합니다:

- `plugin` 배열의 `opencode-nexus@*` 엔트리(pin)
- `mcp.nx` 서버 등록
- `default_agent`가 `"lead"`인 경우 해당 값
- `agent.build.disable` 및 `agent.plan.disable`이 `true`인 경우 해당 leaf
- `.opencode/skills/` 아래에 복사된 Nexus 스킬 디렉터리
  - `nx-auto-plan`
  - `nx-plan`
  - `nx-run`

### 보존하는 대상

사용자가 직접 추가한 다른 `plugin` 엔트리, `mcp`의 다른 서버 등록, `agent`의 다른 속성(예: 모델 설정), `$schema`는 기본 모드에서 그대로 유지됩니다.

### drift 처리

사용자가 `mcp.nx.command`나 `default_agent`를 변경한 상태(drift)라면, 기본 모드에서는 warning을 출력하고 해당 값은 보존합니다. `--force`를 주면 drift된 값도 강제로 제거합니다.

### 멱등성

uninstall은 두 번 실행할 수 있습니다. 이미 제거된 상태에서는 `nothing to remove for scope: ... (no opencode-nexus markers found)` 메시지와 함께 성공(exit 0)으로 종료됩니다.

### 빈 컨테이너 자동 정리

leaf 제거 후 `plugin` 배열이 비거나 `mcp` 객체가 비면 해당 키 자체가 제거됩니다. `agent.build`나 `agent.plan`이 비면 상위 `agent` 키도 정리되며, `opencode.json`이 완전히 빈 객체가 되면 파일 자체가 삭제됩니다. 스킬 상위 디렉터리(`.opencode/skills/`, `.opencode/`)가 비면 함께 정리됩니다.

## cmux 통합 (데스크톱 알림)

[cmux](https://github.com/coder/mux) 데스크톱 앱 안에서 OpenCode 를 실행 중이라면, Nexus plugin 이 두 시점에 OS 네이티브 알림을 자동으로 띄웁니다.

- **응답 완료**: Lead 의 한 턴이 끝나 사용자 입력을 기다리는 상태로 돌아갈 때 "Response ready"
- **사용자 질문 대기**: Lead 또는 서브에이전트가 `question` 툴을 호출하는 순간 "Waiting for your input"

활성화 조건: cmux 가 자동으로 설정하는 `CMUX_WORKSPACE_ID` 환경변수가 있을 때만 동작합니다. cmux 밖에서 실행 중이면 알림 코드는 no-op 이므로 다른 환경에 영향이 없습니다.

비활성화하려면 shell 환경에 다음을 export 하세요.

```bash
export OPENCODE_NEXUS_CMUX=0
```

cmux 가 없어도, 환경변수가 없어도, 모두 silent fallback 되며 plugin 의 다른 기능은 그대로 작동합니다.

### 사이드바 상태 표시

cmux 사이드바에 작업 상태 pill을 함께 표시합니다.

- `Running` — `bolt` 아이콘, 파란색(`#007AFF`). 에이전트가 작업을 진행 중일 때.
- `Needs Input` — `bell` 아이콘, 파란색. 에이전트가 사용자 응답을 기다리는 모든 순간(`question` 툴 + permission 요청 공통).

상태는 root session 기준으로만 추적됩니다(subagent 상태는 제외, 기존 `session.idle` 정책과 동일).

### Permission 알림

에이전트가 권한을 요청하는 순간 `"Permission requested"` 토스트와 함께 사이드바 pill이 `Needs Input`으로 전환됩니다.

### Error 로그·알림

`session.error` 발생 시 사이드바 로그에 `error` 레벨로 기록(`cmux log --level error --source nexus`)하고 `"Session error"` 토스트를 띄웁니다.

재시도(`session.status: retry`)는 토스트 없이 사이드바 로그에 `warning` 레벨로만 기록합니다(noise 최소화).

새로 추가된 상태 표시와 알림도 위 `OPENCODE_NEXUS_CMUX` 환경변수로 동일하게 비활성화할 수 있습니다.

## 업그레이드

다음 버전으로 올릴 때는 CLI를 업그레이드한 뒤 `install`을 다시 실행하세요.

```bash
npm install -g opencode-nexus@latest
opencode-nexus install --scope=project
```

`install`은 항상 현재 실행 중인 CLI 버전을 기준으로 plugin을 pin합니다.
즉 다른 버전을 적용하고 싶으면, 먼저 그 버전의 CLI를 설치한 뒤 `install`을 다시 실행해야 합니다.

## 이 패키지가 배포하는 것

이 저장소는 `@moreih29/nexus-core` 위에 얇은 OpenCode wrapper를 제공합니다.

- 런타임 plugin entry
- install / models CLI
- OpenCode용 generated agents
- OpenCode용 bundled skills

핵심 스펙과 오케스트레이션 규칙 자체는 `@moreih29/nexus-core`를 기준으로 합니다.

## 개발

이 저장소는 자체 dogfooding을 위해 `opencode-nexus`를 자신의 `.opencode/` 에 설치하는 구조입니다. install 산출물 — `opencode.json`, `.opencode/skills/`, 그리고 그 아래 부속 파일들 — 은 모두 gitignore 되어 있어 clone 직후 한 번 bootstrap이 필요합니다. 특히 per-agent model 선택(provider 별 취향)은 tracked 대상이 아니므로 각자 `opencode-nexus models` 로 별도 설정합니다.

```bash
bun install
bun run bootstrap       # sync + 기본 opencode.json 생성 + .opencode/ install (최초 1회)
opencode-nexus models   # (선택) per-agent model 개별 설정
bun run check
bun run test:e2e
```

이후 `@moreih29/nexus-core` 를 올릴 때는 `bun run sync` 로 `skills/`, `src/agents/` 를 재생성하고, 필요하면 `bun run bootstrap` 을 한 번 더 돌려 로컬 `.opencode/` 와 `opencode.json` 의 plugin pin 을 갱신하세요. 기존에 설정해둔 model override는 bootstrap 이 덮어쓰지 않고 유지됩니다.
