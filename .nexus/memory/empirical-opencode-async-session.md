<!-- tags: opencode, sdk, session, async, empirical -->
# Empirical: OpenCode async child session API + plugin event hook

## 0. 판정 요약

- 대상: `@opencode-ai/sdk` / `opencode` `1.14.21`.
- 로컬 프로젝트: `/Users/kih/workspaces/areas/opencode-nexus`.
- 검증일: 2026-04-24.
- 목적: Phase 1 A-MVP의 `nexus_spawn` / `nexus_result` / plugin event hook 설계가 primary unblock을 제공하는지 확인.
- 결론: A-MVP 진입은 가능하다.
- 단, `promptAsync`는 idle wake 보장이 약하므로 Task 2는 child를 생성한 직후 즉시 prompt하는 패턴과 event 기반 결과 수집을 우선해야 한다.
- 핵심 unblock A: plugin 또는 SDK client는 child session의 `session.idle`, `session.deleted`, `message.part.updated`를 root와 같은 event signature로 관찰할 수 있다.
- 핵심 unblock B: `session.create({ parentID })`는 child `Session.info.parentID`를 직접 남기고 `/children`에서도 조회된다.
- 핵심 제약 C: parent session에 결과를 조용히 주입하는 upstream primitive는 없다. 이 부분은 기존 Plan 결정대로 범위 밖이며 post-sync 치환/별도 result 도구로 해결해야 한다.
- 치명 BLOCKER: 없음.

---

## 1. 검증 방법

### 1.1 실행 환경

- OS: macOS Darwin, 로컬 workspace `/Users/kih/workspaces/areas/opencode-nexus`.
- `opencode` binary 확인: `/opt/homebrew/bin/opencode`.
- `opencode --version`: `1.14.21`.
- `bun install` 수행: dependency는 이미 충족되어 no changes.
- 설치 SDK: `node_modules/@opencode-ai/sdk/package.json` version `1.14.21`.
- 설치 plugin package: `node_modules/@opencode-ai/plugin` present.

### 1.2 실제 실행 검증

- `@opencode-ai/sdk/dist/index.js`의 `createOpencode()`로 local `opencode serve`를 기동했다.
- 임시 directory를 만들고 `session.create`, `session.children`, `session.promptAsync`, `session.messages`, `session.delete`를 호출했다.
- event stream은 `client.event.subscribe({ query: { directory } })`로 구독했다.
- `client.global.event()`도 확인했으나 global stream은 `{ payload }` envelope를 포함한다.
- plugin hook 자체를 별도 package로 live-load하지는 않았다.
- 대신 upstream plugin service가 bus `subscribeAll()` 결과를 `hook.event({ event })`로 그대로 전달하는 소스를 확인했다.
- 따라서 event endpoint live 결과와 plugin event hook source를 결합해 hook 관찰 가능성을 판단했다.

### 1.3 static source 확인

- npm installed type source:
  - `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`.
  - `node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts`.
  - `node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.js`.
  - `node_modules/@opencode-ai/plugin/dist/index.d.ts`.
- upstream source, tag `v1.14.21`:
  - `packages/opencode/src/server/routes/instance/session.ts`.
  - `packages/opencode/src/session/session.ts`.
  - `packages/opencode/src/session/prompt.ts`.
  - `packages/opencode/src/session/run-state.ts`.
  - `packages/opencode/src/session/status.ts`.
  - `packages/opencode/src/plugin/index.ts`.
  - `packages/opencode/src/tool/task.ts`.

### 1.4 issue 조사

- `gh issue view`로 다음 upstream issue 본문과 comment를 확인했다.
- `https://github.com/anomalyco/opencode/issues/21524`.
- `https://github.com/anomalyco/opencode/issues/21176`.
- `https://github.com/anomalyco/opencode/issues/20460`.
- `https://github.com/anomalyco/opencode/issues/17691`.
- `https://github.com/anomalyco/opencode/issues/16102`.
- `https://github.com/anomalyco/opencode/issues/17412`.

### 1.5 신뢰도 구분

