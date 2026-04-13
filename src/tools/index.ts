import { nxArtifactWrite } from "./artifact.js";
import { nxAstReplace, nxAstSearch } from "./ast.js";
import { nxBriefing } from "./briefing.js";
import { nxContext } from "./context.js";
import { nxDelegateTemplate } from "./delegation.js";
import { nxHistorySearch } from "./history-search.js";
import {
  nxLspCodeActions,
  nxLspDiagnostics,
  nxLspDocumentSymbols,
  nxLspFindReferences,
  nxLspGotoDefinition,
  nxLspHover,
  nxLspRename,
  nxLspSymbols,
  nxLspWorkspaceSymbols
} from "./lsp.js";
import { nxPlanDecide, nxPlanDiscuss, nxPlanFollowup, nxPlanJoin, nxPlanResume, nxPlanStart, nxPlanStatus, nxPlanUpdate } from "./plan.js";
import { nxRulesRead, nxRulesWrite } from "./rules-store.js";
import { nxSetup } from "./setup.js";
import { nxTaskAdd, nxTaskClose, nxTaskList, nxTaskUpdate } from "./task.js";
import { nxInit, nxSync } from "./workflow.js";

export const nexusTools = {
  nx_plan_start: nxPlanStart,
  nx_plan_status: nxPlanStatus,
  nx_plan_resume: nxPlanResume,
  nx_plan_followup: nxPlanFollowup,
  nx_plan_update: nxPlanUpdate,
  nx_plan_discuss: nxPlanDiscuss,
  nx_plan_decide: nxPlanDecide,
  nx_plan_join: nxPlanJoin,

  nx_task_add: nxTaskAdd,
  nx_task_list: nxTaskList,
  nx_task_update: nxTaskUpdate,
  nx_task_close: nxTaskClose,
  nx_init: nxInit,
  nx_sync: nxSync,
  nx_setup: nxSetup,
  nx_history_search: nxHistorySearch,
  history_search: nxHistorySearch,

  nx_rules_read: nxRulesRead,
  nx_rules_write: nxRulesWrite,
  nx_context: nxContext,
  nx_briefing: nxBriefing,
  nx_artifact_write: nxArtifactWrite,
  nx_delegate_template: nxDelegateTemplate,

  nx_lsp_symbols: nxLspSymbols,
  nx_lsp_document_symbols: nxLspDocumentSymbols,
  nx_lsp_workspace_symbols: nxLspWorkspaceSymbols,
  nx_lsp_hover: nxLspHover,
  nx_lsp_goto_definition: nxLspGotoDefinition,
  nx_lsp_diagnostics: nxLspDiagnostics,
  nx_lsp_references: nxLspFindReferences,
  nx_lsp_find_references: nxLspFindReferences,
  nx_lsp_rename: nxLspRename,
  nx_lsp_code_actions: nxLspCodeActions,
  nx_ast_search: nxAstSearch,
  nx_ast_replace: nxAstReplace
};
