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

이 명령은 먼저 `bun run build`, `bun run validate:conformance`를 실행한 뒤 29개 E2E 스크립트를 순서대로 실행합니다.

| 스크립트 | 검증 대상 |
|---|---|
| `e2e-smoke.mjs` | plan → task → close 전체 흐름 |
| `e2e-guardrails.mjs` | edit 가드레일 차단 |
| `e2e-system-transform.mjs` | 시스템 프롬프트 변환 |
| `e2e-hook-notices.mjs` | hook 알림 |
| `e2e-context.mjs` | nx_context 도구 |
| `e2e-init-sync.mjs` | init/sync 흐름 |
| `e2e-setup-template.mjs` | setup 템플릿 |
| `e2e-lifecycle.mjs` | 전체 라이프사이클 |
| `e2e-qa-trigger.mjs` | Tester 자동 트리거 |
| `e2e-pipeline-evaluator.mjs` | 파이프라인 평가 |
| `e2e-stop-guard.mjs` | stop 가드 |
| `e2e-team-policy.mjs` | 팀 정책 |
| `e2e-delegation.mjs` | 위임 흐름 |
| `e2e-agent-tracker-core.mjs` | 에이전트 트래커 코어 |
| `e2e-orchestration-core-persistence.mjs` | 오케스트레이션 지속성 |
| `e2e-run-continuity-core.mjs` | run 연속성 핵심 |
| `e2e-run-continuity-persistence.mjs` | run 연속성 지속성 |
| `e2e-plan-continuity-core.mjs` | plan 연속성 핵심 |
| `e2e-plan-start-defaults.mjs` | plan start 기본값 |
| `e2e-code-intel.mjs` | code intelligence |
| `e2e-prompts-generated.mjs` | 프롬프트 parity |
| `e2e-capability-coverage.mjs` | capability-map 커버리지 |
| `e2e-conformance.mjs` | 명세 적합성 |
| `e2e-loader-smoke.mjs` | 로더 스모크 |
| `e2e-system-transform-plan-skill.mjs` | plan skill 시스템 변환 |
| `e2e-entrypoint-skills.mjs` | 스킬 엔트리포인트 |
| `e2e-subagent-prompts.mjs` | 서브에이전트 프롬프트 |
| `e2e-tag-handlers.mjs` | 태그 핸들러 |
| `e2e-plan-resume-inject.mjs` | plan resume 주입 |

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

## 5. 설정 스키마 정책

### 버전 관리

isolated config는 명시적 스키마 버전(`version` 필드)을 사용합니다.

- **v1** (현재): `agents.<id>.{model, tools}` 지원
- **v2+** (향후): 선택적 필드 추가 가능

### Breaking vs Non-Breaking

| 변경 유형 | 버전 정책 | 예시 |
|-----------|-----------|------|
| **Non-breaking** | Minor/Patch bump | v1에 없던 새 필드 추가 (예: `disabled_hooks`, `categories`를 optional top-level로 추가) |
| **Breaking** | Major bump | 기존 필드 의미 변경, 필수 필드 추가, 기본값 변경 |

### 스키마 확장 규칙

1. **새 필드는 optional**: v1 구현체와의 호환성 유지
2. **기존 필드는 immutable**: 의미 변경 시 새 필드명 사용
3. **Unknown 필드 무시**: 파서는 인식하지 못는 필드를 무시하고 로그만 남김
4. **Migration 가이드 제공**: Major 버전 전환 시 CLI `migrate` 명령 업데이트
