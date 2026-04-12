import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createNexusPaths } from "../dist/shared/paths.js";
import { ensureNexusStructure } from "../dist/shared/state.js";
import { nxPlanStart, nxPlanDecide } from "../dist/tools/plan.js";
import { nxTaskAdd, nxTaskClose, nxTaskList, nxTaskUpdate } from "../dist/tools/task.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFORMANCE_DIR = path.join(
  __dirname,
  "../node_modules/@moreih29/nexus-core/conformance"
);

// ---------------------------------------------------------------------------
// Tool name mapping: fixture abstract name -> opencode function
// ---------------------------------------------------------------------------
const TOOL_MAP = {
  plan_start: nxPlanStart,
  plan_decide: nxPlanDecide,
  task_add: nxTaskAdd,
  task_close: nxTaskClose,
  task_list: nxTaskList,
  task_update: nxTaskUpdate,
};

// ---------------------------------------------------------------------------
// Param mapping: some fixture param names differ from opencode param names
// ---------------------------------------------------------------------------
function mapParams(toolName, params) {
  if (toolName === "plan_decide" && params && "summary" in params && !("decision" in params)) {
    const { summary, ...rest } = params;
    return { decision: summary, ...rest };
  }
  return params;
}

// ---------------------------------------------------------------------------
// JSONPath evaluator (subset: $, $.field, $.field.field, $.array[N], $.array[-1], $.array.length)
// ---------------------------------------------------------------------------
function evaluateJsonPath(obj, expr) {
  if (expr === "$") {
    return obj;
  }

  // Strip leading "$."
  const stripped = expr.startsWith("$.") ? expr.slice(2) : expr;

  const parts = [];
  // Tokenize: split on . but handle [N] bracket notation
  const tokenRe = /([^.[]+)|\[(-?\d+)\]/g;
  let segmentRe = /([^.[]*)((?:\[\d+\]|\.?[^.[]+)*)/g;

  // Use a simpler tokenizer: split on "." then handle [...] within each segment
  const segments = stripped.split(/(?<!\[[\d-]*)\./);
  for (const seg of segments) {
    const bracketMatch = seg.match(/^([^\[]*)\[(-?\d+)\]$/);
    if (bracketMatch) {
      const field = bracketMatch[1];
      const idx = parseInt(bracketMatch[2], 10);
      if (field) parts.push({ type: "field", key: field });
      parts.push({ type: "index", idx });
    } else {
      parts.push({ type: "field", key: seg });
    }
  }

  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (part.type === "field") {
      // Special case: "length" on arrays
      if (part.key === "length" && Array.isArray(current)) {
        current = current.length;
      } else {
        current = current[part.key];
      }
    } else if (part.type === "index") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      const idx = part.idx < 0 ? current.length + part.idx : part.idx;
      current = current[idx];
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// Assert a single JSONPath value against an expected value or matcher object.
// Fixture format: key=JSONPath, value=literal | { type, min?, max?, minLength?, pattern? }
// ---------------------------------------------------------------------------
function assertSingleValue(label, jsonPath, actual, expected) {
  if (expected === null) {
    if (actual !== null && actual !== undefined) {
      throw new AssertionError(
        `${label}: ${jsonPath}: expected null, got ${JSON.stringify(actual)}`
      );
    }
    return;
  }

  if (typeof expected === "object" && expected !== null && "type" in expected) {
    // Matcher object
    switch (expected.type) {
      case "iso8601":
        if (typeof actual !== "string" || isNaN(Date.parse(actual))) {
          throw new AssertionError(
            `${label}: ${jsonPath}: expected ISO8601 string, got ${JSON.stringify(actual)}`
          );
        }
        break;
      case "string":
        if (typeof actual !== "string") {
          throw new AssertionError(`${label}: ${jsonPath}: expected string, got ${typeof actual}`);
        }
        if (expected.minLength !== undefined && actual.length < expected.minLength) {
          throw new AssertionError(
            `${label}: ${jsonPath}: string length ${actual.length} < minLength ${expected.minLength}`
          );
        }
        if (expected.pattern !== undefined && !new RegExp(expected.pattern).test(actual)) {
          throw new AssertionError(
            `${label}: ${jsonPath}: string does not match pattern /${expected.pattern}/`
          );
        }
        break;
      case "number":
        if (typeof actual !== "number") {
          throw new AssertionError(`${label}: ${jsonPath}: expected number, got ${typeof actual}`);
        }
        if (expected.min !== undefined && actual < expected.min) {
          throw new AssertionError(
            `${label}: ${jsonPath}: ${actual} < min ${expected.min}`
          );
        }
        if (expected.max !== undefined && actual > expected.max) {
          throw new AssertionError(
            `${label}: ${jsonPath}: ${actual} > max ${expected.max}`
          );
        }
        break;
      case "boolean":
        if (typeof actual !== "boolean") {
          throw new AssertionError(`${label}: ${jsonPath}: expected boolean, got ${typeof actual}`);
        }
        break;
      default:
        throw new AssertionError(`${label}: ${jsonPath}: unknown matcher type "${expected.type}"`);
    }
  } else {
    // Literal match
    if (actual !== expected) {
      throw new AssertionError(
        `${label}: ${jsonPath}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Assert all entries in a { "$.path": expected } assertions object against data
// ---------------------------------------------------------------------------
function assertJsonPathAssertions(label, data, assertions) {
  if (!assertions || typeof assertions !== "object") return;
  for (const [jsonPath, expected] of Object.entries(assertions)) {
    const actual = evaluateJsonPath(data, jsonPath);
    assertSingleValue(label, jsonPath, actual, expected);
  }
}

// ---------------------------------------------------------------------------
// Simple error class for readable failures
// ---------------------------------------------------------------------------
class AssertionError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "AssertionError";
  }
}

// ---------------------------------------------------------------------------
// Parse return value: JSON if possible, else plain string
// ---------------------------------------------------------------------------
function parseReturnValue(raw) {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Setup a fresh temp directory for a test case
// ---------------------------------------------------------------------------
async function setupTempDir() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-conformance-"));
  await fs.mkdir(path.join(tempDir, ".git"), { recursive: true });
  await fs.writeFile(path.join(tempDir, ".git", "HEAD"), "ref: refs/heads/test\n", "utf8");
  const paths = createNexusPaths(tempDir);
  await ensureNexusStructure(paths);
  return { tempDir, paths };
}

// ---------------------------------------------------------------------------
// Write precondition state files
// ---------------------------------------------------------------------------
async function applyPreconditionStateFiles(tempDir, stateFiles) {
  if (!stateFiles) return;

  for (const [relPath, content] of Object.entries(stateFiles)) {
    if (content === null) {
      // null means "file must not exist" — skip writing, will be verified in postcondition
      continue;
    }
    const absPath = path.join(tempDir, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const fileContent = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    await fs.writeFile(absPath, fileContent, "utf8");
  }
}

// ---------------------------------------------------------------------------
// Evaluate postcondition state_files assertions
// Format: { "relative/path": { "$.jsonpath": expected, ... } | null }
// ---------------------------------------------------------------------------
async function assertPostconditionStateFiles(label, tempDir, stateFiles) {
  if (!stateFiles) return;

  for (const [relPath, assertions] of Object.entries(stateFiles)) {
    const absPath = path.join(tempDir, relPath);

    if (assertions === null) {
      // null means file must not exist
      try {
        await fs.access(absPath);
        throw new AssertionError(`${label}: expected file to not exist: ${relPath}`);
      } catch (err) {
        if (err instanceof AssertionError) throw err;
        // ENOENT is expected — file doesn't exist, good
      }
      continue;
    }

    // Read and parse file
    let fileContent;
    try {
      const raw = await fs.readFile(absPath, "utf8");
      fileContent = JSON.parse(raw);
    } catch (err) {
      if (err.code === "ENOENT") {
        throw new AssertionError(`${label}: expected state file to exist: ${relPath}`);
      }
      throw err;
    }

    assertJsonPathAssertions(`${label} [${relPath}]`, fileContent, assertions);
  }
}

// ---------------------------------------------------------------------------
// Evaluate postcondition return_value assertions
// Format: { "$.jsonpath": expected, ... }
// ---------------------------------------------------------------------------
function assertReturnValue(label, parsed, returnValueAssertions) {
  if (!returnValueAssertions) return;
  assertJsonPathAssertions(`${label} return`, parsed, returnValueAssertions);
}

// ---------------------------------------------------------------------------
// Run a single tool fixture test case
// ---------------------------------------------------------------------------
async function runToolTestCase(testCase) {
  const label = testCase.test_id ?? testCase.description ?? "unknown";
  const { tempDir, paths } = await setupTempDir();

  try {
    // Apply precondition state files
    const preStateFiles = testCase.precondition?.state_files ?? null;
    await applyPreconditionStateFiles(tempDir, preStateFiles);

    const ctx = { directory: tempDir, worktree: tempDir };
    const toolName = testCase.action.tool;
    const toolFn = TOOL_MAP[toolName];
    if (!toolFn) {
      throw new AssertionError(`Unknown tool: ${toolName}`);
    }

    const rawParams = testCase.action.params ?? {};
    const params = mapParams(toolName, rawParams);

    // Detect error expectation: explicit flag, error_contains, or $.error in return_value
    const hasErrorReturnAssertion = testCase.postcondition?.return_value &&
      Object.keys(testCase.postcondition.return_value).some(k => k === "$.error");
    const expectError =
      testCase.postcondition?.error === true ||
      Boolean(testCase.postcondition?.error_contains) ||
      hasErrorReturnAssertion;

    let rawResult = null;
    let thrownError = null;

    try {
      rawResult = await toolFn.execute(params, ctx);
    } catch (err) {
      thrownError = err;
    }

    if (expectError) {
      // Tool may throw or return an error object — both are conformant
      if (thrownError) {
        if (testCase.postcondition?.error_contains) {
          const expected = testCase.postcondition.error_contains;
          if (!thrownError.message.includes(expected)) {
            throw new AssertionError(
              `${label}: expected error to contain "${expected}", got "${thrownError.message}"`
            );
          }
        }

        const returnValueAssertions = testCase.postcondition?.return_value;
        if (returnValueAssertions) {
          const syntheticReturn = { error: thrownError.message };
          assertReturnValue(label, syntheticReturn, returnValueAssertions);
        }
      } else {
        // Tool returned normally — check if return contains error field
        const parsedResult = parseReturnValue(rawResult);
        const returnValueAssertions = testCase.postcondition?.return_value;
        if (returnValueAssertions) {
          assertReturnValue(label, parsedResult, returnValueAssertions);
        }
      }

      // Assert postcondition state files even for error cases
      const postStateFiles = testCase.postcondition?.state_files ?? null;
      await assertPostconditionStateFiles(label, tempDir, postStateFiles);

      return { label, passed: true };
    }

    if (thrownError) {
      throw new AssertionError(`${label}: tool threw unexpectedly: ${thrownError.message}`);
    }

    const parsedResult = parseReturnValue(rawResult);

    // Assert return value
    const returnValueAssertions = testCase.postcondition?.return_value;
    assertReturnValue(label, parsedResult, returnValueAssertions);

    // Assert postcondition state files
    const postStateFiles = testCase.postcondition?.state_files ?? null;
    await assertPostconditionStateFiles(label, tempDir, postStateFiles);

    return { label, passed: true };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Run a single scenario fixture test case (multi-step)
// ---------------------------------------------------------------------------
async function runScenarioTestCase(testCase) {
  const label = testCase.test_id ?? testCase.description ?? "unknown";
  const { tempDir, paths } = await setupTempDir();

  try {
    const ctx = { directory: tempDir, worktree: tempDir };

    // Apply scenario-level precondition state files
    const preStateFiles = testCase.precondition?.state_files ?? null;
    await applyPreconditionStateFiles(tempDir, preStateFiles);

    for (let stepIdx = 0; stepIdx < testCase.steps.length; stepIdx++) {
      const step = testCase.steps[stepIdx];
      const stepLabel = `${label} step[${stepIdx}]${step.description ? ` (${step.description})` : ""}`;

      const toolName = step.action.tool;
      const toolFn = TOOL_MAP[toolName];
      if (!toolFn) {
        throw new AssertionError(`Unknown tool: ${toolName}`);
      }

      const rawParams = step.action.params ?? {};
      const params = mapParams(toolName, rawParams);

      let rawResult = null;
      let thrownError = null;

      try {
        rawResult = await toolFn.execute(params, ctx);
      } catch (err) {
        thrownError = err;
      }

      const expectError =
        step.postcondition?.error === true || Boolean(step.postcondition?.error_contains);

      if (expectError) {
        if (!thrownError) {
          throw new AssertionError(
            `${stepLabel}: expected tool to throw, but returned: ${JSON.stringify(rawResult)}`
          );
        }
        if (step.postcondition?.error_contains) {
          const expected = step.postcondition.error_contains;
          if (!thrownError.message.includes(expected)) {
            throw new AssertionError(
              `${stepLabel}: expected error to contain "${expected}", got "${thrownError.message}"`
            );
          }
        }
        // assert_return on error case
        if (step.assert_return ?? step.postcondition?.return_value) {
          const assertions = step.assert_return ?? step.postcondition?.return_value;
          const syntheticReturn = { error: thrownError.message };
          assertReturnValue(stepLabel, syntheticReturn, assertions);
        }
      } else {
        if (thrownError) {
          throw new AssertionError(`${stepLabel}: unexpected throw: ${thrownError.message}`);
        }

        const parsedResult = parseReturnValue(rawResult);

        // assert_return (scenario uses this key; also check postcondition.return_value fallback)
        const returnAssertions = step.assert_return ?? step.postcondition?.return_value ?? null;
        if (returnAssertions) {
          assertReturnValue(stepLabel, parsedResult, returnAssertions);
        }

        // assert_state (scenario uses this key; also check postcondition.state_files fallback)
        const stateAssertions = step.assert_state ?? step.postcondition?.state_files ?? null;
        if (stateAssertions) {
          await assertPostconditionStateFiles(stepLabel, tempDir, stateAssertions);
        }
      }
    }

    return { label, passed: true };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Load fixture files from a directory
// ---------------------------------------------------------------------------
async function loadFixturesFromDir(dirPath) {
  const fixtures = [];
  let entries;
  try {
    entries = await fs.readdir(dirPath);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EACCES") {
      return fixtures;
    }
    throw err;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(dirPath, entry);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const data = JSON.parse(raw);
      fixtures.push({ file: entry, data });
    } catch (err) {
      console.warn(`[conformance] Warning: failed to load fixture ${filePath}: ${err.message}`);
    }
  }

  return fixtures;
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------
async function main() {
  // Check conformance directory exists
  let conformanceDirExists = false;
  try {
    await fs.access(CONFORMANCE_DIR);
    conformanceDirExists = true;
  } catch {
    // missing
  }

  if (!conformanceDirExists) {
    console.warn(
      `[conformance] Warning: conformance directory not found at ${CONFORMANCE_DIR}. ` +
        "Install @moreih29/nexus-core with conformance assets to run these tests."
    );
    console.log("e2e conformance skipped (no fixtures)");
    process.exit(0);
  }

  const toolFixtures = await loadFixturesFromDir(path.join(CONFORMANCE_DIR, "tools"));
  const scenarioFixtures = await loadFixturesFromDir(path.join(CONFORMANCE_DIR, "scenarios"));

  if (toolFixtures.length === 0 && scenarioFixtures.length === 0) {
    console.warn("[conformance] Warning: no fixture files found in conformance/tools/ or conformance/scenarios/");
    console.log("e2e conformance skipped (no fixtures)");
    process.exit(0);
  }

  const results = [];

  // Run tool fixtures
  for (const { file, data } of toolFixtures) {
    const testCases = Array.isArray(data) ? data : [data];
    for (const testCase of testCases) {
      let result;
      try {
        result = await runToolTestCase(testCase);
      } catch (err) {
        const label = testCase.test_id ?? testCase.description ?? file;
        result = { label, passed: false, error: err.message };
      }
      results.push({ file, ...result });
    }
  }

  // Run scenario fixtures
  for (const { file, data } of scenarioFixtures) {
    const testCases = Array.isArray(data) ? data : [data];
    for (const testCase of testCases) {
      let result;
      try {
        result = await runScenarioTestCase(testCase);
      } catch (err) {
        const label = testCase.test_id ?? testCase.description ?? file;
        result = { label, passed: false, error: err.message };
      }
      results.push({ file, ...result });
    }
  }

  // Print results
  let passed = 0;
  let failed = 0;

  for (const r of results) {
    if (r.passed) {
      console.log(`  PASS  [${r.file}] ${r.label}`);
      passed++;
    } else {
      console.error(`  FAIL  [${r.file}] ${r.label}`);
      console.error(`        ${r.error}`);
      failed++;
    }
  }

  console.log(`\nconformance: ${passed} passed, ${failed} failed (${results.length} total)`);

  if (failed > 0) {
    process.exit(1);
  }

  console.log("e2e conformance passed");
}

main().catch((err) => {
  console.error("[conformance] Fatal error:", err);
  process.exit(1);
});
