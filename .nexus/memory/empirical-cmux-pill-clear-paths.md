<!-- tags: cmux, pill, hook, set-clear-pair, session-error, abort, race, serialize -->
# cmux Status Pill Set/Clear 경로 짝맞추기

이 파일은 같은 "cmux pill stuck" 증상을 일으킨 **두 개의 독립된 원인**과 각각의 교훈을 담는다. 한 파일로 응집된 이유는 둘 다 "비동기 외부 CLI로 UI 상태를 관리할 때 plugin이 놓치는 지점"이라는 같은 범주이기 때문이다.

## 증상 — 공통 패턴

여러 cmux 워크스페이스에서 `nexus-state=Running` pill이 세션 유휴 상태에서도 해제되지 않고 stuck.

### 경로 1 — abort 경로에서의 stuck (2026-04-23, v0.15.0)

실증 근거:
- `cmux list-log --workspace workspace:1` → `[nexus] [error] MessageAbortedError`
- `cmux list-log --workspace workspace:10` → `[nexus] [error] MessageAbortedError` (2회)
- 두 워크스페이스 모두 동시에 `cmux list-status` 결과 `nexus-state=Running icon=bolt color=#007AFF` 유지.
- 즉 `session.error` 훅이 실행되어 log와 notify는 정상 발생했으나 pill은 치워지지 않음.

### 경로 2 — 정상 완료에서의 race (2026-04-23, v0.15.1 재현)

v0.15.1에서 경로 1을 고친 뒤에도 정상 완료 턴에서 stuck 현상 관측.

실증 근거:
- `~/.local/share/opencode/log/<session>.log` 트레이스 결과 `session.idle` 이벤트가 실제로 fire됨이 확인. 즉 plugin 훅은 호출됐고 내부적으로 `cmuxClearStatus(PILL_KEY)`가 실행됐을 것.
- 그럼에도 cmux 서버의 `list-status`에는 `nexus-state=Running`이 잔존.
- Node `child_process.spawn`으로 "set-status → 10ms delay → clear-status" 패턴을 10회 반복 재현 실험 수행 → **마지막 호출이 clear였음에도 최종 pill 상태가 Running으로 stuck되는 현상을 직접 재현**.
- 터미널에서 `(cmux ... &)` subshell 병렬 spawn으로 한 이전 실험에선 재현 실패 — subshell 생성 오버헤드가 child 간격을 띄우기 때문. Node 런타임 내에서 연속 spawn해야 race 간격이 충분히 좁아져 재현.

## 근본 원인

### 경로 1 — set/clear 분기 비대칭

**`src/plugin.ts`의 pill 상태 관리에 set 분기와 clear 분기 사이의 비대칭**.

| 경로 | set (Running) | clear |
|------|--------------|-------|
| 정상 완료 (`session.idle`) | 없음 | ✅ 있음 |
| 정상 완료 (`session.status` idle variant) | 없음 | ❌ **누락** |
| busy 진입 (`session.status` busy) | ✅ 있음 | — |
| abort / error (`session.error`) | 없음 | ❌ **누락** — 이 버그의 직접 원인 |
| permission reply (`permission.replied`) | 없음 | ✅ 있음 |
| deleted (`session.deleted`) | 없음 | ✅ 있음 |

`session.error`는 log·notify만 호출하고 pill을 건드리지 않아, 앞선 busy set이 그대로 잔존. `session.idle` 이벤트가 abort 경로에서 fire한다는 보장은 OpenCode SDK 문서에 없음.

### 경로 2 — spawn race

경로 1을 고친 뒤에도 **정상 완료 시** stuck이 남았다. plugin 코드는 명시적으로 `cmuxSetStatus(Running)` 호출 뒤 `cmuxClearStatus(PILL_KEY)`를 호출하도록 작성됐지만, 두 호출이 OS 레벨에서 병렬 `fork + exec`로 실행되어 cmux Unix socket에 도달하는 순서가 역전될 수 있었다.

기존 `cmuxSpawn` 구현:
```ts
spawn("cmux", args, { stdio: "ignore", detached: true });
child.on("error", () => {});
child.unref();  // fire-and-forget
```

- `detached: true` + `unref()`는 parent가 child 종료를 기다리지 않음을 의미.
- 연속 두 번 호출되면 두 child process가 거의 동시에 fork됨.
- 각 child는 `connect(cmux_socket) + send(command) + exit` 수행. 이 단계는 OS 스케줄링에 따라 지연 가능.
- 결과: 나중에 쏜 child(`clear`)가 먼저 완료되고, 먼저 쏜 child(`set`)가 뒤에 완료되어 **cmux 서버 기준 마지막 write = set** 상태로 pill이 Running 고정.

재현 조건: **spawn 호출 간격 < fork/exec latency**. Node runtime 내 연속 호출은 간격 ≈ 0ms, fork latency ≈ 수 ms~수십 ms라 Reynolds number처럼 race가 확연히 드러난다. 반면 shell subshell 병렬 `(... &)`은 subshell 생성 자체에 수 ms 걸려 race 임계 아래로 떨어져 재현 안 됨.

## 교훈

### 교훈 1 — "set 분기마다 대응 clear 경로 짝지우기"

외부 시스템(cmux sidebar)에 상태를 **set**하는 분기가 하나 있다면, 그 상태를 **clear**할 수 있는 **모든 가능한 종료 경로**에서 명시적으로 clear를 호출해야 한다. 정상 경로만 커버하면 abort / error / timeout 같은 비정상 종료에서 ghost state가 남는다.

#### 적용 규칙

