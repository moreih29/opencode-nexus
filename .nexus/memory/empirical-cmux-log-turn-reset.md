<!-- tags: cmux, log, reset, turn-boundary, append-only, session-error, idle-to-running, message-aborted-error -->
# cmux 사이드바 로그의 turn-boundary 자동 reset

이 파일은 cmux 사이드바 **log 패널**의 수명 주기 관리에서 배운 경험칙을 정리한다. pill 상태 관리(`empirical-cmux-pill-clear-paths.md`)와는 다른 축이며, "비동기 외부 CLI로 UI 상태를 관리할 때 plugin이 놓치는 지점"이라는 상위 범주에서만 겹친다.

## 증상 (2026-04-24, v0.16.3까지)

- 사용자 cmux 워크스페이스에서 `cmux list-log --workspace workspace:<id>` 결과로 `[nexus] [error] MessageAbortedError` 등 과거 턴에서 기록된 에러 엔트리가 계속 누적.
- 사용자가 새 입력을 넣고 세션이 Running 상태로 돌아와도 과거 에러 로그가 그대로 보여 UX상 "아직 에러 상태인가?" 혼동 유발.
- 지우려면 사용자가 수동으로 `cmux clear-log`를 터미널에서 실행해야 했음.

구체 재현 조건:
- v0.15.0 이전에 MessageAbortedError가 `cmuxLog("error", ...)`로 기록된 뒤 그 로그가 그대로 남아 있는 경우 (v0.16.3에서 abort 경로는 더 이상 로그 기록 안 하지만 히스토리는 남음).
- v0.16.3 이후에도 fatal `session.error`(예: 실제 exception)는 여전히 error 로그를 기록하므로 같은 증상 재발 가능.

## 근본 원인

### 원인 A — append-only sink에 state-carrying 로그를 쓰는 구조

`cmuxLog`는 항상 `log --level <...>` 서브커맨드로 cmux CLI를 호출하는 fire-and-forget append-only 쓰기다. cmux 로그 패널은 **시간순 누적** 구조이므로 한번 기록된 엔트리는 자동 소멸하지 않는다. plugin 쪽에서 "이 로그는 사용자 턴 경계까지만 유효"라는 의미를 표현할 방법이 `cmux clear-log` 호출 밖에 없는데, v0.15.0~v0.16.3 동안 그 호출 경로 자체가 존재하지 않았음.

즉 **에러 상태 UX를 append-only sink에 맡겨두고 reset 경로를 설계하지 않은 것**이 원인. set path(`cmuxLog("error", ...)`)만 있고 clear path가 없어 로그가 단방향으로만 증가.

### 원인 B — cmux CLI에 `--source` 필터가 없다는 제약

`cmux clear-log --help` 결과 플래그는 `--workspace <id|ref>` 하나뿐. 특정 source(예: nexus)만 골라 지우는 수술적 clearing은 불가. "전 workspace 로그 지우기" 또는 "아무것도 안 하기"의 이진 선택만 가능.

이 제약 때문에 "에러만 치우고 retry warning이나 다른 플러그인 로그는 보존"하는 단순한 설계가 닫혔고, 대신 **도메인 경계(턴 경계)에서 일괄 reset**하는 쪽을 선택해야 했음.

## 교훈

### 교훈 1 — "append-only 외부 sink에 상태성 로그를 쓰면 reset 도메인 경계를 코드로 명시하라"

로그가 순수 append-only일수록 "이 엔트리는 어느 시점까지 유효한가"를 plugin 쪽에서 명시적으로 선언해야 한다. 선언 안 하면 **엔트리 수명이 무한**이 되어 시간이 지날수록 UX가 stuck error로 오인되는 경향성에 끌려간다.

#### 적용 규칙

1. **새로 `log/notify/warn` 류 외부 호출을 추가할 때 "이 엔트리의 의미상 수명은 무엇인가?" 묻기**. 답이 "다음 사용자 턴까지" 수준이면 해당 도메인 경계에서 reset 호출을 함께 설계.
2. **set path가 하나라도 들어가면 대응 clear path를 즉시 만든다**. `empirical-cmux-pill-clear-paths.md` 교훈 1("set-clear 짝짓기")과 같은 축의 원칙을 log/notify에도 그대로 적용.
3. **도메인 경계는 이벤트 필드 하나가 아니라 state machine으로 표현**. 단일 이벤트에 reset을 걸면 이벤트가 여러 번 fire되는 SDK에서 오작동(cmux의 busy 4×/턴). `Set<string>` 기반 전이 감지가 정석.

### 교훈 2 — "CLI가 source 필터를 지원하지 않으면 all-or-nothing tradeoff를 의식적으로 기록하라"

API가 세밀한 제어를 지원하지 않을 때 "완벽한 해결은 불가능하다"는 것을 인정하고, **어느 side effect를 수용할지** 명시적으로 결정해야 한다. 그 결정을 팀 기억에 남기지 않으면 다음 리뷰어가 "왜 전체 로그를 지우냐"고 되돌리는 회귀가 발생한다.

#### 적용 규칙

