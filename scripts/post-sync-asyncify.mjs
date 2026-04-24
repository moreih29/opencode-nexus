#!/usr/bin/env node

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
const permissionPattern = /permission:\s*\{([\s\S]*?)\n  \}/;

function countMatches(content, pattern) {
  return [...content.matchAll(pattern)].length;
}

function injectPermissionDeny(content) {
  const match = content.match(permissionPattern);
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

  const block = match[1];
  const additions = [];
  if (!/\bnexus_spawn\s*:/.test(block)) additions.push(`    nexus_spawn: "deny",`);
  if (!/\bnexus_result\s*:/.test(block)) additions.push(`    nexus_result: "deny",`);

  if (additions.length === 0) {
    return { content, added: 0, ready: true };
  }

  const insertion = `${additions.join("\n")}\n`;
  const existingBlock = block.replace(/^\n/, "");
  return {
    content: content.replace(permissionPattern, `permission: {\n${insertion}${existingBlock}\n  }`),
    added: additions.length,
    ready: true,
  };
}

function countPermissionEntries(content) {
  const match = content.match(permissionPattern);
  if (!match) return 0;

  let count = 0;
  if (/\bnexus_spawn\s*:\s*"deny"/.test(match[1])) count += 1;
  if (/\bnexus_result\s*:\s*"deny"/.test(match[1])) count += 1;
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
    `[post-sync-asyncify] expected ${expectedReplacementCount} Phase 1 asyncified calls, ` +
      `found ${asyncifiedCount} after planning ${replacementCount} replacements.`,
  );
  process.exit(1);
}

if (permissionFilesReady !== expectedPermissionFileCount || permissionEntriesPresent !== expectedPermissionEntryCount) {
  console.error(
    `[post-sync-asyncify] expected permission denies in ${expectedPermissionFileCount} files ` +
      `(${expectedPermissionEntryCount} entries), found ${permissionFilesReady} files ` +
      `(${permissionEntriesPresent} entries).`,
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
