# opencode-nexus

[![npm version](https://img.shields.io/npm/v/opencode-nexus)](https://www.npmjs.com/package/opencode-nexus)

> OpenCode 하네스용 @moreih29/nexus-core 배포 플러그인 (CLI installer 포함)

`opencode-nexus`는 OpenCode IDE에서 Nexus 오케스트레이션 워크플로를 활성화하는 플러그인입니다. 복잡한 작업을 즉흥 프롬프트로 굴리는 대신, 구조화된 플래닝(`[plan]`), 태스크 기반 실행(`[run]`), 지속되는 프로젝트 지식 흐름(`.nexus/`)을 사용할 수 있게 합니다.

이 패키지는 nexus-core의 OpenCode-specific 배포본입니다. 상세 기능 문서는 nexus-core 저장소를 참조하세요.

## Quick Install

### Project scope (권장)

```bash
bun add -d opencode-nexus
bunx opencode-nexus install --scope=project
```

이 두 줄로 `./opencode.json`에 canonical minimal config가 추가되고 `./.opencode/skills/`에 nx-* 4 skill이 복사됩니다.

### User scope (머신 전체)

```bash
bun add -d opencode-nexus
bunx opencode-nexus install --scope=user
```

`~/.config/opencode/opencode.json` + `~/.config/opencode/skills/`에 설치됩니다.

### Both scope (ownership split)

```bash
bunx opencode-nexus install --scope=both
```

| Scope | 관리 필드 | Skills 기본 위치 |
|---|---|---|
| user | `plugin`, `mcp.nx` | — |
| project | `default_agent` | `./.opencode/skills/` |

중복 쓰기 없이 OpenCode의 native config merge로 결합됩니다.

### Package manager 옵션

| Manager | Install | Run CLI |
|---|---|---|
| bun | `bun add -d opencode-nexus` | `bunx opencode-nexus install` |
| npm | `npm install -D opencode-nexus` | `npx opencode-nexus install` |
| pnpm | `pnpm add -D opencode-nexus` | `pnpm dlx opencode-nexus install` |
| yarn | `yarn add -D opencode-nexus` | `yarn dlx opencode-nexus install` |

## Commands

### install

```bash
opencode-nexus install [--scope=user|project|both] [--yes] [--dry-run] [--force] [--skills=user|project|both] [--normalize]
```

- `--scope`: 설치 대상. TTY면 interactive 질문, non-TTY면 `project` 기본.
- `--yes`: 확인 프롬프트 생략.
- `--dry-run`: 변경 사항 미리보기 (파일 변경 없음).
- `--force`: 기존 `default_agent` 덮어쓰기.
- `--skills`: skills 복사 위치 (both 모드에서 기본 project).
- `--normalize`: plugin 배열 중복 자동 정리 (기본 preserve).

### uninstall

```bash
opencode-nexus uninstall [--scope=user|project|both] [--yes] [--purge]
```

Nexus-managed 키(`plugin`의 opencode-nexus 엔트리, `mcp.nx`, `default_agent=lead`)만 제거. 다른 plugin/mcp/agent/permission은 보존. `--purge` 없으면 skills 디렉토리도 preserve.

### doctor

```bash
opencode-nexus doctor [--scope=user|project|both] [--json] [--fix]
```

설치 상태 진단. partial/orphan 상태 감지. `--fix`는 non-destructive normalize (plugin 중복 병합, 빈 container 정리).

## Bootstrap Journey

opencode-nexus는 두 단계 워크플로로 설계됐습니다:

1. **CLI 설치 (opencode 실행 없이)** — `bunx opencode-nexus install` 로 config + skills 세팅
2. **OpenCode 낮부 refinement (선택)** — opencode 실행 후 `nx-setup` skill로 모델/provider 세부 조정

CLI가 canonical mutator이고, nx-setup skill은 post-install wizard입니다.

## Requirements

- **Node.js**: >= 22
- **OpenCode**: 최신 버전
- **Bun 1.3+ 권장** (다른 패키지 매니저도 동일하게 지원)

> Bun 1.3+에서 postinstall 스크립트는 trust 없이 실행되지 않지만, **CLI는 trust 무관하게 실행 가능**합니다. postinstall은 안내 메시지만 출력하며 filesystem을 변경하지 않습니다.

## Migration from v0.10.x

v0.10.x에서 수동으로 opencode.json을 편집했거나 postinstall로 skills를 복사했다면 [MIGRATION.md](./MIGRATION.md)를 참조하세요.

## Entrypoints

| Entrypoint | Purpose |
|---|---|
| `[plan]` | 구조화된 논의와 결정 |
| `[run]` | 태스크 기반 실행 |
| `nx-init` | 프로젝트 온볼딩 |
| `nx-sync` | 컨텍스트 동기화 |
| `nx-setup` | opencode 낮부 setup wizard (post-install refinement) |

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
- v0.11.0 고유: CLI installer + deploy skill

## Credits

- Canonical orchestration spec: [@moreih29/nexus-core](https://www.npmjs.com/package/@moreih29/nexus-core)
- Sibling project: claude-nexus

## License

MIT