1. **tradeoff를 결정 순간 기록**. "A를 얻기 위해 B를 포기"가 명확한 의사결정이라면 `.nexus/memory/empirical-*.md`나 decision text에 근거와 함께 남긴다. 단순 주석만으로는 검색/추적이 약함.
2. **이진 선택 상황에서는 "사용자가 직접 진술한 선호"를 최우선 근거로 삼기**. 이 경우 "정상 상태(Running)로 돌아왔을 때 에러가 사라지는것"이 원 사용자 지시였으므로 turn-boundary unconditional clearing을 채택. 다른 플러그인의 로그가 함께 지워지는 부수 효과는 이 지시의 종속 비용.
3. **upstream 기능 요청 경로를 열어두기**. cmux CLI에 `--source` 필터가 추가되면 더 surgical한 clearing으로 이행 가능. 코드 주석에 이 향후 개선 가능성을 남겨 future reviewer가 재검토할 계기를 만든다.

### 교훈 3 — "`session.status busy`는 턴당 여러 번 fire되므로 raw event에 reset을 걸지 말고 전이를 감지하라"

이는 `empirical-cmux-pill-clear-paths.md` 경로 2의 연장선. OpenCode가 한 턴에 busy를 ~4회 fire한다는 empirical 사실이 이 설계에도 그대로 작용한다. raw busy에 clear-log를 걸면 턴 중 clear-log가 여러 번 호출되어 mid-turn에 retry warning(cmuxLog("warning", ...))이나 debug info가 함께 유실.

#### 적용 패턴

```ts
const sessionRunning = new Set<string>();

// Entry: idle→running 전이 감지
// session.status busy 핸들러 내부
if (rootSessions.has(sid) && !sessionRunning.has(sid)) {
  sessionRunning.add(sid);
  cmuxClearLog();  // 전이 순간에만 1회 호출
}
cmuxSetStatus(PILL_KEY, RUNNING_VALUE, RUNNING_ICON, PILL_COLOR);

// Exit: 모든 turn-end 이벤트에서 delete
// session.idle / session.status idle / session.error (abort + fatal) / session.deleted
sessionRunning.delete(sid);

// NON-EXIT: permission.replied는 mid-turn 재개이므로 delete 금지
```

핵심:
- `sessionRunning.add(sid)` **전에** `!sessionRunning.has(sid)` 체크 — 이미 Running 중인 세션의 반복 busy는 no-op이어야 함.
- `clear-log` 호출을 `set-status` **앞에** 두기 — cmuxSpawn 직렬화 큐가 plugin-issued 순서를 보장하므로, "로그 clear → pill Running" 순서로 cmux 서버에 도달.
- exit 경로에 `session.error`를 포함하는 것이 핵심. abort도 turn-end로 취급해야 "user aborts mid-turn → re-sends input → clear-log" 시퀀스가 성립. 이게 사용자가 원래 원했던 MessageAbortedError 청소 경로.

## 진단 방법

stuck error 증상이 의심되면:

```bash
cmux list-log --workspace workspace:<id>       # 어떤 에러가 남아있는지
cmux list-status --workspace workspace:<id>    # pill 상태 교차 검증
```

- log에 error 엔트리가 잔존하고 pill은 Running/Needs Input으로 정상이라면 **clear-log 경로 누락/미동작**.
- log에 잔존 에러가 있는데 **Running 전이가 있었는지**는 plugin 쪽 `sessionRunning` Set 상태로 판단. e2e harness에서 cmux-t/u/v/w 시나리오 재현으로 재연 가능.

e2e 회귀 스위트는 `scripts/e2e-nexus-integration.mjs`의 cmux shim 기반이며, 실 cmux 없이도 argv jsonl로 `clear-log` 호출 여부를 정밀 assert할 수 있다.

## 수정 사례 링크

- **v0.16.4 (2026-04-24)** — `cmuxClearLog()` helper 추가, `sessionRunning: Set<string>` 도입, `session.status busy`에서 idle→running 전이 시 `clear-log` 선행 호출. 5개 turn-end 이벤트(`session.idle` / `session.status idle` / `session.error` abort·fatal / `session.deleted`)에서 delete. `permission.replied`는 의도적으로 제외. e2e cmux-t(전이 positive), cmux-u(dedup 5회 busy), cmux-v(abort→resume), cmux-w(disabled + non-root negative regression) 4개 시나리오 신규.

## Anti-patterns

- **"에러 로그는 히스토리니까 그냥 남겨두자"** — 상태성 메시지(`error`/`warning`)를 영구 기록처럼 취급하면 "지금 에러 상태인가?" 판단이 불가능해진다. 로그의 **영속성 의도**를 구분하고, 짧은 수명의 메시지는 도메인 경계에서 reset.
- **"`session.status busy`에서 즉시 clear-log 호출"** — busy는 턴당 4회 fire. dedup 없이 호출하면 턴 중 retry warning과 debug info가 전부 유실. 반드시 전이 state machine으로 감쌈.
- **"`permission.replied`에서도 sessionRunning delete"** — permission 응답은 mid-turn 재개이지 새 턴 시작이 아님. 여기서 delete하면 다음 busy(권한 승인 직후 assistant 재개)에서 clear-log가 fire되어 사용자가 방금 본 로그를 잃는다.
- **"`--source` 필터 없으니 clear-log 자체를 포기"** — all-or-nothing 제약을 이유로 설계를 완전히 포기하면 원인 A(append-only stuck)가 영구화. tradeoff를 인정하고 도메인 경계 기반 설계로 우회.
- **"테스트 없이 state machine 추가"** — `sessionRunning` 같은 내부 state는 e2e에서 시나리오 4개(positive / dedup / exit edge / negative guard) 이상으로 가두지 않으면 미래 리팩토에서 조용히 회귀한다. cmux-t/u/v/w 패턴을 다른 state 추가 시에도 템플릿으로 재사용.
