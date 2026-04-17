import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";

const EXPECTED_GITIGNORE = `state/
*
!context/
!context/**
!memory/
!memory/**
!rules/
!rules/**
!history.json
!.gitignore
`;

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-session-start-defense-"));

// Fresh structure should create .nexus/.gitignore with template content.
const freshRoot = path.join(root, "fresh");
await fs.mkdir(freshRoot, { recursive: true });
const freshPaths = createNexusPaths(freshRoot);
await ensureNexusStructure(freshPaths);
const createdGitignore = await fs.readFile(path.join(freshPaths.NEXUS_ROOT, ".gitignore"), "utf8");
assert.equal(createdGitignore, EXPECTED_GITIGNORE);

// Existing .nexus/.gitignore should be preserved.
const existingRoot = path.join(root, "existing");
await fs.mkdir(path.join(existingRoot, ".nexus"), { recursive: true });
const customGitignore = "# custom\n";
await fs.writeFile(path.join(existingRoot, ".nexus", ".gitignore"), customGitignore, "utf8");
const existingPaths = createNexusPaths(existingRoot);
await ensureNexusStructure(existingPaths);
const preservedGitignore = await fs.readFile(path.join(existingPaths.NEXUS_ROOT, ".gitignore"), "utf8");
assert.equal(preservedGitignore, customGitignore);

// Legacy root tracker should be removed while namespaced tracker remains.
await fs.mkdir(existingPaths.STATE_ROOT, { recursive: true });
await fs.mkdir(existingPaths.HARNESS_NAMESPACE_ROOT, { recursive: true });
const legacyTrackerPath = path.join(existingPaths.STATE_ROOT, "agent-tracker.json");
const harnessTrackerPath = path.join(existingPaths.HARNESS_NAMESPACE_ROOT, "agent-tracker.json");
await fs.writeFile(legacyTrackerPath, "{}\n", "utf8");
await fs.writeFile(harnessTrackerPath, '{"keep":true}\n', "utf8");
await ensureNexusStructure(existingPaths);

await assert.rejects(() => fs.access(legacyTrackerPath));
assert.equal(await fs.readFile(harnessTrackerPath, "utf8"), '{"keep":true}\n');

console.log("e2e session start defense passed");