1. **Set-clear table을 먼저 그린다**. 새 pill/state 추가 시 가능한 모든 종료 이벤트를 행으로, set/clear 여부를 열로 정리.
2. **정상 경로 + 비정상 경로 둘 다**에서 clear를 호출한다. 비정상 경로 중 하나만 있어도 재발.
3. **Defense-in-depth**: 이벤트 하나에 clear를 의존하지 말고, 가능한 2개 이상 경로(예: `session.idle` + `session.status` idle variant)에서 함께 clear를 걸어둠.
4. **Negative regression test** 필수: non-root 세션이나 disabled 모드에서 clear가 **호출되지 않음**을 assert하는 test를 같이 넣는다. 새 set/clear 추가가 기존 guard를 뚫으면 즉시 fail.

### 교훈 2 — "외부 CLI spawn 체인은 반드시 serialize"

외부 CLI를 `child_process.spawn` fire-and-forget 패턴으로 호출하는 구조에서, **호출 순서가 서버 쪽 최종 상태를 결정하는 경우**(set/clear처럼 덮어쓰기 의미)는 반드시 promise queue로 serialize한다. 호출자 API는 fire-and-forget을 유지하더라도 내부적으로 child exit을 await해야 OS fork 스케줄링의 race를 제거할 수 있다.

#### 구현 패턴

```ts
let queue: Promise<void> = Promise.resolve();

function spawnSerialized(cmd: string, args: string[]): void {
  queue = queue
    .catch(() => {})  // 앞선 실패 무시, 후속 호출은 계속 진행
    .then(() => new Promise<void>((resolve) => {
      try {
        const child = spawn(cmd, args, { stdio: "ignore" });
        // detached/unref 제거 — parent가 child 종료를 기다려야 함
        const done = () => resolve();
        child.once("error", done);
        child.once("exit", done);
      } catch {
        resolve();
      }
    }));
}
```

핵심: 
- `queue`는 module-level 단일 Promise chain. 모든 호출이 여기로 append.
- `.catch`로 이전 실패를 덮어 다음 호출이 영원히 막히지 않도록 함.
- `detached: true` + `unref()` 제거. child가 짧게 끝나므로 leak 걱정 없음.
- 호출자는 즉시 반환 — plugin event loop blocking 없음.

#### 적용 규칙

1. **spawn 기반 외부 CLI 호출을 쓸 때 "호출 순서가 의미 있는가"를 먼저 묻기**. set/clear 덮어쓰기, insert/delete 같은 순서 의존 operation은 serialize 대상.
2. **race 재현 실험은 Node runtime 안에서**. shell `(... &)` subshell 테스트는 fork 오버헤드 때문에 race 임계를 넘기 어렵다.
3. **serialize 회귀 test는 rapid loop**. 10회 이상 set/clear 연속 쏜 뒤 마지막 상태 assert. race가 있으면 높은 확률로 그 중 한 번이라도 순서 역전이 발생.
4. **queue 오염 방지**: child spawn 자체가 throw할 수 있으므로 try/catch로 감싸고 `resolve()`로 queue 진행 보장.

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

- v0.15.1 (2026-04-23) — `src/plugin.ts`에 `session.error` root 경로의 `cmuxClearStatus` 호출 추가, `session.status` `"idle"` variant 분기 추가. e2e cmux-h/i/j 신규 scenario로 회귀 방지. **경로 1(분기 비대칭) 해결**.
- v0.16.0 (2026-04-23) — (1) `cmuxSpawn`을 module-level promise queue로 serialize. `detached: true` + `unref()` 제거하고 child `exit`/`error` 이벤트까지 대기. e2e cmux-k scenario(10회 busy/idle 연속 후 마지막 호출이 `set-status Needs Input`)로 회귀 방지. **경로 2(race) 해결**. (2) `session.idle` 및 `session.status idle` variant가 pill을 `clear-status`가 아닌 `set-status Needs Input`으로 전환하도록 UX 변경. 응답 완료 후에도 사이드바에 사용자 턴 신호가 남음. `session.error` / `session.deleted` / `permission.replied`는 기존대로 clear 유지.
- 릴리즈 체크리스트 §5-5-1 보강 — 이후 릴리즈부터는 두 clear 경로 호출 + serialize 순서 보장이 release gate 기준.

## Anti-patterns

- **"notify만 걸면 UX는 된다"** — 토스트만으로 사용자가 상태 변화를 인지한다고 가정하면 사이드바 pill은 ghost가 된다. notify와 set/clear는 별개 UX layer이며, 둘 다 수명 주기가 맞아야 함.
- **"event A가 항상 뒤따르니 event B에서 clear 생략 가능"** — SDK 문서에 "항상 뒤따른다"는 보장 없으면 단일 의존 금지. abort 경로는 특히 이벤트 순서가 달라질 수 있다.
- **"positive 경로만 test"** — set이 호출되고 clear가 호출되는 것만 assert하고, non-root guard에서 clear가 **호출되지 않음**을 assert하지 않으면 guard 회귀가 소리 없이 들어온다.
- **"spawn detached + unref면 순서도 지켜질 것"** — 절대 아니다. 병렬 fork된 child들은 각자 독립적으로 OS 스케줄링을 받으므로, 쏜 순서가 도착 순서와 다를 수 있다. 호출 순서가 상태에 의미 있으면 serialize는 협상 대상이 아닌 필수.
- **"한 번 터미널에서 (cmd &) 여러 번 쏴봤는데 race 없더라 → 안전"** — fork 간격이 실제 plugin보다 크다. race 재현은 Node runtime 내부에서 child_process.spawn 연속 호출로 해야 현실과 맞다.
