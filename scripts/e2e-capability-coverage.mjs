import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { AGENT_META, NO_FILE_EDIT_TOOLS } from "../dist/agents/prompts.js";

// §8.7 e2e #2: verify capability → opencode tool resolution produced sensible
// disallowedTools arrays. Unknown tool names are warning-level per §10.2 —
// the OpenCode plugin API does not expose a canonical tool list, so this test
// tracks a hardcoded whitelist that must be updated when OpenCode adds tools.

const KNOWN_OPENCODE_TOOLS = new Set([
  // Core file/command tools
  "read",
  "write",
  "edit",
  "multiedit",
  "patch",
  "glob",
  "grep",
  "bash",
  "task",
  "todoread",
  "todowrite",
  "webfetch",
  "notebookedit",
  // Nexus MCP tools (canonical names from src/tools/)
  "nx_task_add",
  "nx_task_update",
  "nx_task_close",
  "nx_task_list",
  "nx_plan_start",
  "nx_plan_decide",
  "nx_plan_discuss",
  "nx_plan_join",
  "nx_plan_status",
  "nx_plan_update",
  "nx_plan_followup",
  "nx_context",
  "nx_history_search",
  "nx_lsp_hover",
  "nx_lsp_goto_definition",
  "nx_lsp_find_references",
  "nx_lsp_code_actions",
  "nx_lsp_diagnostics",
  "nx_lsp_document_symbols",
  "nx_lsp_workspace_symbols",
  "nx_lsp_rename",
  "nx_ast_search",
  "nx_ast_replace",
  "nx_artifact_write"
]);

// NO_FILE_EDIT_TOOLS sanity
assert.ok(Array.isArray(NO_FILE_EDIT_TOOLS), "NO_FILE_EDIT_TOOLS is not an array");
assert.ok(
  NO_FILE_EDIT_TOOLS.length >= 4,
  `NO_FILE_EDIT_TOOLS too short (${NO_FILE_EDIT_TOOLS.length}); expected >= 4`
);
for (const tool of NO_FILE_EDIT_TOOLS) {
  assert.equal(typeof tool, "string", `NO_FILE_EDIT_TOOLS contains non-string: ${typeof tool}`);
  assert.ok(tool.length > 0, "NO_FILE_EDIT_TOOLS contains empty string");
}

// AGENT_META disallowedTools coverage
let warningCount = 0;
let totalTools = 0;
for (const [id, meta] of Object.entries(AGENT_META)) {
  assert.ok(Array.isArray(meta.disallowedTools), `AGENT_META.${id}.disallowedTools is not an array`);
  for (const tool of meta.disallowedTools) {
    assert.equal(typeof tool, "string", `AGENT_META.${id}.disallowedTools contains non-string`);
    assert.ok(tool.length > 0, `AGENT_META.${id}.disallowedTools contains empty string`);
    totalTools += 1;
    if (!KNOWN_OPENCODE_TOOLS.has(tool)) {
      console.warn(
        `[warn] AGENT_META.${id}.disallowedTools contains unknown tool "${tool}" ` +
          `— update KNOWN_OPENCODE_TOOLS whitelist in scripts/e2e-capability-coverage.mjs`
      );
      warningCount += 1;
    }
  }
}

// capability-map.yml coverage assertion (v0.2.0 migration Step D):
// verify that every blocks_semantic_class in nexus-core vocabulary/capabilities.yml
// has a corresponding entry in capability-map.yml.
const __e2eDir = dirname(fileURLToPath(import.meta.url));
const NEXUS_CORE_ROOT = join(__e2eDir, '..', 'node_modules/@moreih29/nexus-core');
const capsDoc = parseYaml(readFileSync(join(NEXUS_CORE_ROOT, 'vocabulary/capabilities.yml'), 'utf8'));
const mapDoc = parseYaml(readFileSync(join(__e2eDir, '..', 'capability-map.yml'), 'utf8'));

const allSemanticClasses = new Set();
for (const cap of capsDoc.capabilities) {
  for (const cls of cap.blocks_semantic_classes ?? []) {
    allSemanticClasses.add(cls);
  }
}

const mappedClasses = new Set(Object.keys(mapDoc.semantic_class_map));
const missingClasses = [...allSemanticClasses].filter(c => !mappedClasses.has(c));

assert.equal(
  missingClasses.length,
  0,
  `capability-map.yml missing semantic classes from nexus-core: [${missingClasses.join(', ')}]`
);

const agentCount = Object.keys(AGENT_META).length;
console.log(
  `e2e capability-coverage passed (${agentCount} agents, ${totalTools} tool entries, ` +
  `${warningCount} warnings, ${allSemanticClasses.size} semantic classes covered)`
);
