<!-- tags: identity, roadmap -->
# Roadmap

## Phase 1 (현재)

- **nexus-core 저장소 생성** — `@moreih29/nexus-core` scoped npm 패키지 초기화
- **Schema + capability vocabulary 설계** — 에이전트/스킬 정의의 공유 spec 구조 확정
- **claude-nexus body 추출** — claude-nexus의 프롬프트 본체를 nexus-core로 이전
- **opencode-nexus loader(codegen) 통합** — nexus-core 패키지를 consume하는 로더 구현 ✓ 완료 (2026-04-11, `phase1-nexus-core-adoption`, `a9cb773`–`ee52ed5`)
- **Stale 문서 정리** — 구 positioning 인벤토리 문서 삭제 및 `docs/bridge/nexus-core-bootstrap.md` 도입

## Phase 2 (flip 순간)

- **claude-nexus의 nexus-core consumer 전환** — claude-nexus가 동일한 `@moreih29/nexus-core`를 consume
- **양방향 동일 source 소비** — 두 harness 모두 nexus-core를 canonical source로 운영
- Phase 2 전환 조건 및 신호는 UPSTREAM.md 참조

## Ongoing

- **Code intelligence 범위 확대** — AST/LSP 기반 도구의 커버리지 강화
- **안정성 강화** — e2e 테스트 확충과 엣지 케이스 처리
