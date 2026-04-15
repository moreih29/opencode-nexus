import { tool } from "@opencode-ai/plugin";
import { appendHistory, nextPlanId } from "../shared/history.js";
import {
  readPlanParticipantContinuityFromCore,
  readPlanParticipantSnapshotFromCore,
  type PlanParticipantContinuity
} from "../orchestration/plan-continuity-adapter.js";
import { collectHowRolesFromPlan } from "../shared/plan-how-panel.js";
import { createNexusPaths } from "../shared/paths.js";
import { readJsonFile, updateJsonFileLocked } from "../shared/json-store.js";
import { fileExists } from "../shared/state.js";
import {
  PlanFileSchema,
  type PlanFile
} from "../shared/schema.js";

const z = tool.schema;

export const nxPlanStart = tool({
  description: "Start a plan session",
  args: {
    topic: z.string(),
    research_summary: z.string(),
    issues: z.array(z.string()).default([])
  },
  async execute(args, context) {
    if (!args.research_summary) {
      throw new Error("research_summary is required");
    }
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const plan = await updateJsonFileLocked<PlanFile | null>(paths.PLAN_FILE, null, async (existingRaw) => {
      const existingParsed = existingRaw ? PlanFileSchema.safeParse(existingRaw) : null;
      if (existingParsed?.success) {
        await appendHistory(paths.HISTORY_FILE, {
          completed_at: new Date().toISOString(),
          branch: "carry-over",
          plan: existingParsed.data
        });
      }

      const now = new Date().toISOString();
      const nextPlan: PlanFile = {
        id: await nextPlanId(paths.HISTORY_FILE),
        topic: args.topic,
        issues: Array.isArray(args.issues)
          ? args.issues.map((title, idx) => ({
              id: idx + 1,
              title,
              status: "pending" as const
            }))
          : [],
        research_summary: args.research_summary,
        created_at: now
      };

      return PlanFileSchema.parse(nextPlan);
    });

    if (!plan) {
      throw new Error("Failed to create plan session");
    }

    return JSON.stringify({ created: true, plan_id: plan.id, topic: args.topic, issueCount: plan.issues.length });
  }
});

