import { nxArtifactWrite } from "./artifact";
import { nxAstReplace, nxAstSearch } from "./ast";
import { nxBriefing } from "./briefing";
import { nxContext } from "./context";
import { nxCoreRead, nxCoreWrite } from "./core-store";
import { nxDelegateTemplate } from "./delegation";
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
} from "./lsp";
import { nxMeetDecide, nxMeetDiscuss, nxMeetJoin, nxMeetStart, nxMeetStatus, nxMeetUpdate } from "./meet";
import { nxRulesRead, nxRulesWrite } from "./rules-store";
import { nxSetup } from "./setup";
import { nxTaskAdd, nxTaskClose, nxTaskList, nxTaskUpdate } from "./task";
import { nxInit, nxSync } from "./workflow";

export const nexusTools = {
  nx_meet_start: nxMeetStart,
  nx_meet_status: nxMeetStatus,
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
