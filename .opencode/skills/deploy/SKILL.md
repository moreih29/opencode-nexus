---
name: deploy
description: Release preflight aligned with the current GitHub publish workflow. Validates local gates, package contents, docs, and OIDC/tag readiness before release.
---

# Deploy

opencode-nexus 배포 프리플라이트. 기준은 로컬 관습이 아니라 현재 GitHub Actions publish workflow(`.github/workflows/publish-npm.yml`)다.

publish/tag/push/workflow dispatch는 사용자가 명시적으로 요청하기 전에는 절대 실행하지 않는다.
로컬 `npm publish`는 기본 경로가 아니다. 실제 게시 경로는 GitHub Actions의 OIDC Trusted Publishing이다.

## Workflow Contract

현재 배포 workflow 기준:

- workflow file: `.github/workflows/publish-npm.yml`
- trigger:
  - semver tag push: `vX.Y.Z`
  - `workflow_dispatch` with `dry_run` input
- runtime:
  - Bun `1.3`
  - Node `24` (bundled npm 11+)
- auth:
  - OIDC Trusted Publishing only
  - `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `registry-url` 전제 금지
- CI 순서:
  1. `bun install --frozen-lockfile`
  2. `bun run check`
  3. version match check (`git tag` vs `package.json.version`, tag build일 때만)
  4. `bun run test:e2e`
  5. `npm pack --dry-run`
  6. `npm publish --provenance --access public` (`dry_run`이 아닐 때만)

## Preflight Flow

순서대로 진행. 각 단계의 게이트를 통과해야 다음으로 넘어간다.

### 1. Working Tree

```bash
git status --short
git log --oneline -5
```

- dirty 상태가 있으면 보고. 배포와 무관한 변경이 섞여 있으면 사용자에게 알리고 판단을 맡긴다.
- 최근 커밋을 보고 이번 배포 범위를 1-2줄로 요약.
- 비밀값, `.npmrc`, credential 파일이 tracked에 있으면 즉시 중단.
- `package.json.version`을 읽고 이번 릴리즈의 기준 태그를 `v{version}`으로 명시.

### 2. Workflow Gate (local mirror)

```bash
bun install --frozen-lockfile
bun run check
bun run test:e2e
```

- 순서는 workflow와 맞춘다.
- `test:e2e` 안에서 build/conformance가 포함되므로 이것이 canonical gate다.
- 실패 시 배포 중단으로 보고하고 실패 원인 제시.

### 3. Package Integrity

```bash
npm pack --dry-run 2>&1
git diff --stat -- templates/
```

- `package.json`의 `name`, `version`, `exports`, `files`, `publishConfig` 확인.
- tarball에 불필요한 파일(`.nexus/`, `scripts/`, `src/`, `.opencode/`)이 들어가지 않는지 확인.
- `files` 기준으로 `dist/`와 `templates/`만 포함되어야 함.
- `prepack`이 자동으로 실행되므로, `templates/` drift가 생기면 태그 전에 반영 여부를 사용자와 확인.

### 4. Workflow / Docs Alignment

README가 현재 구현과 맞는지 확인:

- `README.md`, `README.en.md` 읽기
- `opencode.example.json` 읽기
- 설치 방법, 사용 태그, 에이전트/스킬 목록, `.nexus/` 구조 설명이 현재 코드와 일치하는지 대조
- release 관련 문구가 현재 workflow와 일치하는지 확인:
  - tag trigger: `vX.Y.Z`
  - optional `workflow_dispatch` dry-run
  - OIDC Trusted Publishing only
  - `npm publish --provenance --access public`
- 불일치가 있으면 수정하고 변경 이유를 명시

구체적으로 무엇을 대조할지는 코드를 직접 읽어서 판단한다. 특정 기능명을 여기에 하드코딩하지 않는다.

### 5. Release Gate

위 1-4단계 자체가 배포 가능 여부의 canonical 기준이다.
별도 `.nexus/rules/` 릴리즈 규칙 파일은 유지하지 않는다.

사용자가 GitHub Actions 레벨의 검증까지 원하면 다음도 수행 가능:

```bash
gh workflow run publish-npm.yml -f dry_run=true
gh run watch
```

- 이는 선택적 end-to-end 검증이다.
- 실제 릴리즈는 보통 `v{package.json.version}` 태그 푸시로 진행한다.

### 6. Summary

```
Release Readiness
-----------------
Version:          {package.json version}
Target tag:       v{package.json version}
Workflow:         publish-npm.yml
Check:            PASS / FAIL
Tests:            PASS / FAIL (e2e + conformance 포함)
Package:          PASS / FAIL
Template drift:   PASS / FAIL
Docs drift:       PASS / FAIL
Workflow dry-run: NOT RUN / PASS / FAIL
Release gate:     PASS / FAIL

Ready to publish: YES / NO

Changed files (preflight fixes):
  - {list}

Recommended next:
  - gh workflow run publish-npm.yml -f dry_run=true
  - git tag vX.Y.Z && git push origin vX.Y.Z
```

## Rules

- 수정은 문서/템플릿/메타데이터 정리에 한정. 기능 코드 변경은 preflight에서 하지 않는다.
- 사용자 요청 시에만 커밋. 자의적 커밋 금지.
- publish, tag, push, workflow dispatch는 사용자가 요청하기 전에 실행하지 않는다.
- 실제 publish 경로는 GitHub Actions OIDC workflow를 기준으로 판단하고, 로컬 `npm publish`는 기본 루트로 사용하지 않는다.
