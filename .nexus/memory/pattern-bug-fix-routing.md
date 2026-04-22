<!-- tags: bug, triage, upstream, hotfix, decision-axis -->
# Bug Fix Routing — Upstream vs Local

## 원칙

버그나 배포 후 이슈가 발견되면 **원인 위치를 먼저 식별**한 뒤, 그 위치에 맞는 경로로 수정한다. 증상 발생 위치와 원인 위치가 다를 수 있으므로, 증상을 본 곳에서 성급히 patch 하지 않는다.

## 판단 플로우

```
1. 증상 재현 + 최소 재현 케이스 확보
2. 공식 spec / upstream docs 와 현재 동작 대조
3. 원인 위치 식별
   ├─ upstream 패키지/라이브러리 → A. Upstream 경로
   ├─ 우리 wrapper/래핑 코드       → B. Local 경로
   └─ 둘 다 관련 (계약 경계)       → C. 병행 경로
4. 사용자 영향도 평가
   ├─ critical (기능 미동작)       → 병행 우선 고려
   └─ minor (불편 수준)            → 원인 위치 단일 경로로 충분
5. 경로 실행
```

## A. Upstream 경로

- upstream repo 에 issue 등록 (최소 재현 + 공식 spec 레퍼런스 + 제안 fix + downstream 영향 포함)
- upstream fix 배포까지 **로컬 코드는 건드리지 않는다** — patch 를 쌓으면 upstream 수정 시 충돌 관리 비용 발생
- upstream 수정 완료 후 bump + 배포 + 이슈 close
- upstream repo 의 owner/maintainer 와 동일인이면 turnaround 가 짧아 이 경로 단독이 가장 깨끗함

## B. Local 경로

- wrapper/래핑 코드가 원인이면 직접 수정
- 브랜치 분기 (`fix/<slug>`) → 커밋 → PR → merge → tag → 배포
- 릴리즈 체크리스트(`.nexus/context/releasing.md`) 전체 통과 필수
- CHANGELOG + README 에 사용자 영향 명시

## C. 병행 경로 (긴급)

- 사용자 영향이 크고 upstream turnaround 가 불확실할 때
- Local 에 임시 patch 를 넣고 hotfix 배포 (예: sync 뒤에 post-process script 를 끼우는 방식)
- **patch 위치에 "upstream fix 후 제거 예정" 코멘트 필수**, 관련 upstream issue 번호 명시
- upstream 수정 완료 시 우리 patch 제거 + 새 bump 에서 반영 + 코멘트 제거

### 병행 경로 선택 기준

다음 조건 **모두** 충족 시에만 선택:
- upstream 수정 시점이 불투명 (외부 maintainer, 저자 부재 등)
- 사용자의 핵심 기능이 동작하지 않음 (불편 수준이 아니라 차단)
- Local patch 복잡도가 upstream 수정 복잡도보다 낮음

## 사례

### 2026-04-22 — opencode-nexus v0.13.1 skill 로딩 실패

- **증상**: `[plan]` 호출 시 OpenCode 가 `Skill "nx-plan" not found. Available skills: none`
- **원인 위치**: `@moreih29/nexus-core` 의 opencode harness sync 출력이 OpenCode 공식 spec 위반 (`name` 필드 누락, `triggers` 비표준 필드 사용)
- **경로 선택**: **A 단독** (upstream 이슈만)
- **근거**: upstream repo owner 가 wrapper 저자와 동일인 → turnaround 짧음 추정. Local patch 는 sync post-process 복잡도 대비 이득 낮음.
- **Issue**: https://github.com/moreih29/nexus-core/issues/57

## 부수 교훈 — 체크리스트 보완 후보

이번 사례에서 릴리즈 체크리스트(`.nexus/context/releasing.md`) §5 가 "파일 생성" 만 검증하고 "파일이 실제 OpenCode 에 의해 load 되는지" 는 검증하지 않았던 게 구멍이었다. 다음 중 하나를 체크리스트에 보강하는 것이 타당:

- 실제 OpenCode 에 install 후 `skill({name})` 호출 시 load 되는지 smoke test
- 생성된 `SKILL.md` frontmatter 가 OpenCode 공식 spec (`name` required, `description` required, `name ^[a-z0-9]+(-[a-z0-9]+)*$`, 디렉터리명 일치) 을 만족하는지 정적 검증

## Anti-patterns

- **증상 위치에서 patch 하기**: 원인이 upstream 인데 wrapper 에 band-aid 를 붙이면 upstream 수정 후 유령 코드가 남는다.
- **Local hotfix 없이 무작정 upstream 대기**: 사용자가 critical 영향을 받는 상태를 방치하면 신뢰 손상. C 경로 검토 필요.
- **경로를 정한 후 다른 경로 섞기**: A 로 결정했는데 중간에 local 이 급해 patch 쌓기 시작하면 나중에 upstream merge 와 충돌. 경로 전환 시에는 결정 자체를 다시 내리고 기록.
- **원인 식별 생략**: 증상만 보고 바로 경로 선택 금지. 재현 + spec 대조 + 원인 위치 확정이 선행되어야 한다.
