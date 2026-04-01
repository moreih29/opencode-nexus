import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { ensureRunState, setRunPhase } from "../dist/shared/run-state.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-phase-"));
const paths = createNexusPaths(root);
await ensureNexusStructure(paths);
await ensureRunState(paths.RUN_FILE);

let blocked = false;
try {
  await setRunPhase(paths.RUN_FILE, "complete", "skip phases", false);
} catch {
  blocked = true;
}
assert.equal(blocked, true);

await setRunPhase(paths.RUN_FILE, "design", "ok", false);
await setRunPhase(paths.RUN_FILE, "execute", "ok", false);
await setRunPhase(paths.RUN_FILE, "verify", "ok", false);
await setRunPhase(paths.RUN_FILE, "complete", "ok", false);

console.log("e2e phase guard passed");
