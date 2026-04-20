# Anti-patterns — opencode-nexus 영구 거절 목록

> Phase 1 plan session #1 (`.nexus/history.json`에 archive)에서 도출된 거절 목록 6개. Phase 1 완료 이후에도 별도 결정 없이는 수행하지 않는다. 03-IMPLEMENTATION_GUIDE.md §2에서 추출.

---

## 1. ~~bridge 98KB 재작성 금지~~ — RESOLVED (2026-04-12)

`docs/bridge/nexus-core-bootstrap.md`는 nexus-core v0.2.0 출시 완료로 목적 달성. 의사결정 추적은 nexus-core 자체 CHANGELOG + .nexus/history.json에 보존됨. docs/ 디렉토리 전체 정리 시 삭제.

---

## 2. ACP vocabulary를 nexus-core에 편입 시도 금지

Agent Client Protocol(ACP) 관련 vocabulary, 태그, 또는 에이전트 정의를 nexus-core에 추가하려는 시도는 금지된다. ACP는 구독제 생태계 밖이며(`ecosystem-primer.md` §4.4), nexus-core는 구독제 호환 범위 내의 항목만 canonical하게 정의한다. 이 경계를 opencode-nexus에서 제안하거나 직접 변경해서는 안 된다.

---

## 3. tool.execute.before 훅의 서브에이전트 유출 금지

