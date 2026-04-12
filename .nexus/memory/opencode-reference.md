# OpenCode 플러그인 개발 완전 레퍼런스

> **목적**: 이 문서만 읽고 Claude Code를 사용하여 OpenCode 플러그인을 처음부터 만들 수 있어야 한다.
> **독자**: OpenCode 플러그인 개발을 시작하는 LLM 또는 개발자.

---

## 조사 메타데이터

- 조사일: 2026-04-12
- `@opencode-ai/plugin` 버전: 1.3.13
- `@opencode-ai/sdk` 버전: 1.3.13
- 증거 출처: 패키지 타입 정의, context7 문서 (`opencode.ai/docs/plugins`, `anomalyco/opencode`), `opencode-skills` 플러그인 소스, `opencode-nexus` `src/` 실증 코드, OpenCode GitHub 소스 분석 (`packages/opencode/src/session/prompt.ts`), npm 생태계 조사
- 생태계 규모: @opencode-ai/plugin에 736개 프로젝트 의존 (2026-04 기준)
- 최신 패키지 버전: @opencode-ai/plugin@1.4.13 (이 문서는 1.3.13 기준, 차이점 미확인)

---

## 1. Plugin API 계약

### 1.1 Plugin 타입

플러그인은 **비동기 함수**다. `PluginInput`을 받아 `Hooks` 객체를 반환한다.

```typescript
// 플러그인 함수 시그니처
type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>;

// 플러그인 모듈 — 두 가지 export 방식 모두 가능
// 방식 1: Plugin 함수를 직접 default export (opencode-nexus 실증 패턴)
// 방식 2: PluginModule 객체로 감싸서 export (타입 정의에만 존재, 실증 미검증)
type PluginModule = {
  id?: string;    // 선택적 플러그인 ID
  server: Plugin; // 플러그인 함수
  tui?: never;    // TUI 플러그인은 별도 (이 문서 범위 밖)
};
```

**최소 boilerplate:**

```typescript
import type { Plugin } from "@opencode-ai/plugin";

const MyPlugin: Plugin = async (ctx, options) => {
  // ctx: PluginInput — OpenCode가 주입하는 컨텍스트
  // options: opencode.json에서 전달한 옵션 객체
  return {};  // Hooks — 등록할 훅이 없으면 빈 객체
};

export default MyPlugin;
```

### 1.2 PluginInput

```typescript
type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>; // OpenCode SDK HTTP 클라이언트
  project: Project;      // 프로젝트 메타데이터
  directory: string;     // 프로젝트 루트 경로 (절대 경로)
  worktree: string;      // git 워크트리 루트 (절대 경로)
  serverUrl: URL;        // OpenCode 서버 URL (HTTP)
  $: BunShell;           // Bun 셸 template tag — 셸 명령 실행용
};
```

**`ctx.client` 사용 예:**

```typescript
// 앱 로그 기록
await ctx.client.app.log({
  body: { service: "my-plugin", level: "info", message: "initialized" }
});

// 세션에 메시지 삽입 (noReply: true — LLM 응답 없이 컨텍스트만 추가)
await ctx.client.session.prompt({
  path: { id: sessionID },
  body: {
    noReply: true,
    parts: [{ type: "text", text: "컨텍스트 내용" }],
  },
});
```

### 1.3 PluginOptions

`opencode.json`의 플러그인 설정에서 두 번째 배열 요소로 전달되는 `Record<string, unknown>`.

**opencode.json 등록 형식:**

```json
{
  "plugin": [
    "my-plugin"
  ]
}
```

```json
{
  "plugin": [
    ["my-plugin", { "key": "value", "debug": true }]
  ]
}
```

플러그인 함수의 두 번째 인자(`options`)로 전달된다. 타입이 `Record<string, unknown>`이므로 직접 타입 가드를 작성해야 한다.

---

## 2. Hooks 인터페이스 — 전체 목록

`Plugin` 함수가 반환하는 객체. 등록할 훅만 포함하면 된다.

