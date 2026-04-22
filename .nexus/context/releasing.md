<!-- tags: release, npm, github-actions, checklist -->
# 릴리즈 체크리스트

이 문서는 에이전트가 `opencode-nexus`를 배포하기 직전에 스스로 확인할 항목만 정리한 체크리스트다.

원격 서비스 상태처럼 이 레포와 로컬 명령만으로 검증할 수 없는 항목은 포함하지 않는다.
예를 들어 npm Trusted Publisher가 실제로 연결되어 있는지는 이 문서의 체크 대상이 아니다.

## 1. 버전과 태그

- 이번 변경이 patch인지 minor인지 먼저 결정
- pre-v1 정책에 따라 breaking change가 있으면 patch가 아니라 minor를 선택
- breaking change가 없으면 patch를 우선 검토
- `package.json`의 `version`이 위 결정과 일치하는지 확인
- README의 설치 예시 버전이 `package.json` 버전과 일치하는지 확인
- 생성 예정 태그가 있다면 형식이 `vX.Y.Z`인지 확인
- 생성 예정 태그 버전이 `package.json` 버전과 정확히 일치하는지 확인
- 가능하면 `npm view opencode-nexus versions --json`로 같은 버전이 이미 배포되었는지 확인

## 2. 작업트리 상태

- `git status --short`로 현재 변경사항을 확인
- 의도하지 않은 임시 파일, tarball, 테스트 산출물, 디버그 파일이 없는지 확인
- generated 파일이 최신인지 확인 (`bun run sync` 또는 `bun run sync:dry` 기준)

## 3. 자동 검증 명령

- `bun install` 실행
- `bun run check` 통과 확인
- `bun run test:e2e` 통과 확인
- `npm pack --dry-run` 결과에서 의도한 파일만 포함되는지 확인

위 네 단계 중 하나라도 실패하면 배포를 진행하지 않는다.

## 4. 패키지 결과물 점검

- `npm pack --dry-run` 결과에 다음이 포함되는지 확인
  - `README.md`
  - `LICENSE`
  - `package.json`
  - `bin/`
  - `lib/`
  - `src/`
  - `skills/`
- `npm pack --dry-run` 결과에 다음이 포함되지 않는지 확인
  - `.github/`
  - 임시 디렉토리
  - 불필요한 테스트 전용 파일

## 5. install 결과 불변조건 점검

임시 디렉토리에서 아래를 자동으로 재현해 확인한다.

1. 빈 디렉토리 생성
2. `node bin/opencode-nexus.mjs install --scope=project --skip-models` 실행
3. 생성된 `opencode.json` 확인
4. 생성된 `.opencode/skills/` 확인

반드시 확인할 항목:

- `plugin`이 현재 CLI 버전으로 pin되는지 확인
- `mcp.nx`가 `{"type":"local","command":["nexus-mcp"]}`인지 확인
- `default_agent`가 `lead`인지 확인
- `agent.build.disable === true`인지 확인
- `agent.plan.disable === true`인지 확인
- `.opencode/skills/` 아래에 `nx-auto-plan`, `nx-plan`, `nx-run`이 복사되는지 확인

## 6. 병합 동작 점검

기존 설정 파일이 있을 때도 의도한 키만 바뀌는지 확인한다.

- 기존 `plugin`의 unrelated entry가 보존되는지 확인
- 기존 `mcp`의 unrelated entry가 보존되는지 확인
- 기존 `default_agent` 또는 `mcp.nx` 충돌 시 `--force` 없이 덮어쓰지 않는지 확인
- 기존 bare package entry가 있으면 현재 버전 pin 하나로 정규화되는지 확인

## 7. CLI UX 점검

이 항목은 사람이 손으로 눌러보는 대신, 가능한 한 재현 가능한 방식으로 확인한다.

- install interactive 첫 화면이 scope 선택으로 시작하는지 확인
- models interactive 첫 화면이 scope 선택으로 시작하는지 확인
- models 메인 화면에 다음이 모두 보이는지 확인
  - `lead`
  - `general`
  - `explore`
  - Nexus subagent 전체
- 각 agent 줄이 `[ ] name  > current-model` 형태로 보이는지 확인
- 메인 화면에 `Next`, `Done`, `Cancel`이 함께 보이는지 확인
- provider 선택 -> model 선택 -> 메인 화면 복귀 흐름이 유지되는지 확인
- direct mode로 `lead`, `general`, `explore` 모델 override가 실제 파일에 기록되는지 확인

UI를 변경한 릴리즈라면 `expect` 같은 도구로 첫 화면 캡처까지 남기는 것이 좋다.

## 8. 문서 정합성 점검

- README가 `Node.js >= 22` 요구사항을 명시하는지 확인
- README가 `node` 실행 기반이고 `bun`은 설치 도구로 지원한다고 설명하는지 확인
- README의 install 예시가 현재 실제 CLI 흐름과 일치하는지 확인
- README의 upgrade 설명이 현재 install 동작과 일치하는지 확인

## 9. GitHub Actions 점검

- `.github/workflows/validate.yml`가 존재하는지 확인
- `.github/workflows/publish-npm.yml`가 존재하는지 확인
- publish workflow 경로/파일명이 Trusted Publishing 계약과 맞는지 레포 기준으로 확인
- `validate.yml`가 `bun run check`, `bun run test:e2e`, `npm pack --dry-run`을 실행하는지 확인
- `publish-npm.yml`가 태그 push에서 동작하도록 설정되어 있는지 확인
- `publish-npm.yml`가 `npm publish --provenance --access public`를 사용하는지 확인
- `publish-npm.yml`가 `id-token: write` 권한을 선언하는지 확인
- `publish-npm.yml`가 git tag와 `package.json` 버전 일치 여부를 검증하는지 확인

