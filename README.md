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
npm install -g opencode-nexus@0.13.5
opencode-nexus install
```

일회성 실행만 원하면:

```bash
npx opencode-nexus@0.13.5 install
```

`bun`으로 설치해도 됩니다.

```bash
bun install -g opencode-nexus@0.13.5
opencode-nexus install
```

## install이 하는 일

interactive terminal에서 `opencode-nexus install`을 실행하면:

1. 설치 scope 선택
2. 지금 agent model을 설정할지 선택

설치 결과로 아래가 반영됩니다.

- `opencode.json` 생성 또는 병합
- `.opencode/skills/` 아래에 Nexus 스킬 복사
- 현재 실행 중인 CLI 버전으로 plugin pin

예를 들어 `0.13.5`에서는 다음과 같이 기록됩니다.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-nexus@0.13.5"],
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
