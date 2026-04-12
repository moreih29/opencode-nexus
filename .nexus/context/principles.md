<!-- tags: identity, mission, design, principles -->
# Mission & Design Principles

## Mission

opencode-nexus는 OpenCode를 위한 Nexus 오케스트레이션 런타임이다. claude-nexus와 sibling(자매) 관계로, Shared Prompt Library인 `@moreih29/nexus-core`를 consume하여 에이전트 협업에 운영 규율과 구조를 부여한다. 어느 harness가 주력인지에 따라 업데이트 방향이 flip 가능한 양방향 진화 모델을 따른다.

## Design Principles

**Coordination-first**: 실행 전에 먼저 분석하고 합의한다. 협업 흐름은 태그로 전환한다.

**Role separation**: 설계·분석, 구현, 검증을 분리하여 관점 충돌을 방지한다.

**Lead-mediated**: 모든 서브에이전트 조율은 Lead가 중재한다. 서브에이전트 간 직접 통신은 없다.

**Knowledge persistence**: 계층화된 지식 저장소로 세션을 넘어 프로젝트 맥락을 유지한다. 외부 공유 spec인 `@moreih29/nexus-core`를 consume하여 에이전트/스킬 정의를 claude-nexus와 동기화된 상태로 유지한다.

**Guardrails by default**: hook 기반 가드레일로 운영 규율을 강제한다.