```typescript
interface Hooks {
  // --- 이벤트 ---
  event?: (input: { event: Event }) => Promise<void>;

  // --- 설정 수정 ---
  config?: (input: Config) => Promise<void>;

  // --- 도구 등록 ---
  tool?: { [key: string]: ToolDefinition };

  // --- 인증 프로바이더 ---
  auth?: AuthHook;

  // --- 채팅 ---
  "chat.message"?: (input: {
    sessionID: string;
    agent?: string;
    model?: { providerID: string; modelID: string };
    messageID?: string;
    variant?: string;
  }, output: {
    message: UserMessage;
    parts: Part[];
  }) => Promise<void>;

  "chat.params"?: (input: {
    sessionID: string;
    agent: string;
    model: Model;
    provider: ProviderContext;
    message: UserMessage;
  }, output: {
    temperature: number;
    topP: number;
    topK: number;
    options: Record<string, any>;
  }) => Promise<void>;

  "chat.headers"?: (input: {
    sessionID: string;
    agent: string;
    model: Model;
    provider: ProviderContext;
    message: UserMessage;
  }, output: { headers: Record<string, string> }) => Promise<void>;

  // --- 권한 ---
  // 주의: 현재 미작동 (GitHub issue #7006, 2026-04 기준 미해결)
  "permission.ask"?: (input: Permission, output: {
    status: "ask" | "deny" | "allow";
  }) => Promise<void>;

  // --- 커맨드 ---
  "command.execute.before"?: (input: {
    command: string;
    sessionID: string;
    arguments: string;
  }, output: { parts: Part[] }) => Promise<void>;

  // --- 도구 실행 ---
  // 주의: 서브에이전트로 유출되는 버그 있음 (GitHub issue #5894, 2026-04 기준 미해결)
  "tool.execute.before"?: (input: {
    tool: string;
    sessionID: string;
    callID: string;
  }, output: { args: any }) => Promise<void>;

  "tool.execute.after"?: (input: {
    tool: string;
    sessionID: string;
    callID: string;
    args: any;
  }, output: { title: string; output: string; metadata: any }) => Promise<void>;

  "tool.definition"?: (input: { toolID: string }, output: {
    description: string;
    parameters: any;
  }) => Promise<void>;

  // --- 셸 ---
  "shell.env"?: (input: {
    cwd: string;
    sessionID?: string;
    callID?: string;
  }, output: { env: Record<string, string> }) => Promise<void>;

  // --- Experimental 훅 ---
  "experimental.chat.messages.transform"?: (input: {}, output: {
    messages: { info: Message; parts: Part[] }[];
  }) => Promise<void>;

  "experimental.chat.system.transform"?: (input: {
    sessionID?: string;
    model: Model;
  }, output: { system: string[] }) => Promise<void>;

  "experimental.session.compacting"?: (input: {
    sessionID: string;
  }, output: { context: string[]; prompt?: string }) => Promise<void>;

  "experimental.text.complete"?: (input: {
    sessionID: string;
    messageID: string;
    partID: string;
  }, output: { text: string }) => Promise<void>;
}
```

### 2.1 훅 호출 시점 요약

> **실증 검증 범위 주의:** opencode-nexus가 실제 사용하는 훅은 `event`, `tool.execute.before`, `tool.execute.after`, `chat.message`, `command.execute.before`, `experimental.session.compacting`, `experimental.chat.system.transform` 7개다. 나머지 훅(`chat.params`, `chat.headers`, `auth`, `tool.definition`, `shell.env`, `permission.ask`, `experimental.chat.messages.transform`, `experimental.text.complete`)은 타입 정의에서 확인되었으나 실증 코드로 교차 검증되지 않았다.

