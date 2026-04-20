# Migration Guide: v0.10.x → v0.11.0

v0.11.0 introduces the `opencode-nexus` CLI as the canonical installer, replacing manual `opencode.json` edits and the previous postinstall-driven skills copy flow.

This guide covers 4 common migration scenarios.

---

## Case 1: Fresh install (new user)

No migration needed. Follow the standard setup:

```bash
bun add -d opencode-nexus
bunx opencode-nexus install --scope=project
```

---

## Case 2: Previously configured manually

If your `opencode.json` already contains the Nexus setup:

```json
{
  "plugin": ["opencode-nexus"],
  "mcp": { "nx": { "type": "local", "command": ["nexus-mcp"] } },
  "default_agent": "lead"
}
```

### Steps

1. Upgrade: `bun add -d opencode-nexus@latest`
2. Run: `bunx opencode-nexus doctor --scope=project`
   - Expected: `state: complete`
3. If doctor reports partial state, run: `bunx opencode-nexus install --scope=project`
   - CLI computes the patch — your existing correct keys become no-op; only missing keys are added.
   - Idempotency guaranteed (patch-empty ⇒ no write).

All consumer-owned fields (other plugins, other MCP servers, custom agents, permission) are preserved.

---

## Case 3: v0.10.x with Bun `pm trust` dependency (old postinstall flow)

In v0.10.x, `bun pm trust opencode-nexus` was required for postinstall to copy skills. In v0.11.0, postinstall no longer copies anything.

### Steps

1. Upgrade: `bun add -d opencode-nexus@latest`
2. Run: `bunx opencode-nexus install --scope=project`
   - CLI copies skills via `installSkills` (preserve-first; your edits remain intact)
3. You can optionally run `bun pm trust opencode-nexus` to see the install hint on future installs, but it is no longer required for setup.

The existing `.opencode/skills/` directory is preserved entirely — CLI will not overwrite existing files without `--force`.

---

## Case 4: v0.10.0 with invalid `agents` array in opencode.json

v0.10.0 published docs incorrectly included an `agents` array with `module` fields (invalid per OpenCode canonical schema). If you copied that example and hit `Unrecognized key: "agents"`:

### Steps

1. **Remove the invalid `agents` array** from `opencode.json` — it was never valid. Your `opencode.json` should look like:
   ```json
   {
     "plugin": ["opencode-nexus"],
     "mcp": { "nx": { "type": "local", "command": ["nexus-mcp"] } },
     "default_agent": "lead"
   }
   ```
2. Upgrade: `bun add -d opencode-nexus@latest`
3. Run: `bunx opencode-nexus install --scope=project`
4. Verify: `bunx opencode-nexus doctor --scope=project` → `state: complete`

Note: `plugin: ["opencode-nexus"]` alone auto-registers all 10 agents via the plugin's `export const agents`. No explicit agent list is needed in `opencode.json` (the `agent` object is only for model/permission overrides).

---

## Rollback

If v0.11.0 misbehaves, rollback is straightforward:

```bash
# Uninstall managed keys and skills
bunx opencode-nexus uninstall --scope=project --purge

# Pin to previous version
bun add -d opencode-nexus@0.10.1
```

Backups created during CLI installs (`.backup-YYYYMMDD-HHMMSS`) can be manually restored if needed.

---

## Questions / Issues

- GitHub Issues: https://github.com/moreih29/opencode-nexus/issues
- Upstream (nexus-core): https://github.com/moreih29/nexus-core/issues