- `CONFIRMED-live`: 로컬 `opencode 1.14.21`에서 직접 관측.
- `CONFIRMED-source`: installed SDK types 또는 upstream source에서 확인.
- `CONFIRMED-issue`: upstream issue 본문/댓글에서 확인.
- `UNKNOWN`: 이번 검증에서 직접 재현하지 못함.
- `INFERRED`: source 구조상 성립하지만 live plugin package까지 end-to-end 로드하지는 않음.

---

## 2. API별 확인 동작 / 보장

### 2.1 `session.create({ parentID })` — request shape

- Status: `CONFIRMED-source`, `CONFIRMED-live`.
- SDK method: `client.session.create(options)`.
- SDK type source: `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`.
- Type lines: `SessionCreateData.body.parentID?: string`, `title?: string`.
- Type lines: `SessionCreateData.url: "/session"`.
- Response type: `SessionCreateResponses[200] = Session`.
- Upstream route: `packages/opencode/src/server/routes/instance/session.ts`.
- Route operationId: `session.create`.
- Route validates JSON with `Session.CreateInput`.
- Route delegates to `SessionShare.Service.create(body)`.
- Source `packages/opencode/src/session/session.ts` defines `CreateInput` with `parentID` optional.
- Source `Session.Info` defines `parentID: SessionID.zod.optional()`.
- Source `fromRow()` maps `row.parent_id ?? undefined` to `info.parentID`.

### 2.2 `session.create({ parentID })` — return shape

- Status: `CONFIRMED-live`.
- Live parent create returned SDK `RequestResult` object with `data` field.
- Parent `data` fields observed:
  - `id` like `ses_...`.
  - `slug`.
  - `version: "1.14.21"`.
  - `projectID: "global"` in temp run.
  - `directory`.
  - `title`.
  - `time.created` and `time.updated`.
- Parent did not contain `parentID`.
- Child create returned the same shape plus `parentID` equal to parent `id`.
- Live child example shape:
  - `id: "ses_..."`.
  - `parentID: "ses_<parent>"`.
  - `title: "child"`.
  - `version: "1.14.21"`.
- SDK wrapper returned `{ data, request, response }`, not bare `Session`, when using generated client default.
- A-MVP code should read `result.data`, not assume direct return value.

### 2.3 parentID relation 표현

- Status: `CONFIRMED-source`, `CONFIRMED-live`.
- Relation is stored on the child session as `Session.info.parentID`.
- Parent has no `children` array embedded in the session object.
- Child lookup route exists: `GET /session/{id}/children`.
- SDK method: `client.session.children({ path: { id } })`.
- SDK response type: `SessionChildrenResponses[200] = Array<Session>`.
- Live `/children` call on parent returned an array containing the child session.
- Deleting a parent recursively deleted the child first.
- Source `Session.remove()` calls `children(sessionID)` and recursively `remove(child.id)`.
- Gotcha: creating without `parentID` creates a root session.
- Source title default confirms this: `createDefaultTitle(!!input.parentID)`.
- Root default prefix is `New session - ...`.
- Child default prefix is `Child session - ...`.

### 2.4 `session.promptAsync({ sessionID, text })` — actual SDK shape

- Status: `CONFIRMED-source`, `CONFIRMED-live`.
- SDK method name: `client.session.promptAsync`.
- SDK path: `POST /session/{id}/prompt_async`.
- SDK generated method source: `node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.js` lines around `promptAsync()`.
- The SDK does not accept a top-level `text` field in generated types.
- It accepts `body.parts: Array<TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput>`.
- Text prompt form is `body: { parts: [{ type: "text", text: "..." }] }`.
- `body.noReply?: boolean` is available.
- `body.agent`, `body.model`, `body.system`, `body.tools`, `body.messageID` are also available.
- A-MVP can expose `text` at nexus tool level, but must translate to `parts` before SDK call.

### 2.5 `session.promptAsync` — return status

