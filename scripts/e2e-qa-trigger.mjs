import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { evaluateQaAutoTrigger } from "../dist/pipeline/qa-trigger.js";

const execFileAsync = promisify(execFile);

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-qa-"));
await execFileAsync("git", ["init"], { cwd: root });
await fs.mkdir(path.join(root, "src"), { recursive: true });
await fs.writeFile(path.join(root, "src", "api.ts"), "export const x = 1\n", "utf8");
await fs.writeFile(path.join(root, "src", "foo.test.ts"), "test('x', ()=>{})\n", "utf8");
await fs.writeFile(path.join(root, "src", "db.ts"), "export const db = {}\n", "utf8");

const result = await evaluateQaAutoTrigger(root, ["previous failure in area"]);
assert.equal(result.shouldSpawn, true);
assert.equal(result.reasons.length > 0, true);

console.log("e2e qa trigger passed");
