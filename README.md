# opencode-nexus

[![npm version](https://img.shields.io/npm/v/opencode-nexus)](https://www.npmjs.com/package/opencode-nexus)

> [English](README.en.md)

OpenCode를 위한 Nexus 오케스트레이션 플러그인.

`opencode-nexus`와 `claude-nexus`는 동일한 `@moreih29/nexus-core`를 기반으로 하는 자매(sibling) 프로젝트입니다. 복잡한 작업을 즉흥 프롬프트로 굴리는 대신, 구조화된 플래닝, 태스크 기반 실행, 지속되는 프로젝트 지식 흐름을 OpenCode에서 사용할 수 있게 합니다.

## Why

OpenCode가 에이전트와 도구를 제공한다면, `opencode-nexus`는 그 위에 운영 규율을 얹습니다.

- 구현 전에 `[plan]`로 먼저 결정
- `[run]`에서 명시적인 task state로 실행
- `.nexus/`에 프로젝트 지식 축적
- 느슨한 프롬프트 관습 대신 Nexus 도구 사용
- 편집, 위임, 검증, 사이클 종료에 가드레일 추가

## Quick Start

입구는 `Entrypoint Commands`, 정식 기준은 `Canonical Tools`, 흐름 제어는 `Coordination Tags`입니다.

프로젝트 `opencode.json`에 플러그인을 추가합니다.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-nexus"],
  "instructions": ["AGENTS.md"]
}
```

또는 포함된 예제 설정을 시작점으로 사용해도 됩니다.

- 최소 설정: `opencode.minimal.json`
- 확장 예제: `opencode.example.json`

그다음 프로젝트 안에서 setup entrypoint를 실행합니다.

```text
Use nx-setup to configure this repository for opencode-nexus.
```

이 entrypoint는 canonical `nx_setup` 도구로 연결되며, 두 가지 주요 설정을 다룹니다:

**Scope** — project 수준 (`./opencode.json`) 또는 user 수준 (`~/.config/opencode/opencode.json`)을 선택합니다.

**Model 할당** — Nexus는 세 가지 카테고리로 나뉜 9개 서브에이전트를 가집니다. 예산과 품질 요구에 맞는 접근 방식을 선택하세요:

| 접근 방식 | nexus + HOW | DO + CHECK |
|---|---|---|
| `unified` | 모든 곳에 같은 모델 | 모든 곳에 같은 모델 |
| `tiered` | 고성능 모델 | 표준 모델 |
| `budget` | 고성능 모델 | budget 모델 |
| `custom` | 카테고리별 또는 에이전트별 overrides | 카테고리별 또는 에이전트별 overrides |

설정 후에는 선택적으로 nx-init을 통해 프로젝트 지식을 초기화할 수 있습니다:

```text
Use nx-init to scan this project and create initial Nexus knowledge.
```

플러그인이 config를 주입할 때 기본 primary는 `build`가 아니라 `nexus`입니다. `nexus`는 Nexus 상태와 task pipeline을 우선 이해하는 조율형 primary입니다.

## 이 저장소에서 개발할 때

이 저장소 자체에서는 npm 패키지 로딩 대신 `.opencode/plugins/opencode-nexus.js`를 통해 로컬 빌드 결과물을 로드합니다.

- 현재 저장소의 `opencode.json`은 `instructions`만 유지하고, 플러그인 로딩은 `.opencode/plugins/`에 맡깁니다.
- 로컬 플러그인 shim은 `../../dist/index.js`를 참조하므로, 먼저 `bun run build`가 되어 있어야 합니다.
- 소스를 수정한 뒤 OpenCode에서 새 동작을 확인하려면 다시 `bun run build`를 실행해야 합니다.

권장 self-hosting 절차:

```text
1. bun install
2. bun run build
3. 이 저장소 루트에서 OpenCode 실행
4. 세션에서 nx_context 또는 nx_setup 같은 Nexus 도구가 보이는지 확인
```

중요:

- 이 저장소에서 `opencode.json`에 다시 `"plugin": ["opencode-nexus"]`를 넣으면 npm 플러그인과 local plugin이 함께 로드될 수 있어 개발 검증이 헷갈릴 수 있습니다.
- 배포된 패키지를 다른 프로젝트에서 사용할 때만 README 상단의 npm 플러그인 설정을 사용하세요.
- 이 저장소에서는 `nx_setup(profile="auto")`가 이 충돌을 감지해 `opencode.json`에 package plugin을 추가하지 않습니다.

권장 첫 실행:

```text
Use nx-init to scan this project and create initial Nexus knowledge.
```

이 entrypoint는 canonical `nx_init` 도구로 연결됩니다.

## 첫 사용

- 미팅: `[plan] 인증 플로우를 어떻게 설계할까?`
- 결정 기록: `그 방향으로 가자 [d]`
- 실행: `[run] 합의한 인증 플로우를 구현해줘`

## Entrypoint Commands

| Entrypoint | Canonical Tool | Purpose |
| --- | --- | --- |
| `nx-setup` | `nx_setup` | OpenCode용 `AGENTS.md`, `opencode.json`, entrypoint skill 설치 |
| `nx-init` | `nx_init` | 프로젝트 온보딩과 초기 지식 생성 |
| `nx-sync` | `nx_sync` | 컨텍스트 문서(`.nexus/context/`)를 현재 프로젝트 상태에 맞게 동기화 |

## 태그

| 태그 | 용도 | 예시 |
| --- | --- | --- |
| `[plan]` | 구현 전 의사결정 모드 | `[plan] DB 마이그레이션 전략 논의` |
| `[run]` | Nexus task pipeline으로 실행 | `[run] 마이그레이션 계획 구현` |
| `[d]` | 현재 미팅의 결정 기록 | `2안으로 가자 [d]` |
| `[rule]` | 팀의 지속 규칙 저장 | `[rule:testing] publish 전에 typecheck 필수` |

## 내장 에이전트

| 카테고리 | 에이전트 | 역할 |
| --- | --- | --- |
| HOW | Architect | 아키텍처와 기술 설계 리뷰 |
| HOW | Designer | UI/UX 및 인터랙션 설계 |
| HOW | Postdoc | 방법론 설계와 증거 종합 |
| HOW | Strategist | 제품 방향과 전략 정리 |
| DO | Engineer | 구현과 디버깅 |
| DO | Researcher | 독립 조사와 리서치 |
| DO | Writer | 문서와 작성형 산출물 |
| CHECK | QA | 테스트, 검증, 리스크 리뷰 |
| CHECK | Reviewer | 내용 및 사실 검토 |

## Canonical Tools and Tags

`nx_*` 도구가 실제 실행 계약입니다. `nx-setup`, `nx-init`, `nx-sync`는 이 도구들로 들어가는 얇은 entrypoint입니다. 반면 `[plan]`, `[run]`, `[d]`, `[rule]`은 실행 명령이 아니라 협업 흐름을 바꾸는 Coordination Tags입니다.

## 내장 스킬

| 스킬 | 트리거 | 역할 |
| --- | --- | --- |
| `nx-plan` | `[plan]` | 구조화된 논의와 결정 워크플로 |
| `nx-run` | `[run]` | 태스크 기반 실행 워크플로 |
| `nx-init` | `nx-init` | `nx_init`로 라우팅되는 온보딩 entrypoint |
| `nx-sync` | `nx-sync` | `nx_sync`로 라우팅되는 동기화 entrypoint |
| `nx-setup` | `nx-setup` | `nx_setup`로 라우팅되는 설정 entrypoint |

## OpenCode에 추가되는 것

- HOW / DO / CHECK 역할로 나뉜 9개 Nexus 에이전트 카탈로그
- 기본 primary `nexus`와 specialist subagent 조합
- `.nexus/state/`에 저장되는 상태 기반 plan/task 워크플로
- canonical `plan.json` + 세션 범위 `.nexus/state/opencode-nexus/agent-tracker.json`에서 파생되는 HOW 패널 연속성
- HOW 패널 participant별 runtime `task_id/session_id` 재개 힌트 저장 (ephemeral, 세션 경계에서 reset)
- `nx_plan_resume`로 HOW participant 재개 핸들 조회 가능
- `nx_plan_followup`로 HOW participant follow-up delegation 입력 생성 가능
- `.nexus/context/`(설계 문서)와 `.nexus/memory/`(lessons/참조) 기반의 flat 지식 구조
- edit 도구에 대한 task pipeline 가드레일
- meeting reminder, run notice, 더 엄격한 cycle-close discipline
- `nx_plan_*`, `nx_task_*`, `nx_context`, `nx_briefing`, `nx_init`, `nx_sync`, `nx_setup` 같은 Nexus 전용 도구
- 구조화된 plan discussion 레코드와 plan -> task linkage 상태 추적

## 지식 구조

`opencode-nexus`는 `.nexus/`에 프로젝트 지식과 워크플로 상태를 저장합니다.

- `context/` — 정적 설계 문서 (architecture, orchestration, principles 등)
- `memory/` — lessons learned, references, anti-patterns
- `rules/` — 팀 규칙
- `config.json` — Nexus 설정
- `history.json` — 아카이브된 사이클 기록
- `state/` — 현재 plan/task 중심 실행 상태

## 중요 참고

- `AGENTS.md`가 OpenCode의 기본 instruction 파일입니다.
- `CLAUDE.md`는 마이그레이션용 legacy 입력으로만 취급합니다.
- 이 프로젝트는 `claude-nexus`의 OpenCode 네이티브 마이그레이션이지만 아직 완전 parity는 아닙니다.
- 현재 강한 부분: hook, task/plan 상태 도구, 에이전트 카탈로그, 시스템 가이드.
- 아직 부분적인 부분: 더 깊은 code intelligence 범위와 일부 워크플로 parity.

## 문서

- `docs/operations.md` — 런타임 워크플로와 가드레일
- `docs/coverage-matrix.md` — 구현 범위 현황
- `UPSTREAM.md` — claude-nexus 및 `@moreih29/nexus-core` 관계 선언
- `docs/reference-boundaries.md` — legacy 동작과 현재 OpenCode 동작의 경계

## License

MIT
