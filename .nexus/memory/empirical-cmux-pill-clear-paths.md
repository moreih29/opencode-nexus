<!-- tags: cmux, pill, hook, set-clear-pair, session-error, abort -->
# cmux Status Pill Set/Clear 경로 짝맞추기

## 증상 (2026-04-23, v0.15.0)

여러 cmux 워크스페이스에서 `nexus-state=Running` pill이 세션 유휴 상태에서도 해제되지 않고 stuck.

실증 근거:
- `cmux list-log --workspace workspace:1` → `[nexus] [error] MessageAbortedError`
- `cmux list-log --workspace workspace:10` → `[nexus] [error] MessageAbortedError` (2회)
- 두 워크스페이스 모두 동시에 `cmux list-status` 결과 `nexus-state=Running icon=bolt color=#007AFF` 유지.
- 즉 `session.error` 훅이 실행되어 log와 notify는 정상 발생했으나 pill은 치워지지 않음.

## 근본 원인

**`src/plugin.ts`의 pill 상태 관리에 set 분기와 clear 분기 사이의 비대칭**.

| 경로 | set (Running) | clear |
|------|--------------|-------|
| 정상 완료 (`session.idle`) | 없음 | ✅ 있음 |
| 정상 완료 (`session.status` idle variant) | 없음 | ❌ **누락** |
| busy 진입 (`session.status` busy) | ✅ 있음 | — |
| abort / error (`session.error`) | 없음 | ❌ **누락** — 이번 버그의 직접 원인 |
| permission reply (`permission.replied`) | 없음 | ✅ 있음 |
| deleted (`session.deleted`) | 없음 | ✅ 있음 |

`session.error`는 log·notify만 호출하고 pill을 건드리지 않아, 앞선 busy set이 그대로 잔존. `session.idle` 이벤트가 abort 경로에서 fire한다는 보장은 OpenCode SDK 문서에 없음.

## 교훈 — "set 분기마다 대응 clear 경로 짝지우기"

외부 시스템(cmux sidebar)에 상태를 **set**하는 분기가 하나 있다면, 그 상태를 **clear**할 수 있는 **모든 가능한 종료 경로**에서 명시적으로 clear를 호출해야 한다. 정상 경로만 커버하면 abort / error / timeout 같은 비정상 종료에서 ghost state가 남는다.

### 적용 규칙

1. **Set-clear table을 먼저 그린다**. 새 pill/state 추가 시 가능한 모든 종료 이벤트를 행으로, set/clear 여부를 열로 정리.
2. **정상 경로 + 비정상 경로 둘 다**에서 clear를 호출한다. 비정상 경로 중 하나만 있어도 재발.
3. **Defense-in-depth**: 이벤트 하나에 clear를 의존하지 말고, 가능한 2개 이상 경로(예: `session.idle` + `session.status` idle variant)에서 함께 clear를 걸어둠.
4. **Negative regression test** 필수: non-root 세션이나 disabled 모드에서 clear가 **호출되지 않음**을 assert하는 test를 같이 넣는다. 새 set/clear 추가가 기존 guard를 뚫으면 즉시 fail.

## 진단 방법

이런 stuck 상태가 의심되면 두 명령 조합으로 원인을 지목할 수 있다:

```bash
cmux list-log --workspace workspace:<id>       # 어떤 이벤트 경로가 활성화됐는지
cmux list-status --workspace workspace:<id>    # pill 현재 상태
```

- log에 error/warning 기록은 있으나 status에 clear 흔적 없으면 **clear 경로 누락**을 의심.
- log가 비어 있는데 status가 stuck이면 **set 분기가 event를 받지 못함** 또는 **event 전달 경로** 문제.

e2e 재현은 `scripts/e2e-nexus-integration.mjs`의 cmux shim 기반 mock 경로(cmux-a~j)에서 가능. 실제 cmux 사용 환경 없이도 정확한 argv 시퀀스로 assert할 수 있으며, shim이 argv를 jsonl로 기록하므로 전수 검증 가능.

## 수정 사례 링크

- v0.15.1 (2026-04-23) — `src/plugin.ts`에 `session.error` root 경로의 `cmuxClearStatus` 호출 추가, `session.status` `"idle"` variant 분기 추가. e2e cmux-h/i/j 신규 scenario로 회귀 방지.
- 릴리즈 체크리스트 §5-5-1 보강 — 이후 릴리즈부터는 두 clear 경로 호출이 release gate 기준.

## Anti-patterns

- **"notify만 걸면 UX는 된다"** — 토스트만으로 사용자가 상태 변화를 인지한다고 가정하면 사이드바 pill은 ghost가 된다. notify와 set/clear는 별개 UX layer이며, 둘 다 수명 주기가 맞아야 함.
- **"event A가 항상 뒤따르니 event B에서 clear 생략 가능"** — SDK 문서에 "항상 뒤따른다"는 보장 없으면 단일 의존 금지. abort 경로는 특히 이벤트 순서가 달라질 수 있다.
- **"positive 경로만 test"** — set이 호출되고 clear가 호출되는 것만 assert하고, non-root guard에서 clear가 **호출되지 않음**을 assert하지 않으면 guard 회귀가 소리 없이 들어온다.
