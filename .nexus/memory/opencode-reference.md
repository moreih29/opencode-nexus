# OpenCode 플러그인 개발 완전 레퍼런스

> **목적**: 이 문서만 읽고 Claude Code를 사용하여 OpenCode 플러그인을 처음부터 만들 수 있어야 한다.
> **독자**: OpenCode 플러그인 개발을 시작하는 LLM 또는 개발자.

---

## 조사 메타데이터

- 조사일: 2026-04-12 (초판), 2026-04-13 (플러그인 배포 관점 보완 — §5.1, §5.1a, §7, §8, §9.5, §10 업데이트)
- `@opencode-ai/plugin` 버전: 1.3.13
- `@opencode-ai/sdk` 버전: 1.3.13
- 증거 출처: 패키지 타입 정의, context7 문서 (`opencode.ai/docs/plugins`, `anomalyco/opencode`), `opencode-skills` 플러그인 소스, `opencode-nexus` `src/` 실증 코드, OpenCode GitHub 소스 분석 (`packages/opencode/src/session/prompt.ts`), npm 생태계 조사, 공식 문서 재검증 (2026-04-13 `opencode.ai/docs/plugins` · `opencode.ai/docs/skills`), GitHub 이슈 조회 (#12222, #16608)
- 생태계 규모: @opencode-ai/plugin에 736개 프로젝트 의존 (2026-04 기준)
- 최신 패키지 버전: @opencode-ai/plugin@1.4.13 (이 문서는 1.3.13 기준, 차이점 미확인 — 특히 `Hooks.skill` 추가 주장 미검증, §5.1a 참조)

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

OpenCode는 빌트인 스킬 시스템을 가지고 있다. (출처: 공식 문서 `opencode.ai/docs/skills`, 재검증 2026-04-13, Strong)

**스킬 검색 경로 (6개, 상승 검색):**

| 범위 | 경로 |
|---|---|
| 프로젝트 로컬 | `.opencode/skills/<name>/SKILL.md` |
| 글로벌 | `~/.config/opencode/skills/<name>/SKILL.md` |
| Claude Code 호환 (로컬) | `.claude/skills/<name>/SKILL.md` |
| Claude Code 호환 (글로벌) | `~/.claude/skills/<name>/SKILL.md` |
| Agent 스킬 (로컬) | `.agents/skills/<name>/SKILL.md` |
| Agent 스킬 (글로벌) | `~/.agents/skills/<name>/SKILL.md` |

현재 작업 디렉토리(cwd)에서 git worktree 루트까지 상승하며 검색한다.

**로드 타이밍 (중요):**
- **on-demand 로드** — `skill({ name })` 빌트인 도구가 호출될 때만 해당 `SKILL.md` 전문을 LLM 컨텍스트에 로드 (Strong, `opencode.ai/docs/skills`)
- 서버 시작 시점 캐시나 매 turn 스캔이 아님. 도구 호출 시점에 파일시스템에서 읽는 것으로 추정 (Moderate — 공식 문서가 "loaded on-demand via the native skill tool"로만 표현하여 캐시 전략 세부사항은 미명시)
- 의미: **플러그인이 런타임에 SKILL.md를 사용자 프로젝트에 쓰더라도 같은 세션의 다음 `skill()` 도구 호출에서 발견될 가능성이 높다**

**SKILL.md YAML frontmatter:**
- 필수: `name` (1–64자, 소문자 영숫자, 단일 하이픈 구분자), `description` (1–1024자)
- 선택: `license`, `compatibility`, `metadata`

**서브에이전트 디스패치:** `@agent` 멘션 또는 primary agent가 task tool로 자동 호출.

**참고:** 초기 OpenCode에는 이 기능이 없었으나, 이후 추가되었다. 서드파티 `opencode-skills` 플러그인은 이 내장 기능의 확장 구현이다.

### 5.1a Hooks 인터페이스에 skill 필드가 있는가?

**결론: 없다 (2026-04-13 공식 문서 기준).** `opencode.ai/docs/plugins`의 Hooks 인터페이스 예시·설명 어디에서도 `skill` 필드를 언급하지 않는다. 이전 조사 세션에서 "PR #9010이 `skill` 필드를 Hooks에 추가"라는 언급이 있었으나, 해당 PR 번호·repo·포함 버전 모두 1차 근거로 확인되지 않았으며 공식 문서에서 뒷받침되지 않는다 → **루머 수준으로 격하**. 플러그인이 skill을 제공하려면 §9.5의 "리소스 파일 복사" 관행이나 §5.3의 "메시지 삽입 패턴"을 사용해야 한다.

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
| #12222 (anomalyco/opencode) | — (플러그인 로딩) | Desktop v21 이후 플러그인 로드 경로가 `~/.config/` → `~/.cache/`로 변경되어 **자기 패키지 내부 데이터 파일에 의존하는 플러그인이 깨짐** | 경로 의존은 `import.meta.url` 기반으로만 작성하고 실행 디렉토리 가정 금지. 리소스 파일은 초기화 시 사용자 프로젝트로 복사하여 사용 (§9.5 패턴) |
| #16608 (anomalyco/opencode) | — (플러그인 캐시) | `@latest` 또는 버전 미지정 플러그인은 이후 OpenCode 시작에서 auto-update되지 않음 (bun registry cache + stale isOutdated check) | 개발 중 최신 플러그인 필요 시 `~/.cache/opencode/node_modules/<pkg>/` 수동 삭제 |

---

## 8. 미확인 항목과 추정

다음 항목은 공식 문서나 코드에서 확인되지 않았다. 추정으로 표시한 항목은 작동 방식이 변경될 수 있다.

| 항목 | 상태 | 추정 |
|---|---|---|
| `config` 훅의 merge 방식 | 미확인 | mutation(in-place 수정)으로 추정. 실증 코드(`opencode-nexus`)에서 이 방식이 작동함. |
| `experimental.chat.system.transform` 호출 빈도 | 미확인 | 매 LLM 호출 전으로 추정 |
| 여러 플러그인의 훅 실행 순서 | 미확인 | 플러그인 등록 순서(`plugin` 배열 순서)로 추정 |
| 훅에서 `throw` 발생 시 OpenCode 동작 | 미확인 | 에러 로깅 후 계속으로 추정 |
| `skill()` 도구가 스킬 파일을 읽을 때 파일시스템 캐시 전략 | 미확인 | 매 호출 시 read로 추정 (Strong 근거: 공식 문서의 "on-demand" 표현). 단, OS 레벨 fs 캐시 또는 내부 메모리화 가능성 미확인 — 플러그인이 런타임에 SKILL.md를 쓰면 **같은 세션**에서 발견되는지 실증 검증 권고 |
| 플러그인 내부 리소스의 OpenCode 측 자동 인식 공식 API | 확인됨 (없음) | `Hooks` 인터페이스에 `skill/skills/instructions/resources/assets` 필드 없음. 플러그인이 자기 패키지 내부 파일을 사용자 `.opencode/skills/` 등으로 전달하려면 `fs.writeFile` 관행 사용 (§9.5) |
| PR #9010의 `Hooks.skill` 필드 주장 | 미확인 → 근거 없음 | 이전 세션에서 언급되었으나 공식 문서(`opencode.ai/docs/plugins`, 2026-04-13 기준)에 해당 필드 없음. PR 번호 자체의 진위 불명 — 루머로 처리 |
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

### 9.5 플러그인 배포 경로와 리소스 전달 (배포 관점)

플러그인 배포 경로, 사용자 프로젝트에서의 위치, 내부 리소스 파일(SKILL.md 같은 비코드 파일)이 사용자에게 전달되는 방식.

#### 9.5.1 배포 경로와 로드 순서

**등록 형식 (`opencode.json`):**

```json
{
  "plugin": [
    "opencode-helicone-session",            // npm 패키지 (이름만)
    "@my-org/custom-plugin",                // 스코프 npm 패키지
    ["./path/to/local-plugin/dist/index.js", { "debug": true }]  // 로컬 경로 + options
  ]
}
```
`opencode.json` 기준 상대 경로로 로컬 파일 지정 가능. 스코프/비스코프 npm 패키지 모두 지원.

**플러그인 로드 순서** (출처: 웹 조사, Strong):

1. global config의 plugin 배열
2. project config의 plugin 배열 (`opencode.json`)
3. global plugins 디렉토리 — `~/.config/opencode/plugins/`
4. project plugins 디렉토리 — `.opencode/plugins/`

4번(project plugins 디렉토리)의 파일은 `opencode.json`에 명시하지 않아도 자동 로드되는 것으로 추정 (opencode-nexus 실증: `.opencode/plugins/opencode-nexus.js`가 재-export shim만 담고 opencode.json `plugin` 배열에 등록되지 않아도 dogfooding 작동). 공식 문서에 "자동 로드" 명시는 확인 실패 — 실증 기반 Moderate.

#### 9.5.2 npm 설치 경로 (중요)

OpenCode는 플러그인을 시작 시 Bun으로 자동 설치한다. 설치 위치:

- **Desktop v21 이후 (2026-04 현재)**: `~/.cache/opencode/node_modules/<plugin-name>/` (Strong, issue #12222)
- **이전 버전**: `~/.config/opencode/node_modules/<plugin-name>/`

**경로 변경 이슈** (issue #12222): v21 desktop 업데이트로 로드 경로가 `~/.config/` → `~/.cache/`로 이동. 이로 인해 자기 패키지 내부 데이터 파일 경로에 의존하는 플러그인이 깨진 사례가 있음. 영향 회피는 §9.5.4 참고.

**캐시 stale 이슈** (issue #16608): `@latest` 또는 버전 미지정 플러그인은 OpenCode 재시작에서도 auto-update되지 않음. 개발 중 수동으로 `~/.cache/opencode/node_modules/<pkg>/` 삭제 필요.

#### 9.5.3 플러그인 내부 리소스 전달 (핵심 — 공식 API 없음)

**플러그인 npm 패키지가 비코드 리소스 파일(SKILL.md, 템플릿, 프롬프트 원문 등)을 사용자에게 자동 전달하는 공식 메커니즘은 현재 존재하지 않는다.** (2026-04-13 공식 문서 확인)

- `Hooks` 인터페이스에 `skills/instructions/resources/assets` 필드 없음
- OpenCode가 플러그인 `node_modules/<pkg>/` 내부 디렉토리를 skill/instruction 경로로 자동 스캔한다는 근거 없음
- OpenCode는 `.opencode/skills/`, `~/.config/opencode/skills/`, `.claude/skills/` 등 **사용자 프로젝트/글로벌 경로**만 스캔

**실제 관행 (실증 기반):**

| 패턴 | 설명 | 실증 |
|---|---|---|
| **A. 복사 관행** | 플러그인이 자기 패키지의 `templates/`, `skills/` 같은 디렉토리에 리소스를 포함 → 초기화/`config` 훅/커스텀 tool에서 `fs.writeFile`로 사용자 `.opencode/skills/` 등에 복사 | opencode-nexus `src/tools/setup.ts:148-163` `installEntrypointSkills` |
| **B. 메모리 주입 관행** | 플러그인이 런타임에 자기 패키지 내 파일을 읽어 `experimental.chat.system.transform` 또는 `session.prompt({noReply:true})`로 주입 (§5.3) | opencode-skills의 메시지 삽입 패턴 |
| **C. 사용자 수동 작성** | 플러그인은 `.opencode/skills/`를 스캔만, 사용자가 직접 SKILL.md 작성 | opencode-skills 기본 동작 |

A와 B는 조합 가능 (하이브리드). 둘 다 SKILL.md 본문의 canonical source는 플러그인 패키지 안에 유지하되 전달 채널만 다르다.

#### 9.5.4 플러그인 내부 파일 접근 패턴

`package.json`의 `files` 필드로 리소스 디렉토리를 npm 패키지에 포함:

```json
{
  "main": "dist/index.js",
  "files": ["dist", "templates", "skills"]
}
```

플러그인 코드에서 자기 패키지 내부 파일에 접근:

```typescript
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatePath = join(__dirname, "..", "templates", "skills", "nx-plan", "SKILL.md");
const body = await readFile(templatePath, "utf8");
```

**주의 (issue #12222):** 실행 디렉토리(`process.cwd()`)나 하드코딩된 절대 경로 금지. `import.meta.url` 기반 상대 경로만 안전. 번들링(`bun build`, `tsc`) 결과물에서 원본 디렉토리 구조가 유지되는지 빌드 설정 검증 필요.

#### 9.5.5 Dogfooding 패턴

플러그인 개발 시 자기 플러그인을 실제 사용자처럼 쓰는 방법:

**방법 A (권장) — 로컬 shim 재-export:**

```javascript
// .opencode/plugins/<plugin-name>.js
export { default, default as PluginExport } from "../../dist/index.js";
```

장점: `opencode.json`의 `plugin` 배열에 등록하지 않아도 자동 로드 (§9.5.1의 4번 경로). `bun run build` 후 바로 테스트 가능. npm publish 없이 실사용자 경로 시뮬레이션.

실증: opencode-nexus `.opencode/plugins/opencode-nexus.js` (1줄 shim) + 빌드된 `dist/index.js`.

**방법 B — opencode.json에 상대 경로 직접 등록:**

```json
{ "plugin": ["./dist/index.js"] }
```

**주의:** 로컬 shim(방법 A)과 npm 기반 배포(`"plugin": ["my-plugin"]`)를 동시에 쓰면 동일 플러그인이 중복 로드될 수 있음. 테스트 시 `opencode.json`에서 npm 엔트리 제거하거나 `.opencode/plugins/`를 비활성화.

---

## 10. 주요 OpenCode 플러그인 사례

| 플러그인 | 핵심 패턴 | 리소스 배포 방식 | 참고 |
|---|---|---|---|
| `opencode-skills` | 사용자 `.opencode/skills/` 스캔 → `session.prompt({ noReply })`로 스킬 본문 주입. 메시지 3개 삽입 패턴: (1) "Loading skill X" (2) SKILL.md 본문 (3) `Base directory for this skill: /path/to/.opencode/skills/<name>/` | **번들 미제공.** 사용자 수동 SKILL.md 작성 (§9.5.3 C) | Anthropic Skills Spec 구현. `malhashemi/opencode-skills` |
| `opencode-agent-identity` | `experimental.chat.system.transform`으로 에이전트 정체성 주입 | 미확인 | 시스템 프롬프트 확장 패턴 |
| `opencode-agent-memory` | system transform + session 이벤트로 메모리 블록 유지 | 미확인 | 상태 지속 패턴 |
| `oh-my-opencode` | 전문 서브에이전트 + LSP/AST/MCP 도구 내장. OMO 번들 MCP를 `~/.cache/opencode/` 하위에 저장 | **번들 리소스 있음** (MCPs) — 상세 미확인 | 대형 플러그인 참고. `code-yeongyu/oh-my-openagent` |
| `micode` | 서브에이전트 오케스트레이션 + git worktree 격리 | 미확인 | 오케스트레이션 패턴 |
| `opencode-froggy` | Claude Code 스타일 hooks 구현 | 미확인 | 크로스 플랫폼 패턴 |
| `opencode-pty` | 대화형 pseudo-terminal 관리 | 미확인 | 백그라운드 프로세스 |
| `opencode-cmux` | cmux 터미널 멀티플렉서 통합 | 미확인 | 서브에이전트 세션 분리 |

**opencode-skills 메시지 삽입 패턴 상세 (§9.5.3 B 실증):**

```typescript
// Pseudocode 기반 (malhashemi/opencode-skills 동작 설명)
// 1. 스킬 로딩 안내 메시지 (noReply)
await client.session.prompt({ ..., body: { noReply: true, parts: [{ text: `Loading skill: ${name}` }] }});
// 2. SKILL.md 본문 주입 (noReply)
await client.session.prompt({ ..., body: { noReply: true, parts: [{ text: skillBody }] }});
// 3. Base directory 컨텍스트 제공
//    "Base directory for this skill: /path/to/.opencode/skills/<name>/"
```

`noReply: true` 플래그 두 개 다 필수. 컨텍스트 압축 시 도구 응답은 제거되어도 `noReply` 메시지는 살아남는 것으로 관찰됨 (상세 메커니즘 미확인).

---

## 참고 레퍼런스

- 공식 문서: `https://opencode.ai/docs/plugins`, `https://opencode.ai/docs/skills`, `https://opencode.ai/docs/agents`
- OpenCode 소스: `https://github.com/opencode-ai/opencode` (미러: `anomalyco/opencode`)
- SDK 타입 정의: `@opencode-ai/plugin`, `@opencode-ai/sdk` (npm)
- opencode-skills 소스: `malhashemi/opencode-skills` (GitHub)
- oh-my-opencode: `code-yeongyu/oh-my-openagent` (GitHub)
- 실증 구현: `opencode-nexus/src/` (이 레포지토리)
- 알려진 버그: GitHub issue #5894, #7006, #12222, #16608, #17412, #17637

---

*작성: 2026-04-12~13. 버전 기준: @opencode-ai/plugin@1.3.13 (최신 1.4.13), @opencode-ai/sdk@1.3.13. API 변경 시 이 문서를 함께 업데이트할 것. 실험 결과 포함 (Zod default 동작, tool() identity, config mutation).*