- Status: `CONFIRMED-source`, `CONFIRMED-live`.
- SDK response type: `SessionPromptAsyncResponses[204] = void`.
- Route source `session.ts` returns `c.body(null, 204)` immediately.
- Live SDK result was `{ data: {}, request, response }`.
- No assistant result is returned from `promptAsync`.
- Result collection must be event/message based, not return-value based.

### 2.6 `session.promptAsync` — implementation behavior

- Status: `CONFIRMED-source`.
- Route source: `packages/opencode/src/server/routes/instance/session.ts`.
- The route starts `runRequest("SessionRoutes.prompt_async", ..., svc.prompt(...))` without awaiting it.
- Errors are caught and published as `Session.Event.Error`.
- Then route returns 204.
- The actual work path is the same `SessionPrompt.Service.prompt()` used by synchronous `session.prompt`.
- `SessionPrompt.prompt()` creates a user message, touches the session, and if `noReply !== true`, calls `loop()`.
- `noReply: true` creates user message parts but does not run assistant loop.
- `noReply: false` or absent attempts assistant processing via `loop()`.

### 2.7 `session.promptAsync` — idle session behavior

- Status: `CONFIRMED-live`, with caveat from `CONFIRMED-issue`.
- Live local run on a newly created child session with `noReply:false` returned 204.
- The child emitted `message.updated` for the user message.
- The child emitted `message.part.updated` for the text part.
- The child emitted `session.status` busy.
- The child emitted assistant `message.updated` and text output.
- The child emitted `session.status` idle and `session.idle` after completion.
- This proves idle wake can work in at least one local case on 1.14.21.
- However upstream issue `#21524` reports it does not reliably wake idle sessions.
- `#21524` says HTTP 204 can be returned while no assistant turn is generated.
- Therefore the guarantee is not absolute.
- A-MVP must treat idle wake as best-effort and detect completion via events/timeouts.

### 2.8 `session.promptAsync` — running session behavior

- Status: `CONFIRMED-issue`, `CONFIRMED-source`, not fully live-reproduced.
- Issue `#21524` body says `prompt_async` works when target session is actively working, specifically `mid-tool-call`.
- Same issue reports failure when target is idle.
- Source `SessionRunState.ensureRunning()` returns an existing runner when present.
- Runner semantics are upstream internal; this memo did not fully inspect `Runner.make`.
- Source `prompt.ts` has logic that sees user messages after the last finished assistant and wraps them as `<system-reminder>` on later steps.
- This supports queued-message handling during continued loops.
- `mid-generation` exact behavior was not live-reproduced.
- `mid-tool-call` exact behavior was not live-reproduced in this memo.
- Treat running-session prompt injection as useful but not a hard contract beyond issue/source evidence.

### 2.9 `event` hook — signature

- Status: `CONFIRMED-source`.
- Plugin type source: `node_modules/@opencode-ai/plugin/dist/index.d.ts`.
- Hook signature: `event?: (input: { event: Event }) => Promise<void>`.
- Event type imported from `@opencode-ai/sdk`.
- Upstream plugin service source: `packages/opencode/src/plugin/index.ts`.
- Source subscribes to bus via `bus.subscribeAll()`.
- For each bus input it calls `hook["event"]?.({ event: input as any })`.
- No root/child filtering is present in plugin event dispatch.
- Therefore child events use the same hook path as root events.

### 2.10 `event` hook — `session.idle`

- Status: `CONFIRMED-source`, `CONFIRMED-live via event endpoint`, `INFERRED for plugin hook delivery`.
- SDK type: `EventSessionIdle` is `{ type: "session.idle", properties: { sessionID: string } }`.
- Source `packages/opencode/src/session/status.ts` defines `Event.Idle` exactly with `sessionID` only.
- Source `SessionStatus.set()` publishes `session.idle` when status type is idle.
- Live event endpoint observed child event:
  - `type: "session.idle"`.
  - `properties.sessionID` equal to child id.
- There is no `parentID` in `session.idle` properties.
- To map idle child to parent, plugin must maintain session metadata map from `session.created` or query `session.get`.

### 2.11 `event` hook — `session.deleted`

