<!-- tags: codebase, development, build, test, release -->
# opencode-nexus 개발 워크플로

## 1. 빌드 및 실행

### 빌드

패키지 매니저는 Bun 1.3.9를 사용합니다.

```bash
bun install
bun run build       # tsc -p tsconfig.json → dist/
bun run check       # 타입 검사만, 출력 없음
```

TypeScript 소스는 `src/`에 있으며 `dist/`로 컴파일됩니다. 컴파일 대상은 ES2022이고 모듈 형식은 ESNext입니다.

### Self-hosting 절차

이 저장소 자체를 개발 환경으로 사용할 때, npm 패키지 대신 `.opencode/plugins/opencode-nexus.js`를 통해 로컬 빌드 결과물을 로드합니다. 로컬 플러그인 shim은 `../../dist/index.js`를 참조합니다.

```text
1. bun install
2. bun run build
3. 이 저장소 루트에서 OpenCode 실행
4. 세션에서 nx_context 또는 nx_setup 같은 Nexus 도구가 보이는지 확인
```

소스를 수정할 때마다 OpenCode에서 새 동작을 확인하려면 `bun run build`를 다시 실행해야 합니다.

## 2. 테스트 전략

### E2E 테스트 구조

모든 테스트는 `scripts/` 디렉토리의 `.mjs` 파일로 구성되며, Node.js 내장 `assert/strict` 모듈을 사용합니다. 각 테스트는 `os.tmpdir()`에 임시 디렉토리와 `.git/HEAD`를 생성해 독립적인 프로젝트 환경을 시뮬레이션합니다. 이후 `dist/`에서 직접 모듈을 임포트해 도구 함수를 호출하고 결과를 단언합니다.

### 전체 테스트 실행

```bash
bun run test:e2e
```

이 명령은 먼저 `bun run build`를 실행한 뒤 21개 스크립트를 순서대로 실행합니다.

| 스크립트 | 검증 대상 |
|---|---|
| `e2e-smoke.mjs` | meet → task → close 전체 흐름 |
| `e2e-guardrails.mjs` | edit 가드레일 차단 |
| `e2e-system-transform.mjs` | 시스템 프롬프트 변환 |
| `e2e-hook-notices.mjs` | hook 알림 |
| `e2e-context.mjs` | nx_context 도구 |
| `e2e-init-sync.mjs` | init/sync 흐름 |
| `e2e-setup-template.mjs` | setup 템플릿 |
| `e2e-lifecycle.mjs` | 전체 라이프사이클 |
| `e2e-qa-trigger.mjs` | QA 트리거 |
| `e2e-pipeline-evaluator.mjs` | 파이프라인 평가 |
| `e2e-stop-guard.mjs` | stop 가드 |
| `e2e-team-policy.mjs` | 팀 정책 |
| `e2e-delegation.mjs` | 위임 흐름 |
| `e2e-orchestration-core.mjs` | 오케스트레이션 핵심 |
| `e2e-orchestration-core-persistence.mjs` | 오케스트레이션 지속성 |
| `e2e-orchestration-filename-migration.mjs` | 파일명 마이그레이션 |
| `e2e-run-continuity-core.mjs` | run 연속성 핵심 |
| `e2e-run-continuity-persistence.mjs` | run 연속성 지속성 |
| `e2e-meet-continuity-core.mjs` | meet 연속성 핵심 |
| `e2e-code-intel.mjs` | code intelligence |
| `e2e-prompt-parity.mjs` | 프롬프트 parity |

## 3. 릴리스 프로세스

### 템플릿 생성

`generate:template` 스크립트는 `dist/`에서 에이전트 카탈로그, 스킬 카탈로그, 태그 목록을 임포트해 `templates/nexus-section.md`를 생성합니다.

```bash
bun run generate:template   # bun run build → bun scripts/generate-template.mjs
```

### 패키지 게시 준비

`prepack` 스크립트가 `npm publish` 이전에 자동으로 실행됩니다.

```bash
bun run prepack   # generate:template 실행 → dist/ + templates/ 패키지에 포함
npm publish
```

`package.json`의 `files` 필드는 `dist`와 `templates`만 포함합니다.

### CI/CD (GitHub Actions)

`.github/workflows/publish-npm.yml`이 `v*` 태그 푸시 또는 수동 트리거에서 실행됩니다.

CI 순서: `bun install --frozen-lockfile` → `bun run check` → `bun run test:e2e` → `npm pack --dry-run` → `npm publish --provenance --access public`

## 4. 개발 시 주의사항

- **이 저장소**: `.opencode/plugins/opencode-nexus.js` (로컬 shim) 사용. `opencode.json`에 `"plugin": ["opencode-nexus"]`를 넣지 않는다.
- **다른 프로젝트**: `opencode.json`에 `"plugin": ["opencode-nexus"]` 추가.
- `nx_setup(profile="auto")`는 self-hosting 저장소를 감지해 package plugin 추가를 건너뛴다.
- 소스 수정 후 반드시 `bun run build` 실행. 핫 리로드 없음.
- 게시 전 `bun run check`로 타입 오류 확인.