| 훅 | 호출 시점 | 용도 |
|---|---|---|
| `config` | 플러그인 초기화 직후 | opencode.json 설정 동적 수정 |
| `event` | OpenCode 이벤트 발생 시 | 이벤트 스트림 구독 |
| `tool` | (등록 시점에 정적으로 선언) | 커스텀 도구 등록 |
| `chat.message` | 사용자 메시지 수신 시 | 메시지 전처리 |
| `chat.params` | LLM 호출 직전 | temperature 등 파라미터 조정 |
| `chat.headers` | LLM HTTP 요청 직전 | 요청 헤더 추가 |
| `permission.ask` | 권한 요청 발생 시 (미작동, #7006) | 권한 자동 승인/거부 |
| `command.execute.before` | 슬래시 커맨드 실행 전 | 커맨드 인터셉트 |
| `tool.execute.before` | 도구 실행 전 (서브에이전트 유출 버그 #5894) | 도구 인자 수정 |
| `tool.execute.after` | 도구 실행 완료 후 | 실행 결과 후처리 |
| `tool.definition` | LLM에 도구 정의 전달 직전 | 도구 설명/파라미터 수정 |
| `shell.env` | 셸 명령 실행 직전 | 환경변수 주입 |
| `experimental.chat.system.transform` | 매 LLM 호출 전 (추정) | 시스템 프롬프트 수정 |
| `experimental.chat.messages.transform` | LLM 호출 전 (추정) | 메시지 히스토리 수정 |
| `experimental.session.compacting` | 세션 컴팩션 발생 시 | 컴팩션 컨텍스트 커스터마이징 |
| `experimental.text.complete` | 텍스트 완성 요청 시 | 자동완성 커스터마이징 |

### 2.2 시스템 프롬프트 합성 순서

OpenCode 소스 코드 (`packages/opencode/src/session/prompt.ts`, `llm.ts`) 기반. (출처: gist 분석, Strong)

1. 환경 블록 생성 (모델명, 디렉토리, 날짜)
2. 모델 ID 기반 provider prompt 선택 (`claude`→`anthropic.txt`, `gpt`→`beast.txt` 등)
3. 인스트럭션 파일 탐색/로드 (`opencode.json`의 `instructions` + `AGENTS.md`)
4. 도구 레지스트리 초기화
5. **`experimental.chat.system.transform` 훅 실행** — 플러그인이 `system[]` 배열 수정
6. Anthropic 프롬프트 캐싱 재구성
7. 모드 프래그먼트 조건부 삽입 (`plan.txt`, `build-switch.txt` 등)
8. `streamText()` 호출

**핵심 의미:** 플러그인의 `system.transform`은 5단계에서 실행된다. 인스트럭션(3단계) 이후, 프롬프트 캐싱(6단계) 이전이므로 최종 시스템 프롬프트에 영향을 줄 수 있다.

### 2.3 플러그인 로드 순서

플러그인은 다음 순서로 로드된다 (출처: 웹 조사, Strong):

1. global config의 plugin 배열
2. project config의 plugin 배열
3. global plugins 디렉토리
4. project plugins 디렉토리 (`.opencode/plugins/`)

### 2.4 알려진 훅 제한사항

| GitHub Issue | 훅 | 제한사항 |
|---|---|---|
| #17637 | `experimental.chat.system.transform` | 입력에 사용자 메시지 텍스트가 없음. 같은 턴에서 사용자 메시지 기반 컨텍스트 주입 불가 (1턴 지연) |
| #17412 | (전체) | 플러그인 훅만으로는 AI가 보는 대화 컨텍스트에 메시지 직접 주입 불가. 컨텍스트 압축 후 동작 망각률 극단적 (출처: issue #17412 코멘트, PR #19519). PR 57줄로 구현 완료되었으나 병합 여부 미확인 |

**미확인 항목:**
- 여러 플러그인의 훅 실행 순서 — 플러그인 등록 순서로 추정되나 미확인
- 훅에서 예외(`throw`) 발생 시 OpenCode 동작 — 에러 로깅 후 계속으로 추정되나 미확인

### 2.5 config 훅 패턴

`config` 훅은 `Config` 객체를 **mutation**으로 수정한다 (반환값 없음). opencode.json의 설정을 플러그인이 동적으로 보강하거나 초기화할 때 사용한다.

```typescript
// opencode-nexus 실증 코드 (src/create-config.ts)
export function createConfigHook() {
  return async (config: Record<string, unknown>): Promise<void> => {
    // 에이전트 추가
    const currentAgent = (config.agent as Record<string, unknown>) ?? {};
    config.agent = {
      ...currentAgent,
      "my-agent": {
        description: "My custom agent",
        mode: "subagent",
        model: "anthropic/claude-sonnet-4-20250514",
        prompt: "You are a specialized agent...",
      },
    };

    // 권한 설정 수정
    const permission = (config.permission as Record<string, unknown>) ?? {};
    config.permission = {
      "*": permission["*"] ?? "ask",
      ...permission,
    };

    // default_agent 변경
    if (!config.default_agent) {
      config.default_agent = "my-primary-agent";
    }
  };
}
```

**주의:** `config` 훅이 opencode.json을 deep merge하는지 replace하는지 공식 문서에서 확인되지 않음. 실증 코드 기준으로는 **mutation(in-place 수정)** 방식이 작동한다고 확인됨.

---

## 3. 도구(Tool) 시스템

### 3.1 tool() 헬퍼

```typescript
import { tool } from "@opencode-ai/plugin";

function tool<Args extends z.ZodRawShape>(input: {
  description: string;
  args: Args;
  execute(
    args: z.infer<z.ZodObject<Args>>,
    context: ToolContext
  ): Promise<string>;
}): ToolDefinition;

// tool.schema는 Zod 인스턴스
// tool.schema === z  →  true
```

**중요:** `tool()`은 **identity function**이다. 런타임에 아무 변환도 하지 않고 입력을 그대로 반환한다. 타입 추론을 위한 순수 타입 헬퍼다. (출처: 패키지 타입 정의 + `bun -e` 실험으로 확인)

### 3.2a 실험: z.array().default([]) 동작과 args 파싱

**실험일**: 2026-04-12. **환경**: @opencode-ai/plugin@1.3.13, Zod 4.1.8 (plugin 번들)

Zod 단독 파싱 테스트 (`bun -e`로 직접 실행):
```
schema.parse({})                          → { attendees: [], issues: [] }  ✅ 정상
schema.parse({ attendees: undefined })    → { attendees: [], issues: [] }  ✅ 정상
schema.parse({ attendees: [] })           → { attendees: [], issues: [] }  ✅ 정상
schema.parse({ attendees: null })         → THROWS invalid_type            ✅ 예상대로
```

**결론:** `z.array().default([])`는 Zod 파싱 시 정상 작동한다. 그런데 opencode-nexus에서 `(args.attendees ?? []).map is not a function` 에러가 발생했다는 것은, **OpenCode 런타임이 도구 args를 Zod schema로 파싱하지 않고 raw JSON을 직접 execute()에 전달할 수 있음**을 시사한다.

**근거:** `tool()`이 identity function이므로, args schema의 `.default()` 처리는 OpenCode 런타임의 책임이다. OpenCode가 LLM 응답에서 추출한 JSON을 Zod로 validate/transform하지 않으면 `.default([])` 가 적용되지 않는다.

**방어 전략:** args에 `.default()`를 사용하더라도, execute() 내부에서 `Array.isArray()` 가드를 추가하는 것이 안전하다. (opencode-nexus에서 실증 확인)

### 3.2 ToolContext

```typescript
type ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;       // 현재 에이전트 ID
  directory: string;   // 프로젝트 루트 경로
  worktree: string;    // git 워크트리 루트
  abort: AbortSignal;  // 취소 신호
  metadata(input: { title?: string; metadata?: Record<string, any> }): void;
  ask(input: AskInput): Promise<void>; // 사용자에게 권한 요청
};
```

### 3.3 도구 등록 예시

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

const z = tool.schema; // Zod 인스턴스

const greetTool = tool({
  description: "사용자에게 인사한다",
  args: {
    name: z.string().describe("인사할 이름"),
  },
  async execute({ name }, ctx) {
    ctx.metadata({ title: `${name}에게 인사` });
    return `안녕하세요, ${name}! (sessionID: ${ctx.sessionID})`;
  },
});

const MyPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      greet: greetTool,  // 도구 이름: "greet"
    },
  };
};