- Status: `CONFIRMED-source`, `CONFIRMED-live via event endpoint`, `INFERRED for plugin hook delivery`.
- SDK type: `EventSessionDeleted` is `{ type: "session.deleted", properties: { info: Session } }` in installed d.ts.
- Live event endpoint included both `properties.sessionID` and `properties.info`.
- Child delete event included `properties.info.parentID`.
- Parent recursive delete emitted child `session.deleted` before parent `session.deleted`.
- This is useful for cleanup of child tracking tables.
- Gotcha: source `Session.remove()` catches and logs errors, so delete cleanup should be idempotent.

### 2.12 `message.part.updated`

- Status: `CONFIRMED-source`, `CONFIRMED-live via event endpoint`, `INFERRED for plugin hook delivery`.
- SDK type: `EventMessagePartUpdated` is `{ type: "message.part.updated", properties: { part: Part, delta?: string } }`.
- Live event endpoint included `properties.sessionID`, `properties.part`, and `properties.time`.
- The child user text part event had `part.sessionID` equal to child id.
- Assistant text, step-start, step-finish part updates also had child `sessionID`.
- No root/child signature split was observed.
- Event consumers should rely on `properties.part.sessionID` and/or `properties.sessionID`.
- `delta` is optional; full part updates may arrive without `delta`.
- For result aggregation, final assistant text can be reconstructed from latest text part state or by `session.messages` after idle.

---

## 3. 알려진 제약 / 버그 재확인

### 3.1 `#21524` — prompt_async does not wake idle sessions

- URL: `https://github.com/anomalyco/opencode/issues/21524`.
- State at verification: OPEN.
- Issue title: `prompt_async does not wake idle sessions (noReply: false returns 204 but no assistant turn)`.
- Reported version in issue: OpenCode `v1.3.17`.
- Body says `POST /session/{sessionID}/prompt_async` with `noReply:false` returns 204.
- Body says injected message appears in history after manual interaction.
- Body says orchestration loop sometimes does not engage while idle.
- Body says behavior is intermittent, likely race in session state machine.
- Body says it works when target is actively working, `mid-tool-call`.
- Comment reports `finish:"stop" -> promptAsync second turn -> session.idle -> no parent message.updated` race.
- Local 1.14.21 run did wake idle once, so this is not a universal failure.
- Because upstream issue is open, A-MVP should not assume reliable idle wake.
- Mitigation: spawn fresh child and prompt immediately.
- Mitigation: track `session.status`, `session.idle`, `message.updated`, and timeout.
- Mitigation: if promptAsync returns 204 but no `message.updated` assistant appears, surface recoverable error.

### 3.2 Running session / mid-tool-call / mid-generation

- `mid-tool-call`: issue `#21524` explicitly says this path works in the reporter's multi-agent system.
- `mid-generation`: not directly confirmed by this memo.
- Source suggests prompts become additional user messages in the same session history.
- Source wraps later user text into `<system-reminder>` when `step > 1 && lastFinished`.
- This indicates queued messages can affect subsequent loop iterations.
- It does not prove true mid-stream LLM interruption.
- A-MVP does not need true mid-generation steering.
- A-MVP should avoid claiming `/btw`-style behavior.

### 3.3 `#21176` — session.abort cooperative-only

- URL: `https://github.com/anomalyco/opencode/issues/21176`.
- State at verification: OPEN.
- Issue title: `[FEATURE] Add force-kill API for subagent session termination`.
- Body says current `client.session.abort()` only sends a cooperative abort signal.
- Body says it can fail when subagent is blocked waiting for LLM API response.
- Body says it can fail in infinite tool-call loops or stuck network I/O.
- Body says no force-kill mechanism exists in SDK.
- Source confirms SDK endpoint is `POST /session/{id}/abort` returning boolean.
- Source `SessionRoutes.abort` calls `SessionPrompt.Service.cancel(sessionID)`.
- Source `SessionPrompt.cancel` calls `state.cancel(sessionID)`.
- Source `SessionRunState.cancel` cancels existing runner if busy, otherwise sets idle.
- No force parameter exists in SDK types.
- A-MVP implication: timeout/cancel must be best-effort.
- A-MVP should mark timed-out child as failed in Nexus state even if OpenCode session remains alive.
- Cleanup should be idempotent and may need later `session.delete`.