## 10. PR 규칙

- 릴리즈에 포함될 수정사항은 가능하면 `main`에 직접 커밋하지 않고 작업 브랜치에서 정리한다
- 배포 전에 브랜치에 릴리즈 관련 수정이 남아 있다면 `main` 병합은 PR 경로를 우선 사용한다
- PR을 만들기 전 최소한 다음 로컬 검증이 끝나 있어야 한다
  - `bun run check`
  - `bun run test:e2e`
  - `npm pack --dry-run`
- PR 설명에는 최소한 다음 내용을 포함한다
  - 왜 이 릴리즈가 필요한지
  - 버전 결정 근거 (patch/minor)
  - 사용자에게 보이는 변경점
  - install/models UX나 publish 흐름에 영향이 있는지 여부
- validate workflow가 있는 변경은 PR 병합 전에 `validate.yml` 기준이 깨지지 않도록 유지한다
- 태그 생성은 PR 병합 후 `main` 기준 상태에서 진행하는 것을 원칙으로 한다

## 11. 브랜치 정리 규칙

- PR이 병합되어 더 이상 작업이 남지 않은 브랜치는 정리 대상이다
- 다음 브랜치는 삭제하지 않는다
  - 현재 작업 중인 브랜치
  - 아직 병합되지 않은 브랜치
  - 후속 릴리즈나 hotfix를 위해 유지하기로 명시한 브랜치
  - 기본 브랜치 (`main`, `master`)
- 정리 대상 브랜치는 병합 완료 후 로컬 브랜치부터 삭제한다
- 원격 브랜치도 더 이상 필요 없으면 같이 삭제한다
- 브랜치를 삭제하기 전에는 그 브랜치에만 남아 있는 미출시 커밋이 없는지 확인한다
- 릴리즈 태그는 브랜치 정리 대상이 아니므로 삭제 규칙과 분리해서 다룬다

## 12. GitHub Release 규칙

- GitHub Release는 릴리즈 태그와 1:1로 대응시킨다
- Release 제목과 태그는 같은 버전 문자열을 사용한다 (`vX.Y.Z`)
- Release는 `main`에 병합된 기준 상태와 일치해야 한다
- validate 실패 상태, publish 실패 상태, 버전 불일치 상태에서는 Release를 확정하지 않는다
- GitHub Release 본문은 해당 버전의 `CHANGELOG.md` 항목을 기준으로 작성한다
- Release를 먼저 쓰고 CHANGELOG를 나중에 맞추지 않는다. 기준은 항상 CHANGELOG다
- CHANGELOG에 없는 내용을 Release 본문에 임의로 추가하지 않는다. 필요하면 먼저 CHANGELOG를 수정한 뒤 Release에 반영한다
- Release 본문에는 최소한 다음 내용을 포함한다
  - 이번 릴리즈의 핵심 변경 요약
  - 최종 사용자에게 보이는 변경점
  - install 또는 models UX에 영향이 있는지 여부
  - breaking change 여부
  - breaking change가 있다면 필요한 대응 또는 migration 안내
- pre-v1 정책상 minor에 breaking change가 들어갈 수 있으므로, minor 릴리즈에서는 호환성 영향 여부를 본문에 명시한다
- 검증 결과를 Release 본문에 남길 수 있으면 다음을 함께 적는다
  - `bun run check`
  - `bun run test:e2e`
  - `npm pack --dry-run`
- GitHub Release를 작성할 때 npm 패키지 버전, git tag, README 예시 버전이 서로 어긋나지 않는지 다시 확인한다
- 자동 생성된 릴리즈 노트를 그대로 쓰기보다, 실제 사용자 관점에서 중요한 변경과 주의사항을 수동으로 정리하는 쪽을 우선한다

## 13. CHANGELOG 정리 규칙

- `CHANGELOG.md`는 정식 운영 대상이며, 릴리즈 태그를 만들기 전에 같은 변경셋 안에서 반드시 함께 업데이트한다
- CHANGELOG 항목의 버전은 `package.json` 버전, git tag, GitHub Release 버전과 일치해야 한다
- GitHub Release 본문은 해당 버전의 CHANGELOG 항목을 요약하거나 재구성한 것이어야 한다
- CHANGELOG는 커밋 목록 복붙이 아니라 최종 사용자 관점의 변경 요약만 남긴다
- 내부 리팩터링처럼 사용자 영향이 거의 없는 내용은 필요할 때만 간단히 적고, 기본적으로는 사용자 영향이 있는 변경을 우선 기록한다
- install, models, publish 흐름처럼 사용 방식이 바뀌는 수정은 반드시 CHANGELOG에 남긴다
- breaking change가 있으면 별도 표시를 두고, 필요한 migration 또는 대응 방법을 함께 적는다
- pre-v1 minor 릴리즈에 breaking change가 들어간 경우, minor bump 이유가 CHANGELOG에서 드러나야 한다
- CHANGELOG와 GitHub Release가 서로 모순되지 않게 유지한다
- CHANGELOG는 장기 누적 기록으로, GitHub Release보다 더 안정적이고 압축된 서술을 목표로 한다
- GitHub Release 본문은 배포 시점 안내와 강조 포인트 중심으로 쓰되, 내용의 출처는 CHANGELOG여야 한다
- CHANGELOG에 새 버전 항목을 추가했다면, 같은 PR 안에서 README 예시 버전과 릴리즈 문서도 함께 맞춘다

## 14. 배포 직전 종료 조건

- 위 항목 중 하나라도 확인 실패 시 태그를 만들지 않는다
- 로컬/레포만으로 검증 불가능한 외부 상태를 "확인됨"으로 간주하지 않는다
- 자동 검증, 패키지 점검, CLI 점검이 모두 통과했을 때만 태그 생성 및 push를 진행한다