export default MyPlugin;
```

### 3.4 도구 우선순위

플러그인 도구와 OpenCode 빌트인 도구의 이름이 충돌할 경우 **플러그인 도구가 우선**한다. (출처: `opencode.ai/docs/plugins`)

---

## 4. 에이전트 시스템 (opencode.json)

### 4.1 에이전트 정의

```json
{
  "agent": {
    "build": {
      "mode": "primary",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "{file:./prompts/build.txt}",
      "tools": {
        "write": true,
        "edit": true,
        "bash": true
      }
    },
    "code-reviewer": {
      "description": "Reviews code for best practices",
      "mode": "subagent",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "You are a code reviewer...",
      "tools": {
        "write": false,
        "edit": false
      }
    }
  }
}
```

**에이전트 모드:**
- `primary`: 사용자와 직접 대화하는 메인 에이전트. 세션에 하나만 존재.
- `subagent`: 다른 에이전트(또는 플러그인)에 의해 호출됨.

**커스텀 프롬프트 파일 참조:**

```json
"prompt": "{file:./prompts/my-agent.txt}"
```

파일 경로는 `opencode.json` 기준 상대 경로다.

### 4.2 커맨드와 에이전트 연동

```json
{
  "command": {
    "review": { "agent": "code-reviewer" },
    "analyze": { "subtask": true }
  }
}
```

- `"agent": "code-reviewer"`: `/review` 커맨드 실행 시 `code-reviewer` 에이전트 사용
- `"subtask": true`: 강제로 서브에이전트로 실행

### 4.3 config 훅으로 에이전트 동적 등록

`opencode.json`을 직접 수정하지 않고 플러그인의 `config` 훅에서 에이전트를 프로그래매틱하게 추가할 수 있다 (→ §2.2 참조). `opencode-nexus`가 이 패턴을 사용한다.

---

## 5. 스킬 시스템

### 5.1 OpenCode 내장 스킬 시스템 (2026-04 기준)

OpenCode는 빌트인 스킬 시스템을 가지고 있다. (출처: 웹 조사, Strong — `opencode.ai/docs/skills`)

- 스킬 경로: `.opencode/skills/<name>/SKILL.md`
- Claude Code 호환 경로도 지원: `.claude/skills/` (의도적 호환)
- `skill({ name })` 빌트인 도구로 on-demand 로드
- 서브에이전트 디스패치: `@agent` 멘션 또는 primary agent가 task tool로 자동 호출

**참고:** 초기 OpenCode에는 이 기능이 없었으나, 이후 추가되었다. 서드파티 `opencode-skills` 플러그인은 이 내장 기능의 확장 구현이다.

### 5.2 opencode-skills 플러그인 (서드파티 확장)

`opencode-skills`는 Anthropic Agent Skills Specification을 구현한 서드파티 플러그인이다.

**스킬 파일 구조:**

```
.opencode/skills/
  my-skill/
    SKILL.md       # YAML frontmatter + Markdown body
