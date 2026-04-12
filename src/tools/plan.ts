import { tool } from "@opencode-ai/plugin";
import { appendHistory, nextPlanId } from "../shared/history.js";
import { readPlanParticipantContinuityFromCore, type PlanParticipantContinuity } from "../orchestration/plan-continuity-adapter.js";
import { createNexusPaths } from "../shared/paths.js";
import { readJsonFile, writeJsonFile } from "../shared/json-store.js";
import { readPlanSidecar, summarizePlanSidecar, syncPlanSidecar } from "../shared/plan-sidecar.js";
import { fileExists } from "../shared/state.js";
import {
  PlanFileSchema,
  type PlanFile,
  type PlanDiscussionKind,
  type PlanIssueStatus
} from "../shared/schema.js";

const z = tool.schema;
const PLAN_DISCUSSION_KINDS = ["research", "discussion", "summary", "decision", "risk"] as const;

export const nxPlanStart = tool({
  description: "Start a plan session",
  args: {
    topic: z.string(),
    research_summary: z.string(),
    attendees: z
      .array(
        z.object({
          role: z.string(),
          name: z.string()
        })
      )
      .default([]),
    issues: z.array(z.string()).default([])
  },
  async execute(args, context) {
    if (!args.research_summary) {
      throw new Error("research_summary is required");
    }
    const paths = createNexusPaths(context.worktree ?? context.directory);

    if (await fileExists(paths.PLAN_FILE)) {
      const existing = await readJsonFile<PlanFile | null>(paths.PLAN_FILE, null);
      if (existing) {
        await appendHistory(paths.HISTORY_FILE, {
          completed_at: new Date().toISOString(),
          branch: "carry-over",
          plan: existing
        });
      }
    }

    const now = new Date().toISOString();
    const plan: PlanFile = {
      id: await nextPlanId(paths.HISTORY_FILE),
      topic: args.topic,
      attendees: (args.attendees ?? []).map((a) => ({ ...a, joined_at: now })),
      issues: (args.issues ?? []).map((title, idx) => ({
        id: idx + 1,
        title,
        status: "pending",
        discussion: [],
        task_refs: []
      })),
      research_summary: args.research_summary,
      created_at: now
    };

    PlanFileSchema.parse(plan);
    await writeJsonFile(paths.PLAN_FILE, plan);
    await syncPlanSidecar(paths.PLAN_SIDECAR_FILE, plan);
    return JSON.stringify({ created: true, plan_id: plan.id, topic: args.topic, issueCount: plan.issues.length });
  }
});

export const nxPlanStatus = tool({
  description: "Get current plan status",
  args: {},
  async execute(_args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.PLAN_FILE))) {
      return "No active plan session";
    }

    const plan = await readPlan(paths.PLAN_FILE);
    const issues = summarizeIssues(plan);
    const sidecar = await readPlanSidecar(paths.PLAN_SIDECAR_FILE);
    const followupParticipants = sidecar
      ? await Promise.all(
          sidecar.panel.participants.map(async (item) =>
            mergeParticipantContinuity(
              item.role,
              await readPlanParticipantContinuityFromCore(paths.ORCHESTRATION_CORE_FILE, item.role),
              {
                role: item.role,
                task_id: item.task_id ?? null,
                session_id: item.session_id ?? null,
                last_summary: item.last_summary ?? null,
                updated_at: item.updated_at,
                source: "plan-sidecar"
              }
            )
          )
        )
      : [];

    return JSON.stringify(
      {
        id: plan.id,
        topic: plan.topic,
        attendees: plan.attendees,
        issues,
        current_issue: pickCurrentIssue(plan),
        decided_ratio: `${issues.decided + issues.tasked}/${issues.total}`,
        opencode: {
          ...summarizePlanSidecar(sidecar),
          followup_ready_roles: followupParticipants
            .filter((item) => item.resumable || item.last_summary)
            .map((item) => item.role)
        }
      },
      null,
      2
    );
  }
});

