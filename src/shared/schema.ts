import { z } from "zod";

export const TaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "blocked"
]);

export const TaskItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  owner: z.string().optional(),
  meet_issue: z.string().optional(),
  deps: z.array(z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string()
});

export const TasksFileSchema = z.object({
  tasks: z.array(TaskItemSchema)
});

export const MeetAttendeeSchema = z.object({
  role: z.string(),
  name: z.string(),
  joined_at: z.string()
});

export const MeetIssueStatusSchema = z.enum([
  "pending",
  "researching",
  "discussing",
  "decided",
  "deferred",
  "tasked"
]);

export const MeetDiscussionKindSchema = z.enum([
  "research",
  "discussion",
  "summary",
  "decision",
  "risk"
]);

export const MeetDiscussionEntrySchema = z.object({
  speaker: z.string(),
  message: z.string(),
  kind: MeetDiscussionKindSchema.default("discussion"),
  recorded_at: z.string()
});

const MeetDiscussionRecordSchema = z
  .union([MeetDiscussionEntrySchema, z.string()])
  .transform((entry) => normalizeDiscussionEntry(entry));

export const MeetIssueSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: MeetIssueStatusSchema,
    discussion: z.array(MeetDiscussionRecordSchema).default([]),
    decision: z.string().optional(),
    summary: z.string().optional(),
    task_refs: z.array(z.string()).default([])
  })
  .transform((issue) => ({
    ...issue,
    task_refs: issue.task_refs ?? [],
    discussion: issue.discussion ?? []
  }));

export const MeetFileSchema = z.object({
  id: z.number(),
  topic: z.string(),
  attendees: z.array(MeetAttendeeSchema),
  issues: z.array(MeetIssueSchema),
  research_summary: z.string().optional(),
  created_at: z.string()
});

export const MeetPanelParticipantSchema = z.object({
  role: z.string(),
  session_id: z.string().optional(),
  task_id: z.string().optional(),
  last_summary: z.string().optional(),
  updated_at: z.string()
});

export const MeetSidecarSchema = z.object({
  schema_version: z.literal(1),
  canonical_file: z.literal("meet.json"),
  platform: z.literal("opencode"),
  handoff: z.object({
    policy: z.literal("canonical-first"),
    canonical_ready: z.boolean(),
    updated_at: z.string()
  }),
  panel: z.object({
    strategy: z.literal("how-fixed-panel"),
    participants: z.array(MeetPanelParticipantSchema)
  })
});

export const AgentTrackerItemSchema = z.object({
  agent_type: z.string(),
  state: z.enum(["team-spawning", "running", "completed"]),
  team_name: z.string().optional(),
  coordination_label: z.string().optional(),
  lead_agent: z.string().optional(),
  purpose: z.string().optional(),
  agent_id: z.string().optional(),
  started_at: z.string(),
  stopped_at: z.string().optional(),
  last_message: z.string().optional()
});

export const AgentTrackerSchema = z.array(AgentTrackerItemSchema);

export const RunPhaseSchema = z.enum(["intake", "design", "execute", "verify", "complete"]);

export const RunStateSchema = z.object({
  phase: RunPhaseSchema,
  updated_at: z.string(),
  reason: z.string().optional()
});

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskItem = z.infer<typeof TaskItemSchema>;
export type TasksFile = z.infer<typeof TasksFileSchema>;
export type MeetIssueStatus = z.infer<typeof MeetIssueStatusSchema>;
export type MeetDiscussionEntry = z.infer<typeof MeetDiscussionEntrySchema>;
export type MeetDiscussionKind = z.infer<typeof MeetDiscussionKindSchema>;
export type MeetFile = z.infer<typeof MeetFileSchema>;
export type MeetSidecar = z.infer<typeof MeetSidecarSchema>;
export type AgentTrackerItem = z.infer<typeof AgentTrackerItemSchema>;
export type RunPhase = z.infer<typeof RunPhaseSchema>;
export type RunState = z.infer<typeof RunStateSchema>;

function normalizeDiscussionEntry(entry: string | MeetDiscussionEntry): MeetDiscussionEntry {
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
