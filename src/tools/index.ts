import { nxArtifactWrite } from "./artifact";
import { nxBriefing } from "./briefing";
import { nxContext } from "./context";
import { nxCoreRead, nxCoreWrite } from "./core-store";
import { nxDelegateTemplate } from "./delegation";
import { nxMeetDecide, nxMeetDiscuss, nxMeetJoin, nxMeetStart, nxMeetStatus, nxMeetUpdate } from "./meet";
import { nxRulesRead, nxRulesWrite } from "./rules-store";
import { nxTaskAdd, nxTaskClose, nxTaskList, nxTaskUpdate } from "./task";

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

  nx_core_read: nxCoreRead,
  nx_core_write: nxCoreWrite,
  nx_rules_read: nxRulesRead,
  nx_rules_write: nxRulesWrite,
  nx_context: nxContext,
  nx_briefing: nxBriefing,
  nx_artifact_write: nxArtifactWrite,
  nx_delegate_template: nxDelegateTemplate
};
