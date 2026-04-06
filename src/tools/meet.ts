import { tool } from "@opencode-ai/plugin";
import { appendHistory, nextMeetId } from "../shared/history.js";
import { readMeetParticipantContinuityFromCore, type MeetParticipantContinuity } from "../orchestration/meet-continuity-adapter.js";
import { createNexusPaths } from "../shared/paths.js";
import { readJsonFile, writeJsonFile } from "../shared/json-store.js";
import { readMeetSidecar, summarizeMeetSidecar, syncMeetSidecar } from "../shared/meet-sidecar.js";
import { fileExists } from "../shared/state.js";
import {
  MeetFileSchema,
  type MeetFile,
  type MeetDiscussionKind,
  type MeetIssueStatus
} from "../shared/schema.js";

const z = tool.schema;
const MEET_DISCUSSION_KINDS = ["research", "discussion", "summary", "decision", "risk"] as const;

export const nxMeetStart = tool({
  description: "Start a meet session",
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
    const paths = createNexusPaths(context.worktree ?? context.directory);

    if (await fileExists(paths.MEET_FILE)) {
      const existing = await readJsonFile<MeetFile | null>(paths.MEET_FILE, null);
      if (existing) {
        await appendHistory(paths.HISTORY_FILE, {
          completed_at: new Date().toISOString(),
          branch: "carry-over",
          meet: existing
        });
      }
    }

    const now = new Date().toISOString();
    const meet: MeetFile = {
      id: await nextMeetId(paths.HISTORY_FILE),
      topic: args.topic,
      attendees: args.attendees.map((a) => ({ ...a, joined_at: now })),
      issues: args.issues.map((title, idx) => ({
        id: `issue-${idx + 1}`,
        title,
        status: "pending",
        discussion: [],
        task_refs: []
      })),
      research_summary: args.research_summary,
      created_at: now
    };

    MeetFileSchema.parse(meet);
    await writeJsonFile(paths.MEET_FILE, meet);
    await syncMeetSidecar(paths.MEET_SIDECAR_FILE, meet);
    return `Meet started: ${args.topic} (#${meet.id})`;
  }
});

