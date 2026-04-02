---
name: deploy
description: Pre-publish release preflight for this opencode-nexus repository. Use before publishing to npm or creating a release tag.
---

# Deploy

`opencode-nexus` 저장소 전용 배포 프리플라이트 스킬이다.

목표는 배포 전에 문서, 템플릿, 테스트, 패키징, 워킹 트리를 빠르게 정리해서 "지금 태그를 찍어도 되는가"를 판단하는 것이다.

이 스킬은 배포 자체를 강제하지 않는다. 우선 preflight를 끝내고, 결과를 요약한 뒤에만 publish 또는 tag를 진행한다.

## When to use

- npm 배포 전
- Git tag 생성 전
- release PR 또는 release commit 직전

## Core rules

- 먼저 현재 워킹 트리 상태를 확인한다.
- 수정이 생기면 이유를 분리해서 설명한다.
- 배포와 무관한 변경이 섞여 있으면 함부로 정리하지 말고 사용자에게 알린다.
- 비밀값, `.npmrc`, 토큰, credential 파일은 절대 커밋하지 않는다.
- publish나 tag push는 사용자가 명시적으로 요청하기 전에는 하지 않는다.

## Preflight checklist

순서대로 진행한다.

### 1. Worktree and release scope

- `git status --short`로 dirty 상태 확인
- `git diff`와 최근 커밋을 보고 이번 배포 범위를 짧게 요약
- 배포와 무관한 변경이 있으면 separate concern으로 보고

### 2. Readme and user-facing docs drift

아래가 현재 구현과 맞는지 확인한다.

- `README.md`
- `README.en.md`
- 필요 시 `opencode.example.json`

특히 다음을 본다.

- 설치 방법
- `[meet]`, `[run]`, `[d]`, `[rule]` 태그 설명
- 내장 agent / skill 설명
- `.nexus/` 구조 설명
- `AGENTS.md`가 primary instruction 파일이라는 설명

불일치가 있으면 수정한다.

### 3. Generated template drift

- `bun run generate:template` 실행
- `templates/nexus-section.md`가 최신인지 확인
- drift가 있으면 반영하고 이유를 설명

### 4. Package metadata and packability

`package.json`이 현재 배포 상태와 맞는지 확인한다.

- `name`, `version`, `exports`, `files`, `publishConfig`
- README와 package metadata 간 설명 불일치 여부
- 라이선스 표기 상태

그다음 아래를 확인한다.

- `npm pack --dry-run`
- tarball에 불필요한 파일이 들어가지 않는지 확인

### 5. Safety checks

아래를 실행한다.

- `bun run check`
- `bun run test:e2e`

실패 시 배포 중단 상태로 보고한다.

### 6. Release readiness summary

마지막에 아래 형식으로 요약한다.

- release ready: yes/no
- changed files for preflight
- failing checks, if any
- manual follow-up, if any
- recommended next command

## If fixes were needed

- 수정이 문서/템플릿/메타데이터 정리라면 그 사실을 명확히 적는다.
- 사용자가 요청하면 관련 변경만 따로 커밋한다.
- 사용자가 요청하지 않으면 publish, tag, push는 하지 않는다.

## Suggested next step

preflight가 통과하면 다음 중 하나를 제안한다.

1. `git tag vX.Y.Z && git push origin vX.Y.Z`
2. GitHub Actions의 publish workflow 실행
3. 마지막으로 changelog 또는 release notes 점검
