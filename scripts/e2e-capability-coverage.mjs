import assert from "node:assert/strict";

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

const agentCount = Object.keys(AGENT_META).length;
console.log(
  `e2e capability-coverage passed (${agentCount} agents, ${totalTools} tool entries, ${warningCount} warnings)`
);