export const nxMeetStatus = tool({
  description: "Get current meet status",
  args: {},
  async execute(_args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.MEET_FILE))) {
      return "No active meet session.";
    }

    const meet = await readMeet(paths.MEET_FILE);
    const issues = summarizeIssues(meet);
    const sidecar = await readMeetSidecar(paths.MEET_SIDECAR_FILE);
    const followupParticipants = sidecar
      ? await Promise.all(
          sidecar.panel.participants.map(async (item) =>
            mergeParticipantContinuity(
              item.role,
              await readMeetParticipantContinuityFromCore(paths.ORCHESTRATION_CORE_FILE, item.role),
              {
                role: item.role,
                task_id: item.task_id ?? null,
                session_id: item.session_id ?? null,
                last_summary: item.last_summary ?? null,
                updated_at: item.updated_at,
                source: "meet-sidecar"
              }
            )
          )
        )
      : [];

    return JSON.stringify(
      {
        id: meet.id,
        topic: meet.topic,
        attendees: meet.attendees,
        issues,
        current_issue: pickCurrentIssue(meet),
        decided_ratio: `${issues.decided + issues.tasked}/${issues.total}`,
        opencode: {
          ...summarizeMeetSidecar(sidecar),
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

export const nxMeetResume = tool({
  description: "Get HOW participant resume routing info",
  args: {
    role: z.string(),
    question: z.string().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const coreParticipant = await readMeetParticipantContinuityFromCore(paths.ORCHESTRATION_CORE_FILE, args.role);
    const sidecar = await readMeetSidecar(paths.MEET_SIDECAR_FILE);
    const sidecarParticipant = pickParticipantFromSidecar(sidecar, args.role);
    if (!coreParticipant && !sidecar) {
      return "No OpenCode meet sidecar available.";
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

export const nxMeetFollowup = tool({
  description: "Build delegation-ready HOW follow-up guidance",
  args: {
    role: z.string(),
    question: z.string(),
    issue_id: z.string().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const sidecar = await readMeetSidecar(paths.MEET_SIDECAR_FILE);
    const coreParticipant = await readMeetParticipantContinuityFromCore(paths.ORCHESTRATION_CORE_FILE, args.role);
    const meet = await readCanonicalFollowupMeet(paths.MEET_FILE);
    const participant = mergeParticipantContinuity(args.role, coreParticipant, pickParticipantFromSidecar(sidecar, args.role));
    const recommendation = buildResumeRecommendation(participant ?? { role: args.role }, args.question);
    const issue = args.issue_id
      ? meet?.issues.find((item) => item.id === args.issue_id) ?? null
      : pickCurrentIssue(meet ?? emptyMeet());

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
          team_name: "meet-panel",
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

export const nxMeetUpdate = tool({
  description: "Update meet issues",
  args: {
    action: z.enum(["add", "remove", "edit", "reopen"]),
    issue_id: z.string().optional(),
    title: z.string().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.MEET_FILE))) {
      throw new Error("No active meet session.");
    }
    const meet = MeetFileSchema.parse(await readJsonFile<MeetFile>(paths.MEET_FILE, {} as MeetFile));

    if (args.action === "add") {
      if (!args.title) {
        throw new Error("title is required for add");
      }
      meet.issues.push({
        id: `issue-${meet.issues.length + 1}`,
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
      meet.issues = meet.issues.filter((issue) => issue.id !== args.issue_id);
    }

    if (args.action === "edit") {
      if (!args.issue_id || !args.title) {
        throw new Error("issue_id and title are required for edit");
      }
      const issue = meet.issues.find((item) => item.id === args.issue_id);
      if (!issue) {
        throw new Error(`issue not found: ${args.issue_id}`);
      }
      issue.title = args.title;
    }

    if (args.action === "reopen") {
      if (!args.issue_id) {
        throw new Error("issue_id is required for reopen");
      }
      const issue = meet.issues.find((item) => item.id === args.issue_id);
      if (!issue) {
        throw new Error(`issue not found: ${args.issue_id}`);
      }
      issue.status = "pending";
      issue.decision = undefined;
      issue.summary = undefined;
      issue.task_refs = [];
    }

    await writeJsonFile(paths.MEET_FILE, meet);
    await syncMeetSidecar(paths.MEET_SIDECAR_FILE, meet);
    return `Meet updated (${args.action})`;
  }
});

export const nxMeetDiscuss = tool({
  description: "Append discussion to meet issue",
  args: {
    issue_id: z.string(),
    speaker: z.string(),
    message: z.string(),
    kind: z.enum(MEET_DISCUSSION_KINDS).optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.MEET_FILE))) {
      throw new Error("No active meet session.");
    }
    const meet = await readMeet(paths.MEET_FILE);
    const issue = meet.issues.find((item) => item.id === args.issue_id);

    if (!issue) {
      throw new Error(`issue not found: ${args.issue_id}`);
    }

    const speaker = args.speaker;
    const message = args.message;
    const kind = (args.kind ?? "discussion") as MeetDiscussionKind;

    const allowedSpeaker =
      speaker === "lead" ||
      speaker === "user" ||
      meet.attendees.some((attendee) => attendee.role.toLowerCase() === speaker.toLowerCase());

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
    await writeJsonFile(paths.MEET_FILE, meet);
    await syncMeetSidecar(paths.MEET_SIDECAR_FILE, meet, { speaker, message });

    return `Discussion recorded for ${args.issue_id} (${kind})`;
  }
});

export const nxMeetDecide = tool({
  description: "Decide meet issue",
  args: {
    issue_id: z.string(),
    decision: z.string(),
    summary: z.string().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.MEET_FILE))) {
      throw new Error("No active meet session.");
    }
    const meet = await readMeet(paths.MEET_FILE);
    const issue = meet.issues.find((item) => item.id === args.issue_id);

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

    await writeJsonFile(paths.MEET_FILE, meet);
    await syncMeetSidecar(paths.MEET_SIDECAR_FILE, meet, { speaker: "lead", message: args.summary ?? args.decision });

    const allDecided = meet.issues.every((item) => item.status === "decided" || item.status === "tasked");
    return allDecided
      ? `Decision recorded for ${args.issue_id}. All issues decided. You can move to [run] or [rule].`
      : `Decision recorded for ${args.issue_id}`;
  }
});

export const nxMeetJoin = tool({
  description: "Join attendee to active meet",
  args: {
    role: z.string(),
    name: z.string()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.MEET_FILE))) {
      throw new Error("No active meet session.");
    }
    const meet = await readMeet(paths.MEET_FILE);

    const exists = meet.attendees.some(
      (a) => a.role.toLowerCase() === args.role.toLowerCase() && a.name.toLowerCase() === args.name.toLowerCase()
    );
    if (!exists) {
      meet.attendees.push({
        role: args.role,
        name: args.name,
        joined_at: new Date().toISOString()
      });
      await writeJsonFile(paths.MEET_FILE, meet);
    }

    await syncMeetSidecar(paths.MEET_SIDECAR_FILE, meet);

    return exists ? "Attendee already joined." : `Joined attendee ${args.role} (${args.name})`;
  }
});