### 3.4 `#20460` — parent notification consumes LLM turn

- URL: `https://github.com/anomalyco/opencode/issues/20460`.
- State at verification: OPEN.
- Issue title: `[FEATURE]: Silent result collection for background tasks to avoid consuming LLM turns`.
- Body says background task notifications currently wake main agent's LLM.
- Body asks for silent mode, batched notifications, or attach-to-next-turn.
- This confirms no upstream silent parent result primitive is guaranteed today.
- A-MVP implication: do not rely on parent LLM notification as a free channel.
- Use plugin-side state plus explicit `nexus_result` retrieval.
- If parent must be notified via prompt, count it as an LLM turn and make it optional.

### 3.5 `#17691` and `#16102` — mid-task injection gap

- URLs:
  - `https://github.com/anomalyco/opencode/issues/17691`.
  - `https://github.com/anomalyco/opencode/issues/16102`.
- Both are OPEN feature requests.
- They ask for `/btw` or queue-drain injection between tool-call iterations.
- They confirm OpenCode lacks a first-class side channel for non-interrupting mid-task context injection.
- Source has some queued-message handling, but issue status says desired UX is not solved as a stable feature.
- A-MVP implication: `nexus_spawn` should not promise real-time child steering beyond regular prompts.
- A-MVP can still spawn child work and collect terminal result.

### 3.6 `#17412` — plugin hooks cannot inject AI-visible messages

- URL: `https://github.com/anomalyco/opencode/issues/17412`.
- State at verification: OPEN.
- Issue title: `[FEATURE]: Plugin hooks should be able to inject AI-visible messages into conversation context`.
- Body says hooks can intercept/modify tool calls but cannot inject messages into AI conversation context.
- Body specifically mentions `session.idle` is fire-and-forget.
- This confirms event hook is observational, not a continuation primitive.
- A-MVP implication: plugin event hook can observe child completion, but cannot directly make parent continue with injected result.
- Use `nexus_result` or post-sync replacement rather than hook injection.

---

## 4. A-MVP 구현 gotcha

### 4.1 SDK return wrapper

- Generated SDK methods return request result wrappers.
- Use `const res = await client.session.create(...); const session = res.data`.
- `promptAsync` returns `data: {}` for 204 in live SDK, not meaningful content.
- Do not block waiting for `promptAsync` response body.

### 4.2 Tool API should translate `text` to `parts`

- User-facing `nexus_spawn({ text })` can be ergonomic.
- SDK call must send `body.parts = [{ type: "text", text }]`.
- If passing files/agents later, use SDK `PartInput` union.

### 4.3 Always pass `parentID`

- `session.create({ body: { parentID } })` is required for child relation.
- Without `parentID`, OpenCode creates a root session.
- Root sessions will not appear under `session.children(parent)`.
- Root sessions will also lack `info.parentID` in created/deleted events.

### 4.4 Track child metadata on create

- `session.idle` only has `sessionID`.
- It does not include `parentID`.
- Maintain `childSessionID -> parentSessionID` from `session.created` or the create response.
- On plugin restart, rebuild by scanning sessions or reading persisted Nexus state.

### 4.5 Delete order

- Parent delete recursively deletes children.
- Live event order was child `session.deleted` then parent `session.deleted`.
- Cleanup must tolerate either explicit child deletion or parent cascade.
- Do not assume parent delete event means child events already processed unless event order is observed in same process.

### 4.6 Completion signal

- `session.idle` is useful as a terminal-ish signal.
- It does not include final result content.
- On idle, call `session.messages(childID)` and extract latest assistant text.
- Alternatively maintain `message.part.updated` accumulation.
- Safer A-MVP path: event marks child idle, then fetch messages once.

### 4.7 `message.part.updated` shape has extras in live endpoint

