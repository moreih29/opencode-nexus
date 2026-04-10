<!-- tags: rules, conventions, testing, commits, deploy -->
# 개발 규칙

## 코드 컨벤션

- TypeScript strict 모드 유지
- ESM (`import/export`) 전용. CommonJS 금지
- `zod`로 외부 입력 스키마 검증

## 테스트 정책

- 새 기능/도구 추가 시 e2e 테스트 필수
- 테스트는 `scripts/e2e-*.mjs` 패턴을 따르며, `assert/strict` 사용
- `bun run test:e2e` 통과 후 머지

## 커밋 규칙

- Conventional Commits 형식: `type: description`
- type: feat, fix, refactor, docs, test, chore
- 본문 없이 한 줄 요약 선호

## 빌드/배포

- `bun run check` 통과 후 커밋
- `v*` 태그로 배포 트리거
