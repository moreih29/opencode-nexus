# Audit Log Schema Reference

Source: `docs/subagent-audit-fields.md`

This document describes the experimental audit log structure under `.nexus/state/audit/` and the full field schema for subagent invocation records.

---

## Log Directory Structure

| Path | Contents |
|---|---|
| `.nexus/state/audit/all.jsonl` | Global stream — all events across all sessions |
| `.nexus/state/audit/sessions/<session-id>/session.jsonl` | Per-session stream |
| `.nexus/state/audit/sessions/<parent-session-id>/subagents/<invocation-id>.jsonl` | Per-subagent stream |

---

## Field Schema

| Category | Field | Meaning | Example |
|---|---|---|---|
| Common | `ts` | Log record timestamp | `2026-04-02T12:02:14.017Z` |
| Common | `kind` | Record kind | `event`, `tool.execute.before`, `tool.execute.after`, `subagent.lifecycle` |
| Common | `session_id` | Session the record belongs to | `ses_...` |
| Event | `event_type` | OpenCode event type | `session.created`, `message.updated`, `session.error` |
| Event | `payload.type` | Raw event type | `message.updated` |
| Event | `payload.properties` | Raw event payload body | session/message/status fields |
| Tool before | `tool` | Invoked tool name | `task`, `bash`, `read` |
| Tool before | `args` | Tool call input arguments | `description`, `prompt`, `command` |
| Tool after | `title` | Tool result title | `Engineer smoke check` |
| Tool after | `output_preview` | Tool result preview | `<task_result> ...` |
| Tool after | `metadata` | Tool result metadata | `sessionId`, `model`, `truncated` |
| Tool after | `metadata.sessionId` | Child subagent session id | `ses_2b1ed6...` |
| Tool after | `metadata.model.providerID` | Model provider | `openai` |
| Tool after | `metadata.model.modelID` | Actual model used | `gpt-5.3-codex` |
| Subagent | `subagent.invocation_id` | Parent-side internal invocation id | `subagent-1` |
| Subagent | `subagent.agent_type` | Subagent role/type | `engineer`, `architect` |
| Subagent | `subagent.team_name` | Coordination group label | `null` or a team label |
| Subagent | `subagent.fingerprint` | Correlation signature for matching before/after | JSON string of agent/description/resume fields |
| Subagent | `subagent.started_at` | Subagent invocation start time | ISO timestamp |
| Subagent | `subagent.session_id` | Child subagent session id after resolution | `ses_...` |
| Lifecycle | `phase` | Lifecycle phase | `before`, `after` |
| Lifecycle | `started_at` | Lifecycle start time | ISO timestamp |
| Lifecycle | `subagent_session_id` | Child session id captured after completion | `ses_...` |
| Lifecycle | `subagent_task_id` | Returned task id if exposed in metadata | usually `null` so far |
| Session | `payload.properties.info.id` | Session or message id | `ses_...`, `msg_...` |
| Session | `payload.properties.info.parentID` | Parent session or message id | parent `ses_...` or `msg_...` |
| Session | `payload.properties.info.title` | Child session title | `Engineer smoke check (@engineer subagent)` |
| Session | `payload.properties.info.slug` | Session slug | `jolly-canyon` |
| Session | `payload.properties.info.directory` | Working directory | workspace path |
| Status | `payload.properties.status.type` | Session status | `busy`, `idle` |
| Message | `payload.properties.info.role` | Message author role | `user`, `assistant` |
| Message | `payload.properties.info.agent` | Running agent | `engineer`, `architect` |
| Message | `payload.properties.info.mode` | Agent mode label | `engineer` |
| Message | `payload.properties.info.tokens` | Token usage summary | `input`, `output`, `reasoning` |
| Message part | `payload.properties.part.type` | Part type | `text`, `tool`, `reasoning`, `step-start`, `step-finish` |
| Message part | `payload.properties.part.text` | Text content | prompt or streamed response text |
| Message part | `payload.properties.part.tool` | Tool used by the subagent | `bash`, `task` |
| Message part | `payload.properties.part.callID` | Tool call id | `call_...` |
| Message delta | `payload.properties.delta` | Streamed text fragment | streamed text |
| Tool metadata | `metadata.output` | Full tool output if present | `git status` output |
| Tool metadata | `metadata.exit` | Exit code for bash-like tools | `0` |
| Error | `payload.properties.error.name` | Error type | `APIError` |
| Error | `payload.properties.error.data.message` | Error message | unsupported model, etc. |
| Error | `payload.properties.error.data.statusCode` | HTTP status code | `400` |

---

## Notes

- `team_name` is a coordination label, not the persistence key for subagent conversation history. Actual continuity comes from the child `session_id` and any returned `task_id`/resume handles.
- The audit logs can show parent-child session linkage, model identity, prompts, tool calls, streamed output, and failures.
- Chain-of-thought is not exposed. Reasoning content appears only as encrypted or empty placeholders in current payloads.