- Installed d.ts says `part` plus optional `delta`.
- Live event endpoint also included `sessionID` and `time`.
- Plugin hook gets bus events, so live shape may include these extra fields.
- Consumer should be tolerant: prefer `event.properties.part.sessionID`, fallback to `event.properties.sessionID`.

### 4.8 Idle wake is not a hard contract

- Local 1.14.21 idle wake succeeded once.
- Upstream `#21524` remains open and says wake can silently fail.
- A-MVP should include watchdog logic.
- Suggested watchdog: after spawn prompt, require either assistant `message.updated`, child busy status, or child idle within timeout.
- If only user message appears and no assistant turn appears, report child as stuck/wake-failed.

### 4.9 Abort is best-effort

- No force-kill API in SDK.
- Timeout handling must update Nexus state independently.
- Do not wait forever on child cleanup.
- Consider `session.delete` after marking failed, but treat deletion errors as non-fatal cleanup warnings.

### 4.10 Plugin event hook is observational

- `event` hook cannot inject visible messages into parent.
- It is enough for `nexus_result` state updates.
- It is not enough for automatic parent LLM continuation without consuming a turn.
- This matches Plan Issue 5: primary unblock A/B possible, C out of scope.

### 4.11 Built-in task tool reference

- Upstream `packages/opencode/src/tool/task.ts` uses `sessions.create({ parentID: ctx.sessionID, ... })`.
- It stores child id in tool metadata as `sessionId`.
- It prompts the child with `ops.prompt(...)` synchronously.
- This confirms parent-child sessions are an upstream-supported primitive.
- A-MVP differs by using async prompt and plugin-side result collection.

### 4.12 Event hook delivery source

- Upstream `packages/opencode/src/plugin/index.ts` subscribes to all bus events.
- It calls every plugin hook's `event` handler without filtering event type.
- No special casing exists for root vs child sessions.
- Therefore child `message.part.updated`, `session.idle`, and `session.deleted` should reach plugins if plugin is loaded.

---

## 5. BLOCKER 섹션

- BLOCKER: 없음.
- Reason: child session creation, parentID relation, child message/part events, child idle event, and child deleted event all have enough verified behavior for A-MVP.
- Non-blocking risk: `promptAsync` idle wake race from `#21524`.
- Non-blocking risk: `session.abort` is cooperative-only from `#21176`.
- Non-blocking risk: parent silent notification is not available from `#20460` / `#17412`.
- Required condition for Task 2: implement timeout/stuck detection around `promptAsync`.
- Required condition for Task 2: persist child mapping so `session.idle` can be associated with parent/task.
- Required condition for Task 2: do not depend on event hook injecting context into parent LLM.
- Required condition for Task 2: fetch or reconstruct final child result after idle.

---

## 6. Evidence excerpts

### 6.1 Live: create parent/child

- Command pattern: `createOpencode({ port: 0 })`, then `client.session.create(...)`.
- Parent returned `data.id`, `data.version`, `data.projectID`, `data.directory`, `data.title`, `data.time`.
- Child returned same fields plus `data.parentID` equal to parent id.
- `client.session.children({ path: { id: parent.id } })` returned array containing child.

### 6.2 Live: promptAsync noReply true

- Call: `client.session.promptAsync({ path:{ id: child.id }, body:{ noReply:true, parts:[{type:"text", text:"hello child"}] } })`.
- Return: SDK result with empty `data` for 204.
- Follow-up `session.messages(child)` returned one user message and one text part.
- No assistant loop is expected with `noReply:true`.

### 6.3 Live: promptAsync noReply false

- Call: same as above but `noReply:false`.
- Return: 204 immediately.
- Events observed for child:
  - `message.updated` user.
  - `message.part.updated` user text.
  - `session.status` busy.
  - `message.updated` assistant.
  - assistant `message.part.updated` text.
  - `message.part.updated` step-finish.
  - `session.status` idle.
  - `session.idle`.
- This proves successful idle wake in one local run.
- Upstream `#21524` prevents treating this as guaranteed.

