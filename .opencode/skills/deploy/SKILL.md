---
name: deploy
description: Autonomous release orchestrator for opencode-nexus. Determines the next safe version, validates release readiness, creates the release commit and tag, pushes to GitHub, watches the publish workflow, and verifies npm publication. Only asks the user when a major or breaking release is likely.
---

# Deploy

`deploy`는 opencode-nexus의 **릴리즈 오케스트레이터**다.
목표는 preflight만 하고 끝나는 것이 아니라, **major/breaking release 가능성이 높지 않은 한 최종 배포 완료까지 자동으로 진행**하는 것이다.

이 저장소의 canonical publish path는 로컬 `npm publish`가 아니다.
실제 배포 경로는 다음이다:

1. `main`에서 release candidate 확정
2. release commit 생성
3. `vX.Y.Z` git tag 생성 및 push
4. `.github/workflows/publish-npm.yml` 실행
5. GitHub Actions에서 OIDC Trusted Publishing으로 npm 게시
6. npm registry 반영 확인

## Core Policy

- 기본 동작은 **중단 없는 자동 release 진행**이다.
- 아래 경우에만 사용자에게 묻는다:
  1. **major version bump가 적절해 보일 때**
  2. **breaking change 가능성이 높을 때**
- 그 외에는 질문 없이 끝까지 진행한다.
- 단, 아래는 질문이 아니라 **hard blocker**다. 즉시 중단하고 이유를 보고한다:
  - 시작 시 working tree가 dirty
  - 현재 브랜치가 `main`이 아님
  - `origin/main`과 뒤처짐/분기(diverged) 상태
  - 마지막 release 이후 새 커밋이 없음
  - check / test / package gate 실패
  - publish workflow가 없거나 release path가 깨져 있음
  - tag push 실패
  - GitHub Actions publish workflow 실패
  - npm registry 확인 결과 target version과 불일치

## Source of Truth

매 실행마다 다음을 직접 읽는다:

- `package.json`
- `.github/workflows/publish-npm.yml`
- git tags / git history
- npm registry의 현재 published version

로컬 기억이나 오래된 규칙보다 **현재 workflow 파일이 우선**이다.
workflow와 로컬 가정이 다르면 workflow를 기준으로 판단하고, drift를 보고한다.

## Semver Policy

### Release baseline

다음을 함께 본다:

- latest reachable semver git tag (`vX.Y.Z`)
- npm registry의 현재 published version
- 현재 `package.json.version`

released baseline은 보통 git tag와 npm version 중 최신 배포 상태다.

### Bump decision

마지막 release 이후의 커밋 로그, changed files, user-facing surface 변화를 보고 semver를 자동 결정한다.

- **major**
  - breaking change 신호가 있을 때만
  - 예:
    - 기존 command / flag / tag / tool 제거 또는 rename
    - config shape breaking change
    - package exports / bin breaking change
    - 기존 user-facing contract 파손
    - commit/body에 `BREAKING`, `breaking change`, `!` 신호
  - **이 경우에만 사용자 확인 필요**

- **minor**
  - 새로운 user-facing 기능, command, flag, tag, tool, skill 추가
  - setup / install / update UX 확장
  - 문서에 반영해야 할 새 기능 추가
  - patch와 minor가 애매하면 **minor로 올림**

- **patch**
  - bug fix
  - internal improvement
  - release metadata/docs/template sync
  - 기존 public surface를 넓히지 않는 개선

### Collision handling

선택된 target version이 이미 git tag 또는 npm registry에 존재하면,
major가 아닌 한 같은 bump family 안에서 다음 free version으로 자동 전진한다.

예:

- intended patch `0.6.1` exists -> `0.6.2`
- intended minor `0.7.0` exists -> `0.8.0`

### User questions rule

- patch/minor는 묻지 않는다.
- **major만 묻는다.**

## Allowed Release Edits

release 과정에서 자동 수정 가능한 범위:

- `package.json.version`
- release 관련 README / README.en / example config drift
- workflow-aligned docs drift
- templates / generated publish artifacts drift

release 과정에서 자동 수정하면 안 되는 범위:

- feature code 변경으로 test failure를 억지로 해결하는 것
- 설계 변경, behavior 변경, 새로운 기능 추가

즉, deploy skill은 **release candidate를 정리**할 수는 있지만,
**제품 기능을 고쳐서 테스트를 통과시키는 역할은 하지 않는다.**

## Release Flow

순서대로 진행한다.

### 1. Release Context Scan

다음 정보를 확인한다:

```bash
git branch --show-current
git status --short
git status -sb
git fetch origin --tags
git log --oneline -20
npm view opencode-nexus version
```

필요하면 추가로:

```bash
git describe --tags --abbrev=0
git log <last-release-tag>..HEAD --oneline
git diff --name-only <last-release-tag>..HEAD
```

판단:

- 현재 브랜치가 `main`인지
- working tree가 clean인지
- `origin/main`과 sync 상태인지
- 마지막 release 이후 어떤 커밋이 들어왔는지
- npm에 현재 어떤 버전이 게시되어 있는지

start 시 dirty tree면 즉시 중단한다.
deploy skill은 기존 미커밋 변경을 임의로 포함해 배포하지 않는다.

