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

export const MeetIssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["pending", "discussing", "decided"]),
  discussion: z.array(z.string()).default([]),
  decision: z.string().optional()
});

export const MeetFileSchema = z.object({
  id: z.number(),
  topic: z.string(),
  attendees: z.array(MeetAttendeeSchema),
  issues: z.array(MeetIssueSchema),
  research_summary: z.string().optional(),
  created_at: z.string()
});

export const AgentTrackerItemSchema = z.object({
  agent_type: z.string(),
  state: z.enum(["team-spawning", "running", "completed"]),
  team_name: z.string().optional(),
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
export type MeetFile = z.infer<typeof MeetFileSchema>;
export type AgentTrackerItem = z.infer<typeof AgentTrackerItemSchema>;
export type RunPhase = z.infer<typeof RunPhaseSchema>;
export type RunState = z.infer<typeof RunStateSchema>;
