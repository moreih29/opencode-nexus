#!/usr/bin/env node

// opencode-nexus postinstall — minimal hint role.
// Design: plan #58 Issue #3 decision.
//
// This script does NOT mutate the consumer filesystem. The CLI
// (`bunx opencode-nexus install`) is the canonical install authority.
// Package-manager policies (Bun trust, pnpm/yarn berry script settings)
// make postinstall an unreliable mutation vehicle, so we print setup
// guidance here and defer all file changes to the explicit CLI command.
//
// Self-install guard is preserved so running `bun install` inside this
// repo during development does not emit the consumer hint.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const consumerCwd = process.env.INIT_CWD;

if (!consumerCwd) {
  // Direct invocation (not via package-manager lifecycle) — stay silent.
  process.exit(0);
}

try {
  const consumerPkgPath = join(consumerCwd, "package.json");
  if (existsSync(consumerPkgPath)) {
    const consumerPkg = JSON.parse(readFileSync(consumerPkgPath, "utf-8"));
    if (consumerPkg.name === "opencode-nexus") {
      // Self-install detected (developing in opencode-nexus repo).
      process.exit(0);
    }
  }
} catch {
  // If package.json is unreadable, fall through to guidance — never fail install.
}

console.log(`
[opencode-nexus] Package installed. Setup is NOT automatic.

Complete setup with the canonical CLI:

  bunx opencode-nexus install --scope=project
  # or --scope=user  (machine-global)
  # or --scope=both  (split: user gets plugin+mcp, project gets default_agent+skills)

Other entrypoints:
  opencode-nexus doctor     # diagnose install state
  opencode-nexus uninstall  # remove managed config/skills
  opencode-nexus --help     # full CLI reference

See README for details. This script never writes to your filesystem.
`);

process.exit(0);