export const nxPlanResume = tool({
  description: "Get HOW participant resume routing info",
  args: {
    role: z.string(),
    question: z.string().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const coreParticipant = await readPlanParticipantContinuityFromCore(paths.ORCHESTRATION_CORE_FILE, args.role);
    const sidecar = await readPlanSidecar(paths.PLAN_SIDECAR_FILE);
    const sidecarParticipant = pickParticipantFromSidecar(sidecar, args.role);
    if (!coreParticipant && !sidecar) {
      return "No OpenCode plan sidecar available.";
    }

    if (!coreParticipant) {
      return `No participant continuity found for ${args.role}.`;
    }

    const participant = mergeParticipantContinuity(args.role, coreParticipant, sidecarParticipant);

    return JSON.stringify(
      {
        role: participant.role,
        strategy: sidecar?.panel.strategy ?? "how-fixed-panel",
        task_id: participant.task_id ?? null,
        session_id: participant.session_id ?? null,
        opencode_task_tool_resume_handle: participant.session_id ?? null,
        last_summary: participant.last_summary ?? null,
        updated_at: participant.updated_at,
        continuity_source: participant.source,
        resumable: participant.resumable,
        recommendation: buildResumeRecommendation(participant, args.question)
      },
      null,
      2
    );
  }
});

export const nxPlanFollowup = tool({
  description: "Build delegation-ready HOW follow-up guidance",
  args: {
    role: z.string(),
    question: z.string(),
    issue_id: z.number().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const sidecar = await readPlanSidecar(paths.PLAN_SIDECAR_FILE);
    const coreParticipant = await readPlanParticipantContinuityFromCore(paths.ORCHESTRATION_CORE_FILE, args.role);
    const plan = await readCanonicalFollowupPlan(paths.PLAN_FILE);
    const participant = mergeParticipantContinuity(args.role, coreParticipant, pickParticipantFromSidecar(sidecar, args.role));
    const recommendation = buildResumeRecommendation(participant ?? { role: args.role }, args.question);
    const issue = args.issue_id
      ? plan?.issues.find((item) => item.id === args.issue_id) ?? null
      : pickCurrentIssue(plan ?? emptyPlan());

    return JSON.stringify(
      {
        role: args.role,
        question: args.question,
        issue: issue
          ? {
              id: issue.id,
              title: issue.title,
              status: issue.status
            }
          : null,
        recommendation,
        continuity_source: participant?.source ?? "none",
        delegation: {
          subagent_type: args.role.toLowerCase(),
          team_name: "plan-panel",
          description: args.question,
          resume_task_id: recommendation.suggested_task_id,
          resume_session_id: recommendation.suggested_session_id,
          opencode_task_tool_resume_handle: recommendation.suggested_session_id,
          prompt: recommendation.suggested_prompt
        }
      },
      null,
      2
    );
  }
});

export const nxPlanUpdate = tool({
  description: "Update plan issues",
  args: {
    action: z.enum(["add", "remove", "edit", "reopen"]),
    issue_id: z.number().optional(),
    title: z.string().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.PLAN_FILE))) {
      throw new Error("No active plan session");
    }
    const plan = PlanFileSchema.parse(await readJsonFile<PlanFile>(paths.PLAN_FILE, {} as PlanFile));

    if (args.action === "add") {
      if (!args.title) {
        throw new Error("title is required for add");
      }
      const nextId = (plan.issues.length > 0 ? Math.max(...plan.issues.map(i => i.id)) : 0) + 1;
      plan.issues.push({
        id: nextId,
        title: args.title,
        status: "pending",
        discussion: [],
        task_refs: []
      });
    }

    if (args.action === "remove") {
      if (!args.issue_id) {
        throw new Error("issue_id is required for remove");
      }
      plan.issues = plan.issues.filter((issue) => issue.id !== args.issue_id);
    }

    if (args.action === "edit") {
      if (!args.issue_id || !args.title) {
        throw new Error("issue_id and title are required for edit");
      }
      const issue = plan.issues.find((item) => item.id === args.issue_id);
      if (!issue) {
        throw new Error(`issue not found: ${args.issue_id}`);
      }
      issue.title = args.title;
    }

    if (args.action === "reopen") {
      if (!args.issue_id) {
        throw new Error("issue_id is required for reopen");
      }
      const issue = plan.issues.find((item) => item.id === args.issue_id);
      if (!issue) {
        throw new Error(`issue not found: ${args.issue_id}`);
      }
      issue.status = "pending";
      issue.decision = undefined;
      issue.summary = undefined;
      issue.task_refs = [];
    }

    await writeJsonFile(paths.PLAN_FILE, plan);
    await syncPlanSidecar(paths.PLAN_SIDECAR_FILE, plan);
    return `Plan updated (${args.action})`;
  }
});

