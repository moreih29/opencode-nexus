---
name: nx-sync
description: Thin entrypoint for Nexus core sync. Use this when you want to explicitly sync archived execution knowledge back into core docs.
---

# nx-sync

This is a thin entrypoint command for Nexus synchronization.

Use the canonical `nx_sync` tool to perform the work. Do not invent a parallel workflow.

## Default action

- Call `nx_sync(scope="all")` unless the user explicitly asks for a narrower scope or a specific cycle.
- Report which layers were scanned, which files changed, and any items that still need verification.
- Treat `scope="all"` as including `identity`, `memory`, `codebase`, and `reference`.

## When to use

- After a completed task cycle
- When the user explicitly wants Nexus core knowledge refreshed
- When archived work should be promoted into reusable project memory

## Notes

- `nx_sync` remains the canonical backend.
- Preserve existing core document structure when syncing; prefer targeted updates and mark weak evidence as needing verification.
- If an execution cycle is still open, finish verification and close it before treating sync as complete.