async function readMeet(filePath: string): Promise<MeetFile> {
  return MeetFileSchema.parse(await readJsonFile<MeetFile>(filePath, {} as MeetFile));
}

async function readCanonicalFollowupMeet(filePath: string): Promise<MeetFile | null> {
  const raw = await readJsonFile<MeetFile | null>(filePath, null);
  if (!raw) {
    return null;
  }
  return MeetFileSchema.parse(raw);
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
  sidecar: Awaited<ReturnType<typeof readMeetSidecar>>,
  role: string
): MeetParticipantContinuity | null {
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
    source: "meet-sidecar"
  };
}

function mergeParticipantContinuity(
  role: string,
  coreParticipant: MeetParticipantContinuity | null,
  sidecarParticipant: MeetParticipantContinuity | null
) {
  const task_id = coreParticipant?.task_id ?? null;
  const session_id = coreParticipant?.session_id ?? null;
  const sidecarSummary = sidecarParticipant?.last_summary?.trim() ? sidecarParticipant.last_summary : null;
  const source = coreParticipant ? coreParticipant.source : sidecarSummary ? "meet-sidecar" : "none";

  return {
    role: coreParticipant?.role ?? sidecarParticipant?.role ?? role,
    task_id,
    session_id,
    last_summary: coreParticipant?.last_summary ?? sidecarSummary,
    updated_at: coreParticipant?.updated_at ?? (source === "meet-sidecar" ? sidecarParticipant?.updated_at ?? null : null),
    source,
    resumable: Boolean(task_id || session_id)
  };
}

function emptyMeet(): MeetFile {
  return {
    id: 0,
    topic: "",
    attendees: [],
    issues: [],
    created_at: new Date(0).toISOString()
  };
}

function summarizeIssues(meet: MeetFile) {
  const summary = {
    total: meet.issues.length,
    pending: 0,
    researching: 0,
    discussing: 0,
    decided: 0,
    deferred: 0,
    tasked: 0
  } satisfies Record<MeetIssueStatus | "total", number>;

  for (const issue of meet.issues) {
    summary[issue.status] += 1;
  }

  return summary;
}

function pickCurrentIssue(meet: MeetFile) {
  const issue = meet.issues.find((item) => item.status === "researching" || item.status === "discussing")
    ?? meet.issues.find((item) => item.status === "pending" || item.status === "deferred")
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

function nextIssueStatus(current: MeetIssueStatus, kind: MeetDiscussionKind): MeetIssueStatus {
  if (current === "decided" || current === "tasked") {
    return current;
  }

  if (kind === "research") {
    return current === "pending" || current === "deferred" ? "researching" : current;
  }

  return "discussing";
}
