# OpenCode ↔ nexus-core Hook Mapping

This document maps OpenCode runtime event/hook names to nexus-core consumer-facing hook concepts used by nexus-core docs and skill guidance.

## Event/Hook Mapping

| OpenCode event/hook | nexus-core conceptual hook | Notes |
|---|---|---|
| `event(session.created)` | `session_start` | Session lifecycle start boundary. |
| `chat.message` | `user_message` | Primary user-message trigger in OpenCode runtime. |
| `tool.execute.before` | `subagent_spawn` and/or `pre_tool_use` | OpenCode exposes one before-tool hook; nexus-core may describe subagent/tool intents separately. |
| `tool.execute.after` | `subagent_complete` and/or `post_tool_use` | OpenCode exposes one after-tool hook; nexus-core may describe subagent/tool completion intents separately. |
| `event(session.deleted)` | `session_end` | Session lifecycle end boundary. |
| `experimental.session.compacting` | `context_compact` | Context/window compaction signal. |

## Practical Note

In OpenCode integrations, `experimental.chat.system.transform` often participates in user-message-adjacent context injection behavior. Treat it as complementary runtime plumbing around `user_message`-like processing, not as a separate nexus-core lifecycle hook category.
