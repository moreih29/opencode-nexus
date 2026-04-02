import { nxArtifactWrite } from "./artifact.js";
import { nxAstReplace, nxAstSearch } from "./ast.js";
import { nxBriefing } from "./briefing.js";
import { nxContext } from "./context.js";
import { nxCoreRead, nxCoreWrite } from "./core-store.js";
import { nxDelegateTemplate } from "./delegation.js";
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
import { nxMeetDecide, nxMeetDiscuss, nxMeetFollowup, nxMeetJoin, nxMeetResume, nxMeetStart, nxMeetStatus, nxMeetUpdate } from "./meet.js";
import { nxRulesRead, nxRulesWrite } from "./rules-store.js";
import { nxSetup } from "./setup.js";
import { nxTaskAdd, nxTaskClose, nxTaskList, nxTaskUpdate } from "./task.js";
import { nxInit, nxSync } from "./workflow.js";

export const nexusTools = {
  nx_meet_start: nxMeetStart,
  nx_meet_status: nxMeetStatus,
  nx_meet_resume: nxMeetResume,
  nx_meet_followup: nxMeetFollowup,
  nx_meet_update: nxMeetUpdate,
  nx_meet_discuss: nxMeetDiscuss,
  nx_meet_decide: nxMeetDecide,
  nx_meet_join: nxMeetJoin,

  nx_task_add: nxTaskAdd,
  nx_task_list: nxTaskList,
  nx_task_update: nxTaskUpdate,
  nx_task_close: nxTaskClose,
  nx_init: nxInit,
  nx_sync: nxSync,
  nx_setup: nxSetup,

  nx_core_read: nxCoreRead,
  nx_core_write: nxCoreWrite,
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
