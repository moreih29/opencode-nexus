---
name: deploy
description: Pre-publish release preflight for opencode-nexus. Validates build, tests, packaging, and docs before tagging.
---

# Deploy

opencode-nexus 배포 프리플라이트. 코드 변경과 무관하게 일관된 흐름을 탄다.

publish/tag/push는 사용자가 명시적으로 요청하기 전에는 절대 실행하지 않는다.

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

### 2. Build + Test

```bash
bun run build
bun run test:e2e
```

- 전체 통과 필수. conformance 포함.
- 실패 시 배포 중단으로 보고하고 실패 원인 제시.

### 3. Package Integrity

```bash
npm pack --dry-run 2>&1
```

- `package.json`의 `name`, `version`, `exports`, `files`, `publishConfig` 확인.
- tarball에 불필요한 파일(`.nexus/`, `scripts/`, `src/`, `.opencode/`)이 들어가지 않는지 확인.
- `dist/`와 `templates/`만 포함되어야 함.

### 4. Template Sync

```bash
bun run generate:template
git diff --stat templates/
```

- drift가 있으면 반영 후 이유 설명.
- `.opencode/skills/`와 `templates/skills/`가 동기화 상태인지 확인.

### 5. User-Facing Docs

README가 현재 구현과 맞는지 확인:

- `README.md`, `README.en.md` 읽기
- `opencode.example.json` 읽기
- 설치 방법, 사용 태그, 에이전트/스킬 목록, `.nexus/` 구조 설명이 현재 코드와 일치하는지 대조
- 불일치가 있으면 수정하고 변경 이유를 명시

구체적으로 무엇을 대조할지는 코드를 직접 읽어서 판단한다. 특정 기능명을 여기에 하드코딩하지 않는다.

### 6. Release Gate

`.nexus/rules/release.md`의 모든 항목을 확인한다.
이 파일이 배포 가능 여부의 canonical 기준이다.

### 7. Summary

```
Release Readiness
-----------------
Version:          {package.json version}
Build:            PASS / FAIL
Tests:            PASS / FAIL (N e2e + N conformance)
Package:          PASS / FAIL
Template sync:    PASS / FAIL
Docs drift:       PASS / FAIL
Release gate:     PASS / FAIL

Ready to publish: YES / NO

Changed files (preflight fixes):
  - {list}

Recommended next:
  - git tag vX.Y.Z && git push origin vX.Y.Z
  - 또는 GitHub Actions publish workflow 실행
```

## Rules

- 수정은 문서/템플릿/메타데이터 정리에 한정. 기능 코드 변경은 preflight에서 하지 않는다.
- 사용자 요청 시에만 커밋. 자의적 커밋 금지.
- publish, tag, push는 사용자가 요청하기 전에 실행하지 않는다.
