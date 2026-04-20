# opencode-nexus

[![npm version](https://img.shields.io/npm/v/opencode-nexus)](https://www.npmjs.com/package/opencode-nexus)

> OpenCode 하네스용 @moreih29/nexus-core 배포 플러그인

`opencode-nexus`는 OpenCode IDE에서 Nexus 오케스트레이션 워크플로를 활성화하는 플러그인입니다. 복잡한 작업을 즉흥 프롬프트로 굴리는 대신, 구조화된 플래닝(`[plan]`), 태스크 기반 실행(`[run]`), 지속되는 프로젝트 지식 흐름(`.nexus/`)을 사용할 수 있게 합니다.

이 패키지는 nexus-core의 OpenCode-specific 배포본입니다. 상세 기능 문서는 nexus-core 저장소를 참조하세요.

## Quick Install

```bash
# 1. 패키지 설치
bun add -d opencode-nexus
# 또는
npm install -d opencode-nexus

# 2. Bun post-install 신뢰 설정 (Bun 1.3+ 필수)
bun pm trust opencode-nexus
```

> **중요**: Bun 1.3.9+에서는 postinstall 스크립트가 기본적으로 차단됩니다. `bun pm trust opencode-nexus`를 실행해야 consumer `.opencode/skills/`가 생성됩니다.

## Requirements

- **Node.js**: >= 22 (`import ... with { type: "json" }` 구문 필요)
- **Bun**: >= 1.3.9 (권장 패키지 매니저)
- **OpenCode**: 최신 버전

## Consumer opencode.json 설정

프로젝트 루트의 `.opencode/opencode.json` (또는 `opencode.json`)에 다음 전체를 추가:

```json
{
  "plugin": ["opencode-nexus"],
  "mcp": {
    "nx": { "type": "local", "command": ["nexus-mcp"] }
  },
  "agents": [
    { "id": "lead", "module": "./node_modules/opencode-nexus/src/agents/lead.ts" },
    { "id": "architect", "module": "./node_modules/opencode-nexus/src/agents/architect.ts" },
    { "id": "designer", "module": "./node_modules/opencode-nexus/src/agents/designer.ts" },
    { "id": "engineer", "module": "./node_modules/opencode-nexus/src/agents/engineer.ts" },
    { "id": "postdoc", "module": "./node_modules/opencode-nexus/src/agents/postdoc.ts" },
    { "id": "strategist", "module": "./node_modules/opencode-nexus/src/agents/strategist.ts" },
    { "id": "researcher", "module": "./node_modules/opencode-nexus/src/agents/researcher.ts" },
    { "id": "reviewer", "module": "./node_modules/opencode-nexus/src/agents/reviewer.ts" },
    { "id": "tester", "module": "./node_modules/opencode-nexus/src/agents/tester.ts" },
    { "id": "writer", "module": "./node_modules/opencode-nexus/src/agents/writer.ts" }
  ]
}
```

### 설정 포인트

- **`mcp` 키** (not `mcp_servers`) — opencode config schema 요구사항. `type: "local"` + `command` 배열 형태.
- **`agents` 배열은 필수** — `plugin: ["opencode-nexus"]` 등록만으로는 Nexus 에이전트가 opencode에 자동 등록되지 않습니다. 10개 에이전트를 명시적으로 지정해야 `opencode agent list`에 표시됩니다.
- **Module 경로**: `node_modules/opencode-nexus/src/agents/<name>.ts` — opencode가 TypeScript를 직접 로드합니다.
- **참고용 fragment**: `node_modules/opencode-nexus/opencode.json.fragment`에 agent 배열 ref 버전이 있습니다. 위 구성은 consumer 기준 경로로 교정됐으므로 그대로 복붙 가능합니다.

## Entrypoints

| Entrypoint | Purpose |
|------------|---------|
| `[plan]` | 구조화된 논의와 결정 워크플로 |
| `[run]` | 태스크 기반 실행 워크플로 |
| `nx-init` | 프로젝트 온볼딩 (`skill({ name: "nx-init" })`) |
| `nx-sync` | 컨텍스트 동기화 (`[sync]` 또는 `skill({ name: "nx-sync" })`) |

## Development

이 저장소에서 개발할 때:

```bash
# 1. 의존성 설치
bun install

# 2. nexus-core에서 managed paths 동기화
bunx @moreih29/nexus-core sync --harness=opencode

# 3. OpenCode 실행
opencode
```

> **참고**: 이 저장소의 `opencode.json`은 `instructions`만 유지합니다. 플러그인 로딩은 consumer 환경에서 `plugin: ["opencode-nexus"]`로 이루어집니다.

## Contract

- `opencode-nexus`는 nexus-core 0.15.1+의 runtime substrate를 수용합니다
- Canonical assets(agent 정의, skill 템플릿, vocabulary)는 `@moreih29/nexus-core`가 관리
- opencode-nexus 고유 기능: `deploy` skill (릴리즈 오케스트레이션)

## Credits

- Canonical orchestration spec: [@moreih29/nexus-core](https://www.npmjs.com/package/@moreih29/nexus-core)
- Sibling project: claude-nexus (Claude Code harness)

## License

MIT
