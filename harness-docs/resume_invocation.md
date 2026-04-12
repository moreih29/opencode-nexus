# OpenCode Agent Resume Mechanism

## State Files

**`.nexus/state/orchestration.opencode.json`** — tracks all subagent invocations.
Each entry records: `agent_type`, `team_name`, `child_session_id`, `child_task_id`,
`resume_session_id`, `resume_task_id`, `resume_handles`.

**`.nexus/state/plan.opencode.json`** — tracks HOW-agent participants in plan sessions.
Stores session and task IDs per role for continuity across plan interactions.

## Resume Parameters on the `task` Tool

The OpenCode `task` tool (spawns subagents) accepts:

| Parameter | Type | Purpose |
|-----------|------|---------|
| `resume_task_id` | string | Prior task ID to resume from |
| `resume_session_id` | string | Prior session ID to resume from |
| `resume_handles` | Record<string, string> | Arbitrary key-value handles for harness-specific state |

Also accepts camelCase aliases: `resumeTaskId`, `resumeSessionId`, `resumeHandles`.

## Resume Routing

1. Check `AGENT_META[role].resume_tier`:
   - `persistent` → resume by default
   - `bounded` → resume if same artifact and no intervening edits
   - `ephemeral` → always fresh spawn

2. For plan-cycle resume: call `nx_plan_resume` or `nx_plan_followup` to get routing info
   for HOW agents already in a plan session.

3. The opencode-nexus hook system auto-injects `resume_task_id` and `resume_session_id`
   when it finds a prior invocation matching `agent_type` + `team_name` in
   `orchestration.opencode.json`. No manual params needed in most cases.

4. Explicit override: pass `resume_task_id` and `resume_session_id` directly in delegation
   args to force a specific resume target.

## Practical Example (resume an architect in a plan session)

```
// 1. Query resume route
nx_plan_resume({ role: "architect" })
// Returns: { task_id, session_id, resumable: true, recommendation: { ... } }

// 2. Delegate — hook auto-injects resume params from orchestration.opencode.json
Agent({ subagent_type: "architect", team_name: "plan-panel",
  description: "Follow up on architecture review",
})
```

## Fallback Behavior

- If `resume_session_id` points to a session that no longer exists, the task tool
  creates a fresh session silently.
- If `runtime.json` does not have `teams_enabled: true`, resume falls back to fresh
  spawn without error.