### 2. Release Scope Summary

마지막 release 이후 변경을 3~7줄로 요약한다.

포함:

- changed files summary
- user-facing changes
- internal-only changes
- recommended bump type
- target version candidate

### 3. Auto-prepare Release Candidate

major가 아니면 사용자 확인 없이 target version을 확정한다.

필요 시 자동으로 수행:

- `package.json.version` 갱신
- release 관련 문서 drift 수정
- template drift 반영
- publish artifact metadata 정리

이 단계가 끝나면 release candidate는 **배포 가능한 단일 상태**여야 한다.

### 4. Workflow-aligned Stability Gate

최종 release candidate 상태에서 workflow와 같은 순서로 검증한다.

```bash
bun install --frozen-lockfile
bun run check
bun run test:e2e
```

- 이 단계는 canonical quality gate다.
- 실패 시 즉시 중단하고 실패 원인을 요약한다.

### 5. Package Integrity Gate

```bash
npm pack --dry-run
```

확인:

- `name`, `version`, `exports`, `files`, `publishConfig`
- tarball contents
- 불필요한 파일 포함 여부
- `dist/`, `templates/` 포함 여부
- `prepack` 실행 결과 drift 없음

필요하면 추가로:

```bash
bun run generate:template
git diff --stat -- templates/
```

### 6. Release Docs Gate

확인 대상:

- `README.md`
- `README.en.md`
- `opencode.example.json`
- `.github/workflows/publish-npm.yml`

이번 release의 user-facing 변경과 문서가 어긋나면 자동 수정 후 release candidate에 포함한다.

문서 검증은 전체 문서를 다시 쓰는 것이 아니라,
**이번 릴리즈에서 바뀐 user-facing surface가 문서에 반영되어 있는지**를 확인하는 과정이다.

### 7. Optional Workflow Dry-run

기본 경로는 아니다.

하지만 아래 조건 중 하나면 `workflow_dispatch` dry-run을 우선 실행해도 된다:

- `.github/workflows/publish-npm.yml` 자체가 이번 release에 변경됨
- publish path에 최근 변경이 있었음
- release risk가 평소보다 높다고 판단됨

가능할 때:

```bash
gh workflow run publish-npm.yml -f dry_run=true
gh run watch
```

dry-run 실패 시 실제 tag release는 진행하지 않는다.

### 8. Release Commit

release candidate가 clean하게 준비되면 release commit을 만든다.

예시:

```bash
git add <release-related files>
git commit -m "release: vX.Y.Z"
```

보통 포함될 수 있는 것:

- version bump
- docs sync
- templates / generated drift fixes

release preparation 결과 파일 변경이 전혀 없다면 empty commit을 만들지 않는다.
그 경우 현재 HEAD를 그대로 release 대상으로 사용한다.

### 9. Tag + Push

```bash
git tag -a vX.Y.Z -m "release: vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

tag push가 실제 publish workflow trigger다.

- force push 금지
- existing release tag 재사용 금지

### 10. Watch GitHub Publish Workflow

`gh`로 tag에 연결된 publish workflow를 추적한다.

예:

```bash
gh run list --workflow publish-npm.yml --limit 5
gh run watch <run-id>
```

확인:

- workflow started
- jobs green
- publish step success

workflow 실패 시 release는 실패로 보고한다.

### 11. Post-release Verification

workflow 성공 후 npm registry를 확인한다.

```bash
npm view opencode-nexus version
```

기대값:

- registry version == `X.Y.Z`

일치하면 release 완료다.

## Hard Blockers

아래는 질문 없이 즉시 중단 후 보고한다:

- dirty working tree at start
- not on `main`
- behind/diverged from `origin/main`
- no commits since last release
- tests/check/package gate failure
- workflow file missing or release path unclear
- target tag already exists and no safe auto-bump available
- tag push failure
- GitHub publish workflow failure
- npm registry version mismatch after workflow success

## Output Contract

최종 보고는 아래 형식을 따른다.

```text
Release Result
--------------
Previous release:  vA.B.C
Target release:    vX.Y.Z
Bump type:         patch / minor / major
Reason:            <why this bump>

Checks:
- install/check:   PASS / FAIL
- e2e:             PASS / FAIL
- package:         PASS / FAIL
- docs/template:   PASS / FAIL
- workflow:        PASS / FAIL
- npm verify:      PASS / FAIL

Release commit:    <sha or reused HEAD>
Tag:               vX.Y.Z
Workflow run:      <url or id>
npm version:       <observed version>

Changed files:
- <list>

Final status:
- RELEASED
- or BLOCKED: <reason>
```

## Rules

- 기본은 자동 진행, **major만 질문**
- release path는 **tag push -> GitHub Actions -> OIDC publish**
- 로컬 `npm publish`는 canonical path로 사용하지 않는다
- workflow와 로컬 가정이 다르면 workflow를 따른다
- release 도중 기능 코드를 수정해서 테스트를 억지로 통과시키지 않는다
- 사용자 요청 없이 force push, local publish, destructive git 명령 사용 금지
- push 후에는 반드시 workflow와 npm registry까지 확인해야 한다
