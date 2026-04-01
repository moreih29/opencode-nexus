# Team Compatibility Matrix

This project does not provide Claude Code team-object parity. In `opencode-nexus`, `team_name` is a coordination label used by the lead agent to group related subagent work.

| Capability | Status | Notes |
|---|---|---|
| Shared coordination label | Supported | `team_name` groups related subagent calls |
| Lead-mediated subagent coordination | Supported | Lead spawns and collects subagent work through OpenCode tasking |
| Run-mode guardrails for grouped execution | Supported | DO/CHECK subagents require `team_name` in run mode |
| Meet attendee validation against grouped coordination | Partial | Non-lead attendees require an active coordination label in tracker state |
| Team membership registry | Partial | Tracker records labels and agent starts, but not a durable member roster |
| Direct agent-to-agent messaging | Unsupported | No OpenCode equivalent of Claude `SendMessage` |
| Team object lifecycle API | Unsupported | No TeamCreate/TeamDelete parity |

## Terminology

- `team_name`: coordination label, not a platform-native team object
- `agent-tracker.json`: coordination state tracker, not a full team registry
- lead agent: the only actor coordinating subagent creation and result collection