### 6.4 Live: delete parent cascades child

- Call: `client.session.delete({ path:{ id: parent.id } })`.
- Events observed:
  - child `session.deleted` with `info.parentID`.
  - parent `session.deleted` without `parentID`.
- This is sufficient for cleanup watchers.

### 6.5 Source: event hook dispatch

- File: `packages/opencode/src/plugin/index.ts` at tag `v1.14.21`.
- Logic: `bus.subscribeAll()`.
- Logic: loop over hooks.
- Logic: `void hook["event"]?.({ event: input as any })`.
- Consequence: plugin event hook observes the same bus event object.

### 6.6 Source: session.idle

- File: `packages/opencode/src/session/status.ts`.
- `Event.Idle` type name: `session.idle`.
- Schema: `{ sessionID: SessionID.zod }`.
- `set()` publishes `session.idle` when status is idle.
- It then deletes session status from internal map.

### 6.7 Source: promptAsync route

- File: `packages/opencode/src/server/routes/instance/session.ts`.
- Route: `POST /:sessionID/prompt_async`.
- Description: creates/sends async message, starts session if needed, returns immediately.
- It calls `svc.prompt(...)` in detached `void runRequest(...).catch(...)`.
- It returns `c.body(null, 204)`.

### 6.8 Source: prompt implementation

- File: `packages/opencode/src/session/prompt.ts`.
- `prompt()` gets session, cleans revert, creates user message, touches session.
- If `input.noReply === true`, it returns the user message.
- Otherwise it calls `loop({ sessionID })`.
- `loop()` uses `state.ensureRunning(...)`.
- `runLoop()` sets `session.status` busy inside loop and eventually runner idle hook emits idle.

### 6.9 Source: parentID storage

- File: `packages/opencode/src/session/session.ts`.
- `Info` schema has optional `parentID`.
- `CreateInput` has optional `parentID`.
- `createNext()` stores `parentID: input.parentID`.
- `children(parentID)` queries `SessionTable.parent_id`.

### 6.10 Source: task tool precedent

- File: `packages/opencode/src/tool/task.ts`.
- New task session uses `sessions.create({ parentID: ctx.sessionID, title: ..., permission: ... })`.
- It passes `nextSession.id` to prompt ops.
- It returns `task_id: ${nextSession.id}` in output.
- This is direct precedent for parent-child subagent sessions.

---

## 7. A-MVP implementation recommendation

- `nexus_spawn` should call `session.create({ body: { parentID: currentSessionID, title } })`.
- Immediately call `session.promptAsync({ path:{ id: child.id }, body:{ noReply:false, parts:[{ type:"text", text: prompt }] } })`.
- Store task record: parent id, child id, created time, prompt hash/title, status `running` or `submitted`.
- Event hook should handle `message.part.updated` for child ids and update partial output cache.
- Event hook should handle `session.idle` for child ids and transition task to collect phase.
- On collect phase, call `session.messages(childID)` and extract final assistant text.
- Event hook should handle `session.deleted` to mark missing/cancelled if task not completed.
- Watchdog should mark wake-failed if no assistant message appears after configured timeout.
- Watchdog should mark timed-out if child never reaches idle.
- `nexus_result` should read plugin/Nexus state, not parent conversation messages.
- Do not auto-prompt parent unless explicitly configured because it consumes an LLM turn.

---

## 8. Acceptance verification for this memo

- File exists: `.nexus/memory/empirical-opencode-async-session.md`.
- Section 1 present: verification method.
- Section 2 present: API behavior and guarantees.
- Section 3 present: known constraints and bugs.
- Section 4 present: A-MVP gotchas.
- Section 5 present: BLOCKER section.
- Evidence includes installed file paths.
- Evidence includes upstream source paths.
- Evidence includes upstream issue URLs.
- Last line contains Task 2 gate judgment.

Next task gate: Task 2 (engineer A-MVP 구현) 진입 가능 — Yes + 조건: promptAsync idle wake watchdog, childID-parentID 매핑 persistence, idle 후 message fetch 기반 result collection 필수
