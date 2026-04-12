# Release Rules

opencode-nexus 배포 전 반드시 통과해야 하는 게이트.

## Preflight

- `src/index.ts` default export 확인
- `package.json` main/exports → `dist/index.js` 확인
- `bun.lock` 최신 상태 확인

## Validation

- `bun run check` 통과
- `bun run test:e2e` 전체 통과 (conformance 포함)
- `bun run build` 성공
- system injection, guardrails e2e 통과 확인

## Packaging

- publishable files: `dist/`, `templates/` 만 포함 (`package.json` files 필드)
- `README.md` 현재 동작 반영 확인

## Post-release

- git tag 생성
- npm publish
- clean project에서 설치 smoke test:
  ```json
  { "$schema": "https://opencode.ai/config.json", "plugin": ["opencode-nexus"] }
  ```

## Mandatory Gates

- guardrails, system injection e2e 실패 시 배포 불가
- `e2e-loader-smoke` 실패 시 배포 불가 (runtime nexus-core 참조 금지 — anti-pattern #5)