export const nxPlanDiscuss = tool({
  description: "Append discussion to plan issue",
  args: {
    issue_id: z.number(),
    speaker: z.string(),
    message: z.string(),
    kind: z.enum(PLAN_DISCUSSION_KINDS).optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.PLAN_FILE))) {
      throw new Error("No active plan session");
    }
    const plan = await readPlan(paths.PLAN_FILE);
    const issue = plan.issues.find((item) => item.id === args.issue_id);

    if (!issue) {
      throw new Error(`issue not found: ${args.issue_id}`);
    }

    const speaker = args.speaker;
    const message = args.message;
    const kind = (args.kind ?? "discussion") as PlanDiscussionKind;

    const allowedSpeaker =
      speaker === "lead" ||
      speaker === "user" ||
      plan.attendees.some((attendee) => attendee.role.toLowerCase() === speaker.toLowerCase());

    if (!allowedSpeaker) {
      throw new Error(`speaker is not in attendees: ${speaker}`);
    }

    issue.status = nextIssueStatus(issue.status, kind);
    issue.discussion.push({
      speaker,
      message,
      kind,
      recorded_at: new Date().toISOString()
    });
    await writeJsonFile(paths.PLAN_FILE, plan);
    await syncPlanSidecar(paths.PLAN_SIDECAR_FILE, plan, { speaker, message });

    return `Discussion recorded for ${args.issue_id} (${kind})`;
  }
});

export const nxPlanDecide = tool({
  description: "Decide plan issue",
  args: {
    issue_id: z.number(),
    decision: z.string(),
    summary: z.string().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.PLAN_FILE))) {
      throw new Error("No active plan session");
    }
    const plan = await readPlan(paths.PLAN_FILE);
    const issue = plan.issues.find((item) => item.id === args.issue_id);

    if (!issue) {
      throw new Error(`issue not found: ${args.issue_id}`);
    }

    issue.status = issue.task_refs.length > 0 ? "tasked" : "decided";
    issue.decision = args.decision;
    issue.summary = args.summary;
    issue.discussion.push({
      speaker: "lead",
      message: args.decision,
      kind: "decision",
      recorded_at: new Date().toISOString()
    });

    await writeJsonFile(paths.PLAN_FILE, plan);
    await syncPlanSidecar(paths.PLAN_SIDECAR_FILE, plan, { speaker: "lead", message: args.summary ?? args.decision });

    const allDecided = plan.issues.every((item) => item.status === "decided" || item.status === "tasked");
    return JSON.stringify({
      decided: true,
      allComplete: allDecided,
      remaining: plan.issues.filter((i) => i.status === "pending").map((i) => i.id)
    });
  }
});

export const nxPlanJoin = tool({
  description: "Join attendee to active plan",
  args: {
    role: z.string(),
    name: z.string()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.PLAN_FILE))) {
      throw new Error("No active plan session");
    }
    const plan = await readPlan(paths.PLAN_FILE);

    const exists = plan.attendees.some(
      (a) => a.role.toLowerCase() === args.role.toLowerCase() && a.name.toLowerCase() === args.name.toLowerCase()
    );
    if (!exists) {
      plan.attendees.push({
        role: args.role,
        name: args.name,
        joined_at: new Date().toISOString()
      });
      await writeJsonFile(paths.PLAN_FILE, plan);
    }

    await syncPlanSidecar(paths.PLAN_SIDECAR_FILE, plan);

    return exists ? "Attendee already joined." : `Joined attendee ${args.role} (${args.name})`;
  }
});

