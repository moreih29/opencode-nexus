#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync("bunx", ["nexus-validate-conformance"], {
  stdio: "inherit"
});
process.exit(result.status ?? 1);
