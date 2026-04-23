<!-- tags: opencode, plugin, version, upstream, renumbering, release-workflow -->
# `@opencode-ai/plugin` 버전 궤적과 업스트림 특이사항

우리 wrapper가 의존하는 `@opencode-ai/plugin` / `@opencode-ai/sdk`는 `anomalyco/opencode` monorepo가 published하는 외부 패키지다. 이 파일은 업스트림 버전 이력의 **의외성** — 특히 숫자가 기능 점프와 비례하지 않는 부분 — 을 정리해 다음 번 bump 검토 시 재참조되도록 한다.

## 1. 공식 저장소와 배포

- **GitHub repo**: `anomalyco/opencode` (과거 `sst/opencode` 아님. 2026년 전환)
- **npm 배포 패키지**: `@opencode-ai/plugin`, `@opencode-ai/sdk` 두 개. 플레인 `opencode`는 npm에 없음(바이너리 GitHub Release만).
- **릴리즈 노트 canonical source**: GitHub Releases. repo root에 `CHANGELOG.md` 없음.
- **monorepo sync**: `script/publish.ts`가 단일 `Script.version`으로 `packages/plugin`과 `packages/sdk/js`의 `package.json` version 필드를 **일괄 치환**. 즉 plugin과 sdk 버전은 항상 동기.

## 2. 실제 published 버전 궤적 (2026-04 기준)

npm point release 순서 (0.x dev timestamp 제외):

```
... 1.4.7, 1.4.8, 1.4.9, 1.4.10, 1.4.11, 1.4.12, 1.4.14, 1.4.17,
1.14.17, 1.14.18, 1.14.19, 1.14.20, 1.14.21
```

**특이사항**:
- **1.4.13, 1.4.15, 1.4.16 부재** — npm registry에 아예 entry 없음. 실패 retract인지 intentional skip인지 공식 설명 없음.
- **1.5.x ~ 1.13.x 전체 부재** — 1.4.17 다음이 바로 1.14.17.
- 1.4.12 / 1.4.14 / 1.4.17은 **npm-only publish** (GitHub Release 및 tag 없음).

## 3. 1.4.17 → 1.14.17 renumbering 사건 (2026-04-19)

이게 이 파일의 핵심 **주의 사항**이다. 숫자상 10 minor 점프지만 **실질 변화 없음**.

### 실증
- `1.4.17`과 `1.14.17`의 npm tarball을 unpack해 diff한 결과, **`package.json`의 `version` 필드와 `@opencode-ai/sdk` dep 버전 외 모든 파일 byte-identical**. `dist/index.js`, `dist/index.d.ts` 포함 컴파일 산출물이 완전 동일.
- 두 버전 publish 간격은 약 2.5시간 (1.4.17 @ 2026-04-19T00:35Z, 1.14.17 @ 03:02Z).

### 근본 원인 (커뮤니티 분석)
- PR `#22982` ("fix: stop rewriting dev during release publish")이 도입한 detached-HEAD release flow에서, release bot이 버전 번호 입력 오류(typo) 발생.
- 1.14.17 이후 태그 커밋은 repo의 어떤 브랜치에도 속하지 않는 **dangling commit**.
- maintainer의 공식 정정 대신 그 뒤로도 1.14.x 라인을 그대로 유지 중.
- 관련 이슈: `#23363` ("jumped from 1.4.10 to 1.4.17"), `#23419` ("1.4.x → 1.14.x?").

### 교훈
- opencode 버전 숫자를 그 자체로 기능 점프 크기로 해석하지 말 것. **tarball diff 또는 GitHub Compare API**로 실제 변화를 확인하는 것이 우선.
- 특히 wrapper의 `package.json` pin 점프를 고려할 때, 예상 size와 실제 diff이 괴리될 수 있음.

## 4. 1.4.9 → 1.14.21 전 구간 우리 영향 요약 (v0.16.3 조사 시점)

| 구간 | 우리가 쓰는 5개 hook + 이벤트 signature | plugin src |
|---|---|---|
| 1.4.9 → 1.4.17 | 변화 없음 | 전 구간 변경 0건 |
| 1.4.17 ↔ 1.14.17 | 변화 없음 | renumbering typo, byte-identical |
| 1.14.17 → 1.14.21 | 변화 없음 | hook signature 불변, `WorkspaceAdaptor.create` env 추가(우리 미사용)만 유일한 API 확장 |

**결론**: 이 전 구간 업그레이드는 숫자상 10 minor 점프였지만 실질은 "연속 patch 누적" 수준. 우리 코드 수정 없이 bump 가능했음.

## 5. Plugin 사용 5개 hook (역사적 불변)

아래 5개 hook signature는 1.4.9 ~ 1.14.21 구간 전 기간 **변화 없음**. 미래 bump 시 재확인 체크리스트의 1순위:

- `config`
- `event` (특히 `session.created/deleted/idle/status`, `message.part.updated`, `session.error`, `permission.replied`)
- `tool.execute.before`
- `permission.ask`
- `chat.message`

참조 파일: `pattern-opencode-plugin-surface.md` (우리 코드 관점에서 접점 지도).

## 6. 다음 opencode bump 검토 시 절차

1. `npm view @opencode-ai/plugin versions --json`으로 현재 궤적 확인.
2. 숫자 점프가 있으면 **tarball diff**로 실질 변화 검증:
   ```
   npm pack @opencode-ai/plugin@<from>
   npm pack @opencode-ai/plugin@<to>
   diff -r <from>/ <to>/
   ```
3. `pattern-opencode-plugin-surface.md`의 hook/event/config schema checklist를 따라 재검증.
4. renumbering typo가 다시 발생했을 가능성 — `#23419` 같은 GitHub issue로 확인.

## 7. 참조 URL

- GitHub repo: `https://github.com/anomalyco/opencode`
- npm registry: `https://registry.npmjs.org/@opencode-ai/plugin`
- Issue #23363: `https://github.com/anomalyco/opencode/issues/23363`
- Issue #23419: `https://github.com/anomalyco/opencode/issues/23419`
- PR #22982 (renumbering 원인): `https://github.com/anomalyco/opencode/pull/22982`
- `script/publish.ts` @ `5eaef6b`: `https://github.com/anomalyco/opencode/blob/5eaef6b/script/publish.ts`

## 조사 원본

이 파일은 v0.16.3 cycle(2026-04-23)의 researcher 2명 + architect + Lead 직접 확인 결과를 통합. 원본 조사 artifact는 `.nexus/history.json`의 cycle archive에 보존.