```

**SKILL.md 형식:**

```markdown
---
name: my-skill
description: 이 스킬이 하는 일
---

# My Skill

스킬 본문 — LLM에 주입될 내용
```

**동작 방식:**
1. `.opencode/skills/{name}/SKILL.md` 파일을 자동 발견
2. 각 스킬을 `skills_{name}` 이름의 동적 도구로 등록
3. 도구 실행 시 스킬 내용을 현재 세션의 LLM 컨텍스트에 주입

### 5.3 메시지 삽입 패턴 (핵심)

스킬 또는 컨텍스트를 LLM에 주입하는 핵심 패턴:

```typescript
// ctx는 ToolContext
await ctx.client.session.prompt({
  path: { id: toolCtx.sessionID },
  body: {
    noReply: true,      // LLM 응답을 생성하지 않고 컨텍스트만 추가
    parts: [{ type: "text", text: skillContent }],
  },
});
```

`noReply: true`가 핵심이다. 이 플래그 없이 `session.prompt`를 호출하면 LLM이 메시지에 응답한다.

**주의:** `ctx.client`는 플러그인 초기화 시(`PluginInput.client`)에 받은 클라이언트다. 도구 실행 컨텍스트(`ToolContext`)에는 `client`가 없으므로 클로저로 캡처해야 한다:

```typescript
const MyPlugin: Plugin = async (ctx) => {
  const client = ctx.client; // 클로저로 캡처

  return {
    tool: {
      inject_context: tool({
        description: "컨텍스트를 주입한다",
        args: { content: tool.schema.string() },
        async execute({ content }, toolCtx) {
          await client.session.prompt({
            path: { id: toolCtx.sessionID },
            body: { noReply: true, parts: [{ type: "text", text: content }] },
          });
          return "컨텍스트가 주입되었습니다.";
        },
      }),
    },
  };
};
```

---

## 6. Claude Code와의 주요 차이점

| 항목 | Claude Code | OpenCode |
|---|---|---|
| 확장 메커니즘 | MCP 서버 + 커스텀 슬래시 커맨드 + CLAUDE.md | 플러그인 (`server` + `tui`) |
| 스킬 시스템 | 내장 (`skills/`, 슬래시 커맨드) | 내장 (`.opencode/skills/`, `.claude/skills/` 호환) + 서드파티 확장(`opencode-skills`) |
| 에이전트 정의 | 내부 하드코딩 또는 서브에이전트 API | `opencode.json` `agent` 키로 설정 |
| 시스템 프롬프트 | `CLAUDE.md` + 내부 빌더 | `instructions` + `AGENTS.md` + `experimental.chat.system.transform` 훅 |
| 런타임 | Node.js | Bun |
| 아키텍처 | CLI 단일 프로세스 | 클라이언트/서버 (HTTP API + SSE) |
| UI | TUI 내장 | TUI 플러그인 분리 (`tui` 필드) |
| 권한 모델 | 대화형 승인 (HITL) | `permission.ask` 훅 + HTTP API (`/permission/:id/reply`) |
| 플러그인 등록 | `CLAUDE.md` 또는 설정 파일 | `opencode.json`의 `plugin` 배열 |
| 도구 확장 | MCP 서버 | 플러그인 `tool` 훅 |

**중요한 아키텍처 차이:** OpenCode는 `opencode serve`로 HTTP 서버를 띄우고 클라이언트가 연결하는 구조다. 플러그인은 이 서버 프로세스 내에서 실행된다. 이로 인해 플러그인이 HTTP 클라이언트(`ctx.client`)를 통해 OpenCode API에 접근한다.

---

## 7. 알려진 플랫폼 버그 및 주의사항

아래 버그는 2026-04-12 시점 미해결 상태다. 작업 전 최신 상태를 확인할 것.

| GitHub Issue | 훅 | 증상 | 회피 방법 |
|---|---|---|---|
| #5894 | `tool.execute.before` | 훅이 서브에이전트 컨텍스트로 의도치 않게 전파됨 | 이 훅에 중요 로직을 추가하지 않는다. issue 해결 전까지 보류. |
| #7006 | `permission.ask` | 훅 등록은 성공하지만 권한 요청 시 핸들러가 호출되지 않음 | HTTP/SSE 경로(`/events` SSE + `POST /permission/:id/reply`) 사용 |

---

## 8. 미확인 항목과 추정

다음 항목은 공식 문서나 코드에서 확인되지 않았다. 추정으로 표시한 항목은 작동 방식이 변경될 수 있다.

| 항목 | 상태 | 추정 |
|---|---|---|
| `config` 훅의 merge 방식 | 미확인 | mutation(in-place 수정)으로 추정. 실증 코드(`opencode-nexus`)에서 이 방식이 작동함. |
| `experimental.chat.system.transform` 호출 빈도 | 미확인 | 매 LLM 호출 전으로 추정 |
| 여러 플러그인의 훅 실행 순서 | 미확인 | 플러그인 등록 순서(`plugin` 배열 순서)로 추정 |
| 훅에서 `throw` 발생 시 OpenCode 동작 | 미확인 | 에러 로깅 후 계속으로 추정 |
| `ctx.client` API 전체 범위 | 부분 확인 | `@opencode-ai/sdk` 타입 정의에서 추가 조사 필요 |

---

## 9. 실용 가이드: 새 플러그인 만들기

### 9.1 프로젝트 초기화

```bash
# Bun 프로젝트 (OpenCode 런타임은 Bun)
bun init -y
bun add -d @opencode-ai/plugin @opencode-ai/sdk
```

**package.json:**

```json
{
  "name": "my-opencode-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target bun"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^1.3.13",
    "@opencode-ai/sdk": "^1.3.13"
  }
}
```

**tsconfig.json:**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

### 9.2 최소 플러그인 (src/index.ts)

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

const MyPlugin: Plugin = async (ctx, options) => {
  // 초기화 로그
  await ctx.client.app.log({
    body: {
      service: "my-plugin",
      level: "info",
      message: `plugin initialized at ${ctx.directory}`,
    },
  });

  const client = ctx.client; // 클로저 캡처

  return {
    // 도구 등록
    tool: {
      my_tool: tool({
        description: "플러그인 도구 예시",
        args: {
          input: z.string().describe("입력값"),
        },
        async execute({ input }, toolCtx) {
          toolCtx.metadata({ title: "My Tool 실행" });
          return `처리 완료: ${input}`;
        },
      }),
    },

    // 시스템 프롬프트 추가 (experimental)
    "experimental.chat.system.transform": async (input, output) => {
      output.system.push("추가 시스템 프롬프트 내용");
    },

    // 셸 환경변수 주입
    "shell.env": async (input, output) => {
      output.env["MY_PLUGIN_DIR"] = ctx.directory;
    },
  };
};

export default MyPlugin;
```