`tool.execute.before` 훅이 서브에이전트 컨텍스트로 의도치 않게 전파되는 OpenCode 버그가 있다(GitHub issue #5894, 2026-04 시점 미해결). `src/plugin/hooks.ts`에서 이 훅을 등록할 때 호출 범위를 명확히 제한해야 한다. 훅 로직이 서브에이전트로 유출되거나 nexus-code의 OpenCode adapter와 충돌하는 구현은 금지된다. issue #5894가 수정될 때까지 이 훅에 의존하는 중요 로직은 추가하지 않는다.

---

## 4. permission.ask 훅 의존 구현 금지

`permission.ask` 훅은 현재 OpenCode에서 작동하지 않음이 실험으로 확인되었다(GitHub issue #7006). 훅 등록 자체는 성공하지만 permission 요청 발생 시 핸들러가 호출되지 않는다. `src/plugin/hooks.ts`에 이 훅을 사용하는 코드를 추가하면 안 된다. 권한 처리가 필요한 경우 HTTP/SSE 경로(`opencode serve`의 `/events` SSE + `POST /permission/:id/reply`)를 사용하거나 issue #7006 해결 이후로 미룬다.

---

## §9.2 nexus-core runtime substrate 수용 (2026-04-20 revoke prior rule)

opencode-nexus는 nexus-core 0.15.1+ 이상이 canonical하게 정의한 runtime substrate surfaces를 수용한다:

1. **nexus-mcp stdio server** — 별도 프로세스 MCP 서버로 등록. opencode.json의 `mcp.nx = { type: "local", command: ["nexus-mcp"] }` canonical (opencode config schema의 `mcp` 키 사용, `mcp_servers` 아님).
2. **@moreih29/nexus-core/hooks/opencode-mount** — mountHooks(pluginCtx, manifest) 런타임 import 허용. opencode plugin 번들이 이 모듈을 직접 import.
3. **@moreih29/nexus-core/mcp** — MCP bin direct spawn 허용.
4. **nexus-core sync --harness=opencode** — managed paths 수용 (src/agents/*.ts, src/index.ts, .opencode/skills/**, opencode.json.fragment).

**의존성 승격**: @moreih29/nexus-core는 devDependencies에서 dependencies로 승격.

**검증 교체**: scripts/e2e-loader-smoke.mjs 폐기. scripts/e2e-nexus-integration.mjs가 nexus-core runtime integration 검증 (MCP handshake, mountHooks dispatch, sync idempotency, plugin module load).

**원 규칙 (archived)**: 2026-04-11 Phase 1 adoption 시점 "nexus-core = authoring only" 전제에서 작성. nexus-core 0.13.0부터 스스로 shared runtime substrate로 역할을 재정의함에 따라 무효.

---

## §9.3 opencode-specific 로직을 nexus-core에 push 금지 (2026-04-20 추가)

nexus-core는 cross-harness canonical만 담는다. OpenCode 고유 hook, tool, 또는 정책을 nexus-core에 추가하려는 시도는 금지된다. 이러한 로직은 opencode-nexus consumer 레벨에서만 구현하거나, 동일 기능이 2개 이상 harness에서 필요한 경우에만 nexus-core로 추상화를 제안할 수 있다.

---

## 6. opencode acp adapter를 opencode-nexus에서 작성 금지

OpenCode의 `opencode acp` stdio JSON-RPC 2.0 경로를 소비하는 adapter는 **nexus-code의 소유**다. opencode-nexus가 이 adapter를 구현하거나 prototype을 작성하는 것은 layer 경계 침범이다.

opencode-nexus는 OpenCode 플러그인 API를 통해 OpenCode **내부**에서 실행되며, 외부 supervisor 역할은 맡지 않는다. supervisor 패턴은 nexus-code(Supervision layer)의 책임이다.

---

## 7. `@opencode-ai/plugin`의 devDependency-only 선언 및 cache 수동 복사 금지

OpenCode 플러그인 SDK(`@opencode-ai/plugin`)는 반드시 `package.json`의 `dependencies`에 선언해야 하며, `devDependencies`에만 두거나 `~/.cache/opencode/packages/<pkg>/node_modules/` 내부에 수동으로 복사해서는 안 된다.

### 금지 패턴 A — devDependency-only 선언

`src/` 하위가 `import { tool } from "@opencode-ai/plugin"`로 value import를 하는데 `@opencode-ai/plugin`이 `devDependencies`에만 선언된 경우, npm publish된 tarball에서 SDK가 제외된다. OpenCode 본체(`packages/opencode/src/npm/index.ts`의 `Npm.add`)는 `@npmcli/arborist`를 `saveType: "prod"`로 실행하여 prod 의존성만 cache에 설치하므로, 런타임에 `Cannot find module '@opencode-ai/plugin'` 오류로 플러그인 로드가 실패한다.

**증거**: 2026-04-19 cycle #121, opencode-nexus@0.8.0에서 실제로 발생. 로그 `~/.local/share/opencode/log/2026-04-19T064156.log` line 34 참조.

### 금지 패턴 B — Cache에 SDK 수동 복사

플러그인 로드 실패를 workaround 하려고 `~/.cache/opencode/packages/<pkg>/node_modules/<pkg>/node_modules/@opencode-ai/plugin`에 `cp` 또는 `npm install`로 SDK 인스턴스를 따로 배치해서는 안 된다. OpenCode 본체가 이미 들고 있는 SDK 인스턴스와 **module identity가 다른 dual copy**가 되어, plugin host handshake 단계에서 hang이 발생한다 (SIGINT도 받지 않음).

**증거**: 2026-04-19 cycle #121, PID 65159 / 824 / 29010이 nexus-core 디렉터리에서 opencode 실행 시 internal plugin 로딩까지만 완료되고 `opencode-nexus` 로딩 단계에서 freeze. `plugin: []`로 되돌린 뒤에야 정상 기동 확인.

### 권장 선언 (생태계 convention)

```json
"dependencies": {
  "@opencode-ai/plugin": "1.4.7"
}
```

생태계 4개 플러그인 조사 결과 3개(OMO `oh-my-openagent`, `opencode-supermemory`, `opencode-gemini-auth`)가 이 패턴을 사용한다. 나머지 1개(`opencode-dynamic-context-pruning`)는 `peerDependencies` + `devDependencies` hybrid를 사용하지만, 본 리포에선 실증 검증 없이 채택하지 않는다.

### 검증

Release 직전에 `bun pm pack`으로 tarball을 만들고, 별도 디렉터리에서 실제 install + `import('opencode-nexus')` 성공을 확인한다. **단, 수동 `cp`로 SDK를 별도 배치하는 검증 경로는 모듈 identity를 깨므로 절대 사용하지 않는다.**

**근거**: Plan session #55 decision (cycle #121 archive), architect 리뷰, 생태계 조사(OMO 등 4개 플러그인 `package.json`), 실제 로그 및 프로세스 관찰.

---

## 항목 추가 시 규칙

- 새 anti-pattern은 plan session에서 결정된 후 추가
- 항목 번호는 추가 순서대로 (재정렬 금지 — 외부 문서가 번호로 참조 가능)
- 각 항목에 근거(experiment, issue, 또는 plan decision)를 명시
- 해소된 항목은 삭제하지 말고 "RESOLVED" 마커 + 해소 시점/방법을 추가
