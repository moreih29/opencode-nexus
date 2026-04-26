#!/usr/bin/env node
// clack-smoke.mjs — Verify that @clack/prompts named imports survive
// our bun 1.3.9 / Node 22 ESM environment before migrating CLI prompts.
//
// Background: https://github.com/bombshell-dev/clack/issues/508 reported that
// `cancel` named import breaks under certain bun versions. This script is the
// migration gate — both `node scripts/clack-smoke.mjs` and `bun scripts/clack-smoke.mjs`
// must exit 0 before we touch any prompt sites.

import {
  intro,
  outro,
  select,
  multiselect,
  confirm,
  text,
  note,
  cancel,
  isCancel,
  group,
  spinner,
} from "@clack/prompts";

const checks = [
  ["intro", intro, "function"],
  ["outro", outro, "function"],
  ["select", select, "function"],
  ["multiselect", multiselect, "function"],
  ["confirm", confirm, "function"],
  ["text", text, "function"],
  ["note", note, "function"],
  ["cancel", cancel, "function"],
  ["isCancel", isCancel, "function"],
  ["group", group, "function"],
  ["spinner", spinner, "function"],
];

const failures = [];
for (const [name, value, expected] of checks) {
  const actual = typeof value;
  if (actual !== expected) {
    failures.push(`  - ${name}: expected typeof === "${expected}", got "${actual}"${value === undefined ? " (undefined import — likely import resolution failure)" : ""}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `[clack-smoke] FAIL — ${failures.length} import(s) broken under ${process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`}:\n` +
      failures.join("\n") +
      "\n",
  );
  process.exit(1);
}

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
process.stdout.write(`[clack-smoke] PASS — ${checks.length} imports OK on ${runtime}\n`);
process.exit(0);