### 9.3 opencode.json에 플러그인 등록

```json
{
  "plugin": [
    "./path/to/my-plugin/dist/index.js"
  ]
}
```

로컬 개발 시 빌드된 파일 경로를 직접 지정한다. npm 패키지는 패키지 이름으로 등록 가능하다.

### 9.4 흔한 함정

**함정 1: `ctx.client`를 클로저로 캡처하지 않음**

도구 실행 컨텍스트(`ToolContext`)에는 `client`가 없다. 플러그인 초기화 시 `ctx.client`를 클로저로 캡처해야 한다.

```typescript
// 잘못된 예 — toolCtx에는 client가 없다
async execute(args, toolCtx) {
  await toolCtx.client.session.prompt(...); // 오류
}

// 올바른 예 — 플러그인 스코프에서 캡처
const MyPlugin: Plugin = async (ctx) => {
  const client = ctx.client;
  return {
    tool: {
      my_tool: tool({
        async execute(args, toolCtx) {
          await client.session.prompt(...); // 정상
        },
      }),
    },
  };
};
```

**함정 2: `tool()`이 변환한다고 가정**

`tool()`은 타입 헬퍼일 뿐, 런타임에 아무것도 하지 않는다. 직접 객체를 반환해도 동일하다. 타입 추론을 위해 사용하는 것이다.

