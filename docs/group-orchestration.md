# Group Orchestration Model

`opencode-nexus` uses a lead-coordinated group model instead of Claude Code team objects.

## Core Model

- Lead agent: starts and coordinates all subagent work
- `team_name`: shared coordination label used to group related subagent calls
- `agent-tracker.json`: stores coordination events, labels, agent types, and recent purpose hints
- `nx_context`: reports active coordination groups for runtime visibility

## What This Replaces

- No TeamCreate parity
- No TeamDelete parity
- No direct agent-to-agent messaging parity
- No platform-native team roster

## What Is Supported

- grouping related subagent calls under one label
- enforcing grouped execution in run mode for DO/CHECK agents
- checking whether non-lead meet attendees have an active coordination label
- exposing coordination groups back to the lead agent through `nx_context`

## Operational Rule

All coordination remains lead-mediated. Subagents do work and report back; they do not directly manage each other.
