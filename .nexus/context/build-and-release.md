<!-- tags: codebase, development, build, test, release -->
# opencode-nexus 개발 워크플로

## 1. 빌드 및 실행

### 빌드

패키지 매니저는 Bun 1.3.9를 사용합니다.

```bash
bun install
bun run sync        # nexus-core sync CLI 실행 (managed paths 생성)
bun run check       # tsc --noEmit (타입 검사만, 출력 없음)
```

TypeScript 소스는 `src/`에 있으며 **dist 없이 TS를 직접 로드**한다. 컴파일 대상은 ES2022이고 모듈 형식은 ESNext입니다.

### Self-hosting 절차

이 저장소 자체를 개발 환경으로 사용할 때, npm 패키지 대신 로컬 소스를 직접 로드합니다.

```text
1. bun install
2. bun run sync     # managed paths (src/agents/*.ts) 생성
3. bun run check    # 타입 검사
4. 이 저장소 루트에서 OpenCode 실행
5. 세션에서 nx_context 또는 nx_init 같은 Nexus 도구가 보이는지 확인
```

소스를 수정할 때마다 `bun run sync`로 managed paths를 재생성해야 한다.

## 2. 테스트 전략

### E2E 테스트

모든 테스트는 `scripts/` 디렉토리의 `e2e-nexus-integration.mjs` 단일 파일로 구성된다.

| 블록 | 검증 대상 |
|------|-----------|
| Block 1 | plan → task → close 전체 흐름 |
| Block 2 | edit 가드레일 차단 |
| Block 3 | hook 알림 및 상태 스냅샷 |
| Block 4 | task cycle 완료 및 nx_sync |

### 전체 테스트 실행

```bash
bun run test:e2e    # scripts/e2e-nexus-integration.mjs 실행
```

**이전 테스트 파일들 제거됨**: v0.10.0에서 29개 개별 E2E 스크립트가 단일 통합 테스트로 대첵되었다.

## 3. 릴리스 프로세스

### v0.12.0 타겟: nexus-core v0.16.2 채택

plan #59 결정에 따라 릴리스 타겟 v0.12.0은 `@moreih29/nexus-core ^0.16.2`를 채택한다. 주요 변경: OpenCode fragment 제거, plugin 자동 등록 canonical화, manifest resolves + prompt-router self-contained 검증 추가. Tier A/B 감사 및 e2e 회귀 테스트 PASS.

### 배포 스킬

`deploy` skill은 opencode-nexus 고유로 유지된다. 자율 릴리스 오케스트레이터가 다음을 수행한다:
- 다음 안전 버전 결정
- 릴리스 준비 상태 검증
- 릴리스 커밋 및 태그 생성
- GitHub 푸시 및 publish workflow 모니터링
- npm 게시 확인

### 패키지 게시 준비

`prepack` 스크립트가 `npm publish` 이전에 자동으로 실행됩니다.

```bash
bun run prepack     # sync:strict → deploy skill 실행
npm publish
```

`package.json`의 `files` 필드:
- `src/` — TypeScript 소스 (TS 직접 로드)
- `scripts/` — postinstall.mjs 등
- `.opencode/skills/` — nx-* skill 파일들

### CI/CD (GitHub Actions)

`.github/workflows/publish-npm.yml`이 `v*` 태그 푸시 또는 수동 트리거에서 실행됩니다.

CI 순서: `bun install --frozen-lockfile` → `bun run check` → `bun run test:e2e` → `npm pack --dry-run` → `npm publish --provenance --access public`

## 4. Consumer 설치 흐름

### 설치

```bash
bun add opencode-nexus
bun pm trust opencode-nexus    # postinstall 스크립트 허용
```

### opencode.json 수동 구성

```json
{
  "plugin": ["opencode-nexus"],
  "mcp": {
    "nx": {
      "type": "local",
      "command": ["nexus-mcp"]
    }
  },
  "agents": {
    "lead": {
      "model": "openai/gpt-5.3-codex"
    }
  }
}
```

자세한 설치 가이드는 README.md를 참조한다.

## 5. 버전 정책

### 0.x Breaking Change 허용

opencode-nexus는 0.x 버전에서 minor bump로 breaking change를 허용한다.

| 변경 유형 | 버전 정책 | CHANGELOG 요구사항 |
|-----------|-----------|-------------------|
| Non-breaking | Patch bump | 변경 내용 기술 |
| Breaking | Minor bump | **Consumer Action Required** 섹션 필수 |

### 스키마 버전 관리

isolated config는 명시적 스키마 버전(`version` 필드)을 사용합니다.

- **v1** (현재): 기본 에이전트/스킬 설정 지원
- **v2+** (향후): 선택적 필드 추가 가능

---

### v0.11.0 release (CLI MVP)

추가 build/test gates:
- `bun run test:cli` — scripts/e2e-cli.mjs (15 blocks, ~8s)
- CLI tarball smoke — fresh extract + HOME redirect + install 시뮬레이션

Breaking-in-practice (pre-1.0 minor): postinstall 축소, CLI canonical mutator. MIGRATION.md 필수 제공.
