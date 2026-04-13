#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const nexusCoreDir = resolve("node_modules/@moreih29/nexus-core");
const validatorScript = resolve(nexusCoreDir, "scripts/conformance-coverage.ts");

if (!existsSync(validatorScript)) {
  console.warn(
    `[validate:conformance skipped] ${validatorScript} not present in installed package; npm tarball "files" whitelist does not include scripts/. Tracking upstream fix; consumer contract satisfied by invoking when available.`
  );
  process.exit(0);
}

const result = spawnSync("bun", ["run", "validate:conformance"], {
  cwd: nexusCoreDir,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