**함정 3: `permission.ask` 훅 의존**

이 훅은 현재 미작동 상태다(#7006). 권한 처리 로직을 이 훅에 의존하게 구현하면 권한 처리가 완전히 작동하지 않는다.

**함정 4: `tool.execute.before` 훅에 중요 로직 추가**

서브에이전트로 유출되는 버그(#5894)가 있다. 이 훅은 예상치 못한 컨텍스트에서 호출될 수 있다.

**함정 5: `config` 훅에서 기존 설정을 덮어씀**

`config` 훅은 mutation 방식이므로, 기존 설정을 읽어서 확장해야 한다. 그냥 `config.agent = { ... }`를 쓰면 opencode.json에 이미 정의된 에이전트가 사라진다.

```typescript
// 잘못된 예 — 기존 에이전트를 덮어씀
config.agent = { "my-agent": { ... } };

// 올바른 예 — 기존 설정을 보존하며 병합
const existing = (config.agent as Record<string, unknown>) ?? {};
config.agent = { ...existing, "my-agent": { ... } };
```

**함정 6: default export 누락**

OpenCode는 플러그인 파일의 `default export`를 로드한다. named export만 있으면 플러그인이 로드되지 않는다.

```typescript
// 잘못된 예
export const MyPlugin: Plugin = async (ctx) => { ... };

// 올바른 예
export default MyPlugin;
```

---

## 10. 주요 OpenCode 플러그인 사례

| 플러그인 | 핵심 패턴 | 참고 |
|---|---|---|
| `opencode-skills` | 스킬 자동 발견 + `session.prompt({ noReply })` 패턴 | Anthropic Skills Spec 구현 |
| `opencode-agent-identity` | `experimental.chat.system.transform`으로 에이전트 정체성 주입 | 시스템 프롬프트 확장 패턴 |
| `opencode-agent-memory` | system transform + session 이벤트로 메모리 블록 유지 | 상태 지속 패턴 |
| `oh-my-opencode` | 전문 서브에이전트 + LSP/AST/MCP 도구 내장 | 대형 플러그인 참고 |
| `micode` | 서브에이전트 오케스트레이션 + git worktree 격리 | 오케스트레이션 패턴 |
| `opencode-froggy` | Claude Code 스타일 hooks 구현 | 크로스 플랫폼 패턴 |
| `opencode-pty` | 대화형 pseudo-terminal 관리 | 백그라운드 프로세스 |
| `opencode-cmux` | cmux 터미널 멀티플렉서 통합 | 서브에이전트 세션 분리 |

---

## 참고 레퍼런스

- 공식 문서: `https://opencode.ai/docs/plugins`, `https://opencode.ai/docs/skills`, `https://opencode.ai/docs/agents`
- OpenCode 소스: `https://github.com/opencode-ai/opencode` (미러: `anomalyco/opencode`)
- SDK 타입 정의: `@opencode-ai/plugin`, `@opencode-ai/sdk` (npm)
- opencode-skills 소스: `malhashemi/opencode-skills` (GitHub)
- 실증 구현: `opencode-nexus/src/` (이 레포지토리)
- 알려진 버그: GitHub issue #5894, #7006, #17412, #17637

---

*작성: 2026-04-12~13. 버전 기준: @opencode-ai/plugin@1.3.13 (최신 1.4.13), @opencode-ai/sdk@1.3.13. API 변경 시 이 문서를 함께 업데이트할 것. 실험 결과 포함 (Zod default 동작, tool() identity, config mutation).*
