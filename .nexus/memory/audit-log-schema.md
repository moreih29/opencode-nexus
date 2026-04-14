# Audit Log Schema — DEPRECATED

Superseded by [`tool-log-schema.md`](./tool-log-schema.md) in the state-refactor cycle.

The `.nexus/state/opencode-nexus/audit/` directory and triple-write audit fanout (all.jsonl + session.jsonl + subagents/*.jsonl) have been removed. The equivalent observability is now provided by:

- `.nexus/state/opencode-nexus/agent-tracker.json` — invocation ledger (harness-produced, shared-purpose per nexus-core spec)
- `.nexus/state/opencode-nexus/tool-log.jsonl` — flat PostToolUse-style log for subagent file attribution

See `tool-log-schema.md` for the new reference.