async function readPlan(filePath: string): Promise<PlanFile> {
  return PlanFileSchema.parse(await readJsonFile<PlanFile>(filePath, {} as PlanFile));
}

async function readCanonicalFollowupPlan(filePath: string): Promise<PlanFile | null> {
  const raw = await readJsonFile<PlanFile | null>(filePath, null);
  if (!raw) {
    return null;
  }
  return PlanFileSchema.parse(raw);
}

function buildResumeRecommendation(
  participant: { role: string; task_id?: string | null; session_id?: string | null; last_summary?: string | null },
  question?: string
) {
  const resumable = Boolean(participant.task_id || participant.session_id);
  const followUp = question?.trim() || `Follow up with ${participant.role} on the current discussion.`;

  return {
    mode: resumable ? "resume-existing" : "rehydrate-from-summary",
    suggested_role: participant.role,
    suggested_task_id: participant.task_id ?? null,
    suggested_session_id: participant.session_id ?? null,
    briefing_seed: participant.last_summary ?? null,
    suggested_prompt: resumable
      ? `Resume the existing ${participant.role} participant and continue this follow-up: ${followUp}`
      : `Rehydrate the ${participant.role} participant from the last summary and continue this follow-up: ${followUp}`
  };
}

function pickParticipantFromSidecar(
  sidecar: Awaited<ReturnType<typeof readPlanSidecar>>,
  role: string
): PlanParticipantContinuity | null {
  if (!sidecar) {
    return null;
  }
  const participant = sidecar.panel.participants.find((item) => item.role.toLowerCase() === role.toLowerCase());
  if (!participant) {
    return null;
  }
  return {
    role: participant.role,
    task_id: participant.task_id ?? null,
    session_id: participant.session_id ?? null,
    last_summary: participant.last_summary ?? null,
    updated_at: participant.updated_at,
    source: "plan-sidecar"
  };
}

function mergeParticipantContinuity(
  role: string,
  coreParticipant: PlanParticipantContinuity | null,
  sidecarParticipant: PlanParticipantContinuity | null
) {
  const task_id = coreParticipant?.task_id ?? null;
  const session_id = coreParticipant?.session_id ?? null;
  const sidecarSummary = sidecarParticipant?.last_summary?.trim() ? sidecarParticipant.last_summary : null;
  const source = coreParticipant ? coreParticipant.source : sidecarSummary ? "plan-sidecar" : "none";

  return {
    role: coreParticipant?.role ?? sidecarParticipant?.role ?? role,
    task_id,
    session_id,
    last_summary: coreParticipant?.last_summary ?? sidecarSummary,
    updated_at: coreParticipant?.updated_at ?? (source === "plan-sidecar" ? sidecarParticipant?.updated_at ?? null : null),
    source,
    resumable: Boolean(task_id || session_id)
  };
}

function emptyPlan(): PlanFile {
  return {
    id: 0,
    topic: "",
    attendees: [],
    issues: [],
    created_at: new Date(0).toISOString()
  };
}

function summarizeIssues(plan: PlanFile) {
  const summary = {
    total: plan.issues.length,
    pending: 0,
    researching: 0,
    discussing: 0,
    decided: 0,
    deferred: 0,
    tasked: 0
  } satisfies Record<PlanIssueStatus | "total", number>;

  for (const issue of plan.issues) {
    summary[issue.status] += 1;
  }

  return summary;
}

function pickCurrentIssue(plan: PlanFile) {
  const issue = plan.issues.find((item) => item.status === "researching" || item.status === "discussing")
    ?? plan.issues.find((item) => item.status === "pending" || item.status === "deferred")
    ?? null;

  if (!issue) {
    return null;
  }

  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    task_refs: issue.task_refs,
    has_decision: Boolean(issue.decision)
  };
}

function nextIssueStatus(current: PlanIssueStatus, kind: PlanDiscussionKind): PlanIssueStatus {
  if (current === "decided" || current === "tasked") {
    return current;
  }

  if (kind === "research") {
    return current === "pending" || current === "deferred" ? "researching" : current;
  }

  return "discussing";
}
