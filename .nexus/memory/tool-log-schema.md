# Tool Log + Agent Tracker Schema Reference

Source: state refactor (`.nexus/state/artifacts/state-refactor-design.md` §1)

Supersedes the former `audit-log-schema.md` (audit/ directory was removed in favor of a single flat `tool-log.jsonl` file plus the `agent-tracker.json` invocation record, matching the claude-nexus pattern).

---

## Files

| Path | Purpose | Lifecycle |
|---|---|---|
| `.nexus/state/opencode-nexus/agent-tracker.json` | Session-scoped invocation ledger. Object shape. | Created on `session.created`, overwritten across session. git-tracked No. |
| `.nexus/state/opencode-nexus/tool-log.jsonl` | Flat append-only log of file-editing tool calls (subagent attribution). | Reset on `session.created`, append on each `tool.execute.after`. git-tracked No. |

The older `.nexus/state/opencode-nexus/audit/` directory (`all.jsonl`, `sessions/<sid>/session.jsonl`, `sessions/<sid>/subagents/<iid>.jsonl`) no longer exists. Triple-write audit fanout was replaced with a single tool-log append plus the agent-tracker invocation record.

---

## agent-tracker.json shape

```ts
type AgentTracker = {
  harness_id: "opencode-nexus";   // required (nexus-core spec)
  started_at: string;              // ISO 8601, required
  invocations: Invocation[];       // harness extension, may be []
};

type Invocation = {
  invocation_id: string;           // required — monotonic per session
  agent_id: string;                // harness-opaque; currently `${type}-${Date.now()}`
  agent_type: string;              // "architect", "engineer", ...
  status: "running" | "completed" | "failed" | "cancelled";
  started_at: string;              // ISO 8601
  coordination_label?: string;
  purpose?: string;
  updated_at?: string;
  ended_at?: string;
  resume_count?: number;
  last_resumed_at?: string;
  last_message?: string;
  stopped_at?: string;
  continuity?: {
    child_session_id?: string;     // opencode task tool resume target
    child_task_id?: string;
    resume_handles?: Record<string, unknown>;
  };
  files_touched?: string[];        // aggregated from tool-log.jsonl at invocation end
};
```

Required top-level fields (`harness_id`, `started_at`) per nexus-core agent-tracker spec (`docs/nexus-outputs-contract.md §Harness-produced`). All other fields are harness extensions; consumers that don't recognize them MUST NOT error.

---

## tool-log.jsonl record

```ts
type ToolLogEntry = {
  ts: string;         // ISO 8601
  agent_id: string;   // Invocation.invocation_id (subagent-scoped)
  tool: string;       // "write" | "edit" | "patch" | "multiedit"
  file: string;       // absolute or relative file path
};
```

One JSON object per line. File is plain JSONL (no wrapping array). Reset (truncated) on `session.created`; subsequent hook invocations append only.

### Write conditions (hooks.ts `tool.execute.after`)

1. Input `tool` is a file-editing tool: `write`, `edit`, `patch`, `multiedit`.
2. `args` contains a resolvable file path (`filePath`, `file_path`, `path`, or tool-specific field).
3. Current `sessionID` matches some `agent-tracker.invocations[i].continuity.child_session_id` AND that invocation has `status: "running"` — Lead/main-session edits are silently skipped (claude-nexus parity).

If any condition fails the hook returns without touching the log. Skipped edits leave no record — this is by design.

---

## files_touched aggregation

Happens on `tool.execute.after` when the completing tool is `task` (i.e., a subagent finishes):

1. Look up the invocation whose `continuity.child_session_id` matches the task session.
2. Call `aggregateFilesForAgent(TOOL_LOG_FILE, invocation.agent_id)` — scans the log, unions unique `file` values, returns `string[]`.
3. Patch the invocation record: `registerInvocationEnd(..., { status, last_message, ended_at })` plus a follow-up read-modify-write to attach `files_touched` (the `RegisterInvocationEndInput` type does not carry `files_touched`, so attachment is an out-of-band tracker patch).

Failure handling is silent (claude-nexus parity) — an unreadable log or malformed line drops that entry; the rest of the aggregation proceeds.

---

## Consumer expectations

- Cross-harness readers of `agent-tracker.json` MUST treat `agent_id` as opaque (no UUID parsing, no cross-harness identity mapping).
- `tool-log.jsonl` has no nexus-core schema. It is an internal opencode-nexus log and may be format-changed without notice on minor version bumps.
- The tracker is session-scoped and non-git-tracked. Session restart wipes the in-memory invocation map; persisted invocations that have `status: "running"` after restart are stale and not resumable.

---

## References

- `src/shared/agent-tracker.ts` — API surface
- `src/shared/tool-log.ts` — log I/O helpers
- `src/plugin/hooks.ts` — event hook integration
- `claude-nexus/src/hooks/gate.ts:498-605` — reference PostToolUse/SubagentStop pattern
- nexus-core `docs/nexus-outputs-contract.md §Harness-produced` — spec obligation
