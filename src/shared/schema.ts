import { z } from "zod";

export const TaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "blocked"
]);

export const TaskItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  status: TaskStatusSchema,
  owner: z.string().optional(),
  owner_agent_id: z.string().optional(),
  owner_reuse_policy: z.string().optional(),
  plan_issue: z.number().optional(),
  deps: z.array(z.number()).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  context: z.string().optional(),
  approach: z.string().optional(),
  acceptance: z.string().optional(),
  risk: z.string().optional()
});

export const TasksFileSchema = z.object({
  goal: z.string().optional(),
  decisions: z.array(z.string()).optional(),
  tasks: z.array(TaskItemSchema)
});

export const PlanAttendeeSchema = z.object({
  role: z.string(),
  name: z.string(),
  joined_at: z.string()
});

export const PlanIssueStatusSchema = z.enum([
  "pending",
  "researching",
  "discussing",
  "decided",
  "deferred",
  "tasked"
]);

export const PlanDiscussionKindSchema = z.enum([
  "research",
  "discussion",
  "summary",
  "decision",
  "risk"
]);

export const PlanDiscussionEntrySchema = z.object({
  speaker: z.string(),
  message: z.string(),
  kind: PlanDiscussionKindSchema.default("discussion"),
  recorded_at: z.string()
});

const PlanDiscussionRecordSchema = z
  .union([PlanDiscussionEntrySchema, z.string()])
  .transform((entry) => normalizeDiscussionEntry(entry));

export const PlanIssueSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    status: PlanIssueStatusSchema,
    discussion: z.array(PlanDiscussionRecordSchema).default([]),
    decision: z.string().optional(),
    summary: z.string().optional(),
    task_refs: z.array(z.number()).default([]),
    how_agents: z.array(z.string()).optional(),
    how_summary: z.record(z.string(), z.string()).optional(),
    how_agent_ids: z.record(z.string(), z.string()).optional()
  })
  .transform((issue) => ({
    ...issue,
    task_refs: issue.task_refs ?? [],
    discussion: issue.discussion ?? []
  }));

export const PlanFileSchema = z.object({
  id: z.number(),
  topic: z.string(),
  attendees: z.array(PlanAttendeeSchema).default([]),
  issues: z.array(PlanIssueSchema),
  research_summary: z.string().optional(),
  created_at: z.string()
});

export const PlanPanelParticipantSchema = z.object({
  role: z.string(),
  session_id: z.string().optional(),
  task_id: z.string().optional(),
  last_summary: z.string().optional(),
  updated_at: z.string()
});

export const PlanSidecarSchema = z.object({
  schema_version: z.literal(1),
  canonical_file: z.literal("plan.json"),
  platform: z.literal("opencode"),
  handoff: z.object({
    policy: z.literal("canonical-first"),
    canonical_ready: z.boolean(),
    updated_at: z.string()
  }),
  panel: z.object({
    strategy: z.literal("how-fixed-panel"),
    participants: z.array(PlanPanelParticipantSchema)
  })
});

export const AgentTrackerItemSchema = z.object({
  harness_id: z.string(),
  agent_name: z.string(),
  agent_id: z.string(),
  started_at: z.string(),
  resume_count: z.number(),
  status: z.enum(["running", "completed"]),
  last_resumed_at: z.string().optional(),
  files_touched: z.array(z.string()).optional(),
  stopped_at: z.string().optional(),
  last_message: z.string().optional(),
  team_name: z.string().optional(),
  coordination_label: z.string().optional(),
  lead_agent: z.string().optional(),
  purpose: z.string().optional()
});

export const AgentTrackerSchema = z.array(AgentTrackerItemSchema);

export const InvocationLifecycleStatusSchema = z.enum(["running", "completed", "failed", "cancelled"]);

export const InvocationContinuityHandlesSchema = z
  .object({
    child_session_id: z.string().optional(),
    child_task_id: z.string().optional(),
    resume_session_id: z.string().optional(),
    resume_task_id: z.string().optional(),
    resume_handles: z.record(z.string()).default({})
  })
  .transform((handles) => ({
    ...handles,
    resume_handles: handles.resume_handles ?? {}
  }));

export const OrchestrationInvocationSchema = z
  .object({
    invocation_id: z.string(),
    agent_type: z.string(),
    status: InvocationLifecycleStatusSchema,
    coordination_label: z.string().optional(),
    team_name: z.string().optional(),
    purpose: z.string().optional(),
    continuity: InvocationContinuityHandlesSchema.default({}),
    started_at: z.string(),
    updated_at: z.string(),
    ended_at: z.string().optional(),
    last_message: z.string().optional()
  })
  .transform((invocation) => ({
    ...invocation,
    continuity: invocation.continuity ?? { resume_handles: {} }
  }));

export const OrchestrationCoreStateSchema = z.object({
  schema_version: z.literal(1),
  updated_at: z.string(),
  invocations: z.array(OrchestrationInvocationSchema)
});

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskItem = z.infer<typeof TaskItemSchema>;
export type TasksFile = z.infer<typeof TasksFileSchema>;
export type PlanIssueStatus = z.infer<typeof PlanIssueStatusSchema>;
export type PlanDiscussionEntry = z.infer<typeof PlanDiscussionEntrySchema>;
export type PlanDiscussionKind = z.infer<typeof PlanDiscussionKindSchema>;
export type PlanFile = z.infer<typeof PlanFileSchema>;
export type PlanSidecar = z.infer<typeof PlanSidecarSchema>;
export type AgentTrackerItem = z.infer<typeof AgentTrackerItemSchema>;
export type InvocationLifecycleStatus = z.infer<typeof InvocationLifecycleStatusSchema>;
export type InvocationContinuityHandles = z.infer<typeof InvocationContinuityHandlesSchema>;
export type OrchestrationInvocation = z.infer<typeof OrchestrationInvocationSchema>;
export type OrchestrationCoreState = z.infer<typeof OrchestrationCoreStateSchema>;

function normalizeDiscussionEntry(entry: string | PlanDiscussionEntry): PlanDiscussionEntry {
  if (typeof entry !== "string") {
    return entry;
  }

  const match = entry.match(/^\[([^\]]+)\]\s*(.*)$/);
  return {
    speaker: match?.[1]?.trim() || "legacy",
    message: match?.[2]?.trim() || entry,
    kind: "discussion",
    recorded_at: "legacy"
  };
}