export const nxPlanStatus = tool({
  description: "Get current plan status",
  args: {},
  async execute(_args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.PLAN_FILE))) {
      return JSON.stringify({ active: false });
    }

    const plan = await readPlan(paths.PLAN_FILE);
    const summary = summarizeIssues(plan);
    const panelRoles = collectHowRolesFromPlan(plan);
    const followupParticipants = await Promise.all(
      panelRoles.map(async (role) => ({
        role,
        participant: await readPlanParticipantSnapshotFromCore(paths.AGENT_TRACKER_FILE, role)
      }))
    );

    return JSON.stringify(
      {
        active: true,
        plan_id: plan.id,
        topic: plan.topic,
        issues: plan.issues,
        summary,
        research_summary: plan.research_summary,
        current_issue: pickCurrentIssue(plan),
        decided_ratio: `${summary.decided}/${summary.total}`,
        opencode: {
          handoff: "canonical-first",
          canonical_ready: true,
          how_panel_size: panelRoles.length,
          participants: followupParticipants.map(({ role, participant }) => ({
            role,
            task_id: participant?.task_id ?? null,
            session_id: participant?.session_id ?? null,
            has_continuity: Boolean(participant?.task_id || participant?.session_id || participant?.last_summary)
          })),
          followup_ready_roles: followupParticipants
            .filter((item) => item.participant?.task_id || item.participant?.session_id || item.participant?.last_summary)
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
    const coreParticipant = await readPlanParticipantContinuityFromCore(paths.AGENT_TRACKER_FILE, args.role);
    if (!coreParticipant) {
      return `No participant continuity found for ${args.role}.`;
    }

    const participant = mergeParticipantContinuity(args.role, coreParticipant);

    return JSON.stringify(
      {
        role: participant.role,
        strategy: "how-fixed-panel",
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
    const coreParticipant = await readPlanParticipantSnapshotFromCore(paths.AGENT_TRACKER_FILE, args.role);
    const plan = await readCanonicalFollowupPlan(paths.PLAN_FILE);
    const participant = mergeParticipantContinuity(args.role, coreParticipant);
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
    let result: Record<string, unknown> = {};
    await updateJsonFileLocked<PlanFile>(paths.PLAN_FILE, {} as PlanFile, (raw) => {
      const plan = PlanFileSchema.parse(raw);

      if (args.action === "add") {
        if (!args.title) {
          throw new Error("title is required for add");
        }
        const nextId = (plan.issues.length > 0 ? Math.max(...plan.issues.map((i) => i.id)) : 0) + 1;
        const added = {
          id: nextId,
          title: args.title,
          status: "pending" as const
        };
        plan.issues.push(added);
        result = { added: true, issue: { id: added.id, title: added.title, status: added.status } };
      }

      if (args.action === "remove") {
        if (!args.issue_id) {
          throw new Error("issue_id is required for remove");
        }
        const removed = plan.issues.find((item) => item.id === args.issue_id);
        if (!removed) {
          throw new Error(`Issue ${args.issue_id} not found`);
        }
        plan.issues = plan.issues.filter((issue) => issue.id !== args.issue_id);
        result = { removed: true, issue: { id: removed.id } };
      }

      if (args.action === "edit") {
        if (!args.issue_id || !args.title) {
          throw new Error("issue_id and title are required for edit");
        }
        const issue = plan.issues.find((item) => item.id === args.issue_id);
        if (!issue) {
          throw new Error(`Issue ${args.issue_id} not found`);
        }
        issue.title = args.title;
        result = { edited: true, issue: { id: issue.id, title: issue.title } };
      }

      if (args.action === "reopen") {
        if (!args.issue_id) {
          throw new Error("issue_id is required for reopen");
        }
        const issue = plan.issues.find((item) => item.id === args.issue_id);
        if (!issue) {
          throw new Error(`Issue ${args.issue_id} not found`);
        }
        issue.status = "pending";
        issue.decision = undefined;
        issue.summary = undefined;
        result = { reopened: true, issue: { id: issue.id, status: issue.status } };
      }

      return plan;
    });

    return JSON.stringify(result);
  }
});

export const nxPlanDecide = tool({
  description: "Decide plan issue",
  args: {
    issue_id: z.number(),
    decision: z.string(),
    how_agents: z.array(z.string()).optional(),
    how_summary: z.record(z.string(), z.string()).optional(),
    how_agent_ids: z.record(z.string(), z.string()).optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.PLAN_FILE))) {
      throw new Error("No active plan session");
    }
    let remaining: number[] = [];
    let allDecided = false;

    await updateJsonFileLocked<PlanFile>(paths.PLAN_FILE, {} as PlanFile, (raw) => {
      const plan = PlanFileSchema.parse(raw);
      const issue = plan.issues.find((item) => item.id === args.issue_id);

      if (!issue) {
        throw new Error(`issue not found: ${args.issue_id}`);
      }

      issue.status = "decided";
      issue.decision = args.decision;
      if (args.how_agents !== undefined) issue.how_agents = args.how_agents;
      if (args.how_summary !== undefined) issue.how_summary = args.how_summary;
      if (args.how_agent_ids !== undefined) issue.how_agent_ids = args.how_agent_ids;

      allDecided = plan.issues.every((item) => item.status === "decided");
      remaining = plan.issues.filter((i) => i.status === "pending").map((i) => i.id);
      return plan;
    });

    return JSON.stringify({
      decided: true,
      allComplete: allDecided,
      remaining
    });
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

function mergeParticipantContinuity(
  role: string,
  coreParticipant: PlanParticipantContinuity | null
) {
  const task_id = coreParticipant?.task_id ?? null;
  const session_id = coreParticipant?.session_id ?? null;
  const coreSummary = coreParticipant?.last_summary?.trim() ? coreParticipant.last_summary : null;
  const source = coreParticipant ? coreParticipant.source : "none";

  return {
    role: coreParticipant?.role ?? role,
    task_id,
    session_id,
    last_summary: coreSummary,
    updated_at: coreParticipant?.updated_at ?? null,
    source,
    resumable: Boolean(task_id || session_id)
  };
}

function emptyPlan(): PlanFile {
  return {
    id: 0,
    topic: "",
    issues: [],
    created_at: new Date(0).toISOString()
  };
}

function summarizeIssues(plan: PlanFile) {
  const summary = {
    total: plan.issues.length,
    pending: 0,
    decided: 0
  };

  for (const issue of plan.issues) {
    if (issue.status === "decided") {
      summary.decided += 1;
    } else {
      summary.pending += 1;
    }
  }

  return summary;
}

function pickCurrentIssue(plan: PlanFile) {
  const issue = plan.issues.find((item) => item.status === "pending") ?? null;

  if (!issue) {
    return null;
  }

  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    has_decision: Boolean(issue.decision)
  };
}
