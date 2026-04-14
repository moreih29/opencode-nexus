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
  // updated_at deprecated — accepted on read but not written in new data
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

// Deprecated — kept for graceful parsing of legacy plan.json only. Not used in new writes.
export const PlanAttendeeSchema = z.object({
  role: z.string(),
  name: z.string(),
  joined_at: z.string()
});

export const PlanIssueStatusSchema = z.enum([
  "pending",
  "decided",
  // Legacy statuses — mapped to canonical on read (see PlanIssueSchema transform)
  "researching",
  "discussing",
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
    // Legacy fields — accepted on read but not written in new data
    discussion: z.array(PlanDiscussionRecordSchema).default([]).optional(),
    task_refs: z.array(z.number()).default([]).optional(),
    decision: z.string().optional(),
    summary: z.string().optional(),
    how_agents: z.array(z.string()).optional(),
    how_summary: z.record(z.string(), z.string()).optional(),
    how_agent_ids: z.record(z.string(), z.string()).optional()
  })
  .transform((issue) => ({
    ...issue,
    // Map legacy statuses to canonical values
    status: (issue.status === "tasked" ? "decided" : issue.status) as "pending" | "decided" | "researching" | "discussing" | "deferred"
  }));

export const PlanFileSchema = z.object({
  id: z.number(),
  topic: z.string(),
  // Legacy field — accepted on read but not written in new data
  attendees: z.array(PlanAttendeeSchema).default([]).optional(),
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

export const InvocationContinuitySchema = z
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

export const InvocationSchema = z.object({
  invocation_id: z.string(),
  agent_id: z.string().optional(),
  agent_type: z.string(),
  coordination_label: z.string().optional(),
  purpose: z.string().optional(),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  started_at: z.string(),
  updated_at: z.string().optional(),
  ended_at: z.string().optional(),
  resume_count: z.number().optional(),
  last_resumed_at: z.string().optional(),
  last_message: z.string().optional(),
  stopped_at: z.string().optional(),
  continuity: InvocationContinuitySchema.optional(),
  files_touched: z.array(z.string()).optional()
});

export const AgentTrackerSchema = z.object({
  harness_id: z.string(),
  started_at: z.string(),
  invocations: z.array(InvocationSchema).default([])
});

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

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskItem = z.infer<typeof TaskItemSchema>;
export type TasksFile = z.infer<typeof TasksFileSchema>;
export type PlanIssueStatus = z.infer<typeof PlanIssueStatusSchema>;
export type PlanDiscussionEntry = z.infer<typeof PlanDiscussionEntrySchema>;
export type PlanDiscussionKind = z.infer<typeof PlanDiscussionKindSchema>;
export type PlanFile = z.infer<typeof PlanFileSchema>;
export type PlanSidecar = z.infer<typeof PlanSidecarSchema>;
export type Invocation = z.infer<typeof InvocationSchema>;
export type AgentTracker = z.infer<typeof AgentTrackerSchema>;
export type InvocationLifecycleStatus = z.infer<typeof InvocationLifecycleStatusSchema>;
export type InvocationContinuityHandles = z.infer<typeof InvocationContinuityHandlesSchema>;

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
