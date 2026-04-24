#!/usr/bin/env node

/**
 * scripts/post-sync-asyncify.mjs — Regular sync pipeline layer
 *
 * Chained after `nexus-sync --harness=opencode` in package.json's `sync` script.
 * Part of the opencode-nexus sync pipeline since cycle 12 (2026-04-24), after
 * the nexus-core maintainer recognized this downstream integration pattern as
 * legitimate in nexus-core#68 (closed, not planned).
 *
 * Responsibilities:
 *   1. Rewrite `task({ subagent_type, prompt, description })` subagent_spawn
 *      emissions to `nexus_spawn({ agent_id, prompt })` in generated skill
 *      bodies, enabling primary-unblock via our custom nexus_spawn tool
 *      (see src/plugin.ts).
 *   2. Re-inject `nexus_spawn: "deny"` / `nexus_result: "deny"` permissions
 *      into 9 non-lead agent files that `bun run sync` overwrites on every
 *      invocation (Lead-monopoly invariant).
 *
 * Dependency contract:
 *   - nexus-core harness/opencode/invocations.yml:5 must emit
 *     `task({ subagent_type: "{target_role}", prompt: "{prompt}", description: "{name}" })`
 *     for the subagent_spawn macro. If this template form changes upstream,
 *     the regex below must be updated accordingly. The assertion counters
 *     (8 replacements / 9 files / 18 entries) will fail-fast on drift.
 *   - nexus-core spec/agents role body files do NOT use the subagent_spawn macro
 *     (role definitions only); see
 *     .nexus/memory/empirical-sync-macro-usage-verification.md for why this
 *     matters for future expansion planning.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dryRun = process.argv.includes("--dry-run");

const targets = [
  "src/agents/lead.ts",
  "src/agents/architect.ts",
  "src/agents/designer.ts",
  "src/agents/postdoc.ts",
  "src/agents/strategist.ts",
  ".opencode/skills/nx-plan/SKILL.md",
  ".opencode/skills/nx-auto-plan/SKILL.md",
  ".opencode/skills/nx-run/SKILL.md",
];

const permissionTargets = [
  "src/agents/architect.ts",
  "src/agents/designer.ts",
  "src/agents/engineer.ts",
  "src/agents/postdoc.ts",
  "src/agents/researcher.ts",
  "src/agents/reviewer.ts",
  "src/agents/strategist.ts",
  "src/agents/tester.ts",
  "src/agents/writer.ts",
];

const expectedReplacementCount = 8;
const expectedPermissionFileCount = 9;
const expectedPermissionEntryCount = 18;
const spawnPattern = /task\(\{\s*subagent_type:\s*"([^"]+)"\s*,\s*prompt:\s*"([^"]+)"\s*,\s*description:\s*"([^"]+)"\s*\}\)/g;
const asyncifiedPattern = /nexus_spawn\(\{\s*agent_id:\s*"[^"]+"\s*,\s*prompt:\s*"[^"]+"\s*\}\)/g;
const permissionStartPattern = /permission:\s*\{/;

function countMatches(content, pattern) {
  return [...content.matchAll(pattern)].length;
}

function findPermissionBlock(content) {
  const match = content.match(permissionStartPattern);
  if (!match || match.index === undefined) return null;

  const openBraceIndex = match.index + match[0].lastIndexOf("{");
  let depth = 0;
  let inString = false;
  let stringQuote = "";
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openBraceIndex; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      if (char === "\\") {
        index += 1;
      } else if (char === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = true;
      stringQuote = char;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          start: match.index,
          openBraceIndex,
          closeBraceIndex: index,
          block: content.slice(openBraceIndex + 1, index),
        };
      }
    }
  }

  return null;
}

function injectPermissionDeny(content) {
  const match = findPermissionBlock(content);
  if (!match) {
    const insertAfterDescription = /(description:\s*"[^"]+",\n)/;
    if (!insertAfterDescription.test(content)) return { content, added: 0, ready: false };

    return {
      content: content.replace(
        insertAfterDescription,
        `$1  permission: {\n    nexus_spawn: "deny",\n    nexus_result: "deny",\n  },\n`,
      ),
      added: 2,
      ready: true,
    };
  }

  const block = match.block;
  const additions = [];
  if (!/\bnexus_spawn\s*:/.test(block)) additions.push(`    nexus_spawn: "deny",`);
  if (!/\bnexus_result\s*:/.test(block)) additions.push(`    nexus_result: "deny",`);

  if (additions.length === 0) {
    return { content, added: 0, ready: true };
  }

  const insertion = `${additions.join("\n")}\n`;
  const existingBlock = block.replace(/^\n/, "").replace(/\n[ \t]*$/, "");
  return {
    content: `${content.slice(0, match.start)}permission: {\n${insertion}${existingBlock}\n  }${content.slice(match.closeBraceIndex + 1)}`,
    added: additions.length,
    ready: true,
  };
}

function countPermissionEntries(content) {
  const match = findPermissionBlock(content);
  if (!match) return 0;

  let count = 0;
  if (/\bnexus_spawn\s*:\s*"deny"/.test(match.block)) count += 1;
  if (/\bnexus_result\s*:\s*"deny"/.test(match.block)) count += 1;
  return count;
}

const summaries = [];
let replacementCount = 0;
let asyncifiedCount = 0;

for (const target of targets) {
  const path = resolve(target);
  if (!existsSync(path)) {
    summaries.push({ target, replacements: 0, existing: 0, skipped: true });
    continue;
  }

  const before = readFileSync(path, "utf8");
  const existing = countMatches(before, asyncifiedPattern);
  const after = before.replace(spawnPattern, (_match, agentID, prompt) => {
    replacementCount += 1;
    return `nexus_spawn({ agent_id: "${agentID}", prompt: "${prompt}" })`;
  });
  const replacements = countMatches(before, spawnPattern);
  const fileAsyncifiedCount = countMatches(after, asyncifiedPattern);

  asyncifiedCount += fileAsyncifiedCount;
  summaries.push({ target, replacements, existing, skipped: false });

  if (!dryRun && after !== before) {
    writeFileSync(path, after, "utf8");
  }
}

const permissionSummaries = [];
let permissionFilesReady = 0;
let permissionEntriesPresent = 0;
let permissionEntriesAdded = 0;

for (const target of permissionTargets) {
  const path = resolve(target);
  if (!existsSync(path)) {
    permissionSummaries.push({ target, added: 0, entries: 0, ready: false, skipped: true });
    continue;
  }

  const before = readFileSync(path, "utf8");
  const result = injectPermissionDeny(before);
  const entries = countPermissionEntries(result.content);
  const ready = result.ready && entries === 2;

  if (ready) permissionFilesReady += 1;
  permissionEntriesPresent += entries;
  permissionEntriesAdded += result.added;
  permissionSummaries.push({ target, added: result.added, entries, ready, skipped: false });

  if (!dryRun && result.content !== before) {
    writeFileSync(path, result.content, "utf8");
  }
}

if (replacementCount + (asyncifiedCount - replacementCount) !== expectedReplacementCount) {
  console.error(
    `[post-sync-asyncify] ASSERTION FAILED: expected ${expectedReplacementCount} subagent_spawn replacements, got ${asyncifiedCount}.\n\n` +
      `Likely causes:\n` +
      `  1. nexus-core upstream bumped and changed harness/opencode/invocations.yml:5\n` +
      `     template from \`task({ subagent_type, prompt, description })\` to a\n` +
      `     different shape. Inspect the line and update the regex in this script.\n` +
      `  2. A new skill body (spec/skills/*) started using {{subagent_spawn ...}} —\n` +
      `     update expectedReplacementCount after verifying.\n` +
      `  3. A previous user-edit to .opencode/skills/* between sync and post-sync\n` +
      `     already converted some call sites. Run \`bun run sync\` fresh.`,
  );
  process.exit(1);
}

if (permissionFilesReady !== expectedPermissionFileCount || permissionEntriesPresent !== expectedPermissionEntryCount) {
  console.error(
    `[post-sync-asyncify] ASSERTION FAILED: expected ${expectedPermissionEntryCount} permission entries ` +
      `across ${expectedPermissionFileCount} files, got ${permissionEntriesPresent} across ${permissionFilesReady}.\n\n` +
      `Likely causes:\n` +
      `  1. A new agent was added to the 9-agent set (architect/designer/engineer/\n` +
      `     postdoc/researcher/reviewer/strategist/tester/writer) — update\n` +
      `     permissionTargets and expectedPermissionEntryCount.\n` +
      `  2. An existing agent.ts file structure changed (e.g. no \`permission: { ... }\`\n` +
      `     block) — inspect the file and the injection regex.\n` +
      `  3. A previous post-sync run partially succeeded — check git diff for\n` +
      `     inconsistency.`,
  );
  process.exit(1);
}

console.log(`[post-sync-asyncify] ${dryRun ? "dry-run" : "write"} summary`);
for (const summary of summaries) {
  const suffix = summary.skipped ? " (missing; skipped)" : ` (${summary.existing} already asyncified)`;
  console.log(`- ${summary.target}: ${summary.replacements} replacement(s)${suffix}`);
}
console.log(`[post-sync-asyncify] total replacements: ${replacementCount}/${expectedReplacementCount}`);
console.log(
  `[post-sync-asyncify] permission injected: ${permissionFilesReady}/${expectedPermissionFileCount} files, ` +
    `${permissionEntriesPresent}/${expectedPermissionEntryCount} entries (${permissionEntriesAdded} added)`,
);
for (const summary of permissionSummaries) {
  const suffix = summary.skipped ? " (missing; skipped)" : ` (${summary.entries}/2 present)`;
  console.log(`- ${summary.target}: ${summary.added} permission entr${summary.added === 1 ? "y" : "ies"} added${suffix}`);
}
