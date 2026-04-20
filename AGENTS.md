<!-- NEXUS:START -->
## Nexus Agent Orchestration

**OpenCode model** — lead-mediated orchestration with task state, hook guardrails, and coordination labels.

### Lead Agent

OpenCode에서 기본 동작하는 `lead` 에이전트가 Nexus 워크플로를 중재합니다. Lead는 task state, delegation, 최종 보고를 담당합니다.

### Agent Catalog

Canonical agent 정의는 `@moreih29/nexus-core`에서 관리됩니다:

- **HOW agents**: architect, designer, postdoc, strategist — 접근법과 설계를 조언
- **DO agents**: engineer, researcher, writer — 활성 task에 대해 실행
- **CHECK agents**: tester, reviewer — 검증하고 PASS/FAIL로 보고

상세 역할 및 모델 매핑은 nexus-core 문서를 참조하세요.

### Skills

| Skill | Trigger | Purpose |
|-------|---------|---------|
| nx-init | `skill({ name: "nx-init" })` | 프로젝트 온볼딩 — scan, mission, essentials, context generation |
| nx-plan | `[plan]` | 구조화된 논의와 결정 |
| nx-run | `[run]` | 태스크 기반 실행 |
| nx-sync | `[sync]` | 컨텍스트 동기화 |
| deploy | `skill({ name: "deploy" })` | 릴리즈 오케스트레이션 (opencode-nexus 고유) |

### Coordination Tags

| Tag | Purpose |
|-----|---------|
| `[plan]` | 리서치, 다관점 분석, 결정, 계획서 생성 |
| `[d]` | 결정 기록 (`nx_plan_decide`) |
| `[run]` | 실행 태스크 파이프라인 |
| `[rule]` | 지속 규칙 저장 |

### Core Guidelines

- `[plan]`은 주요 구현 결정 전에 사용
- `[d]`는 활성 plan 낶부에서만, 지지 논의 기록 후 사용
- `[run]`은 태스크 파이프라인이 필요할 때 사용
- 파일 편집 전 `nx_task_add`로 태스크 등록
- `main`/`master`에서의 substantial 작업 전 Branch Guard 적용

### Platform Mapping

- Primary instruction: `AGENTS.md` + `opencode.json.instructions`
- `CLAUDE.md`는 legacy 마이그레이션 입력 전용
- Claude slash skill → `nx_*` 도구 + 태그
- Claude team API → lead-mediated delegation + coordination labels
<!-- NEXUS:END -->

---

**참조**: 상세 agent 정의, skill 구현, vocabulary는 `@moreih29/nexus-core` canonical assets를 참조하세요.
