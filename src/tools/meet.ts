import { tool } from "@opencode-ai/plugin";
import { appendHistory, nextMeetId } from "../shared/history";
import { createNexusPaths } from "../shared/paths";
import { readJsonFile, writeJsonFile } from "../shared/json-store";
import { fileExists } from "../shared/state";
import { MeetFileSchema, type MeetFile } from "../shared/schema";

const z = tool.schema;

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
        discussion: []
      })),
      research_summary: args.research_summary,
      created_at: now
    };

    MeetFileSchema.parse(meet);
    await writeJsonFile(paths.MEET_FILE, meet);
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

    const meet = MeetFileSchema.parse(await readJsonFile<MeetFile>(paths.MEET_FILE, {} as MeetFile));
    const issues = {
      total: meet.issues.length,
      pending: meet.issues.filter((i) => i.status === "pending").length,
      discussing: meet.issues.filter((i) => i.status === "discussing").length,
      decided: meet.issues.filter((i) => i.status === "decided").length
    };

    return JSON.stringify(
      {
        id: meet.id,
        topic: meet.topic,
        attendees: meet.attendees,
        issues
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
        discussion: []
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
    }

    await writeJsonFile(paths.MEET_FILE, meet);
    return `Meet updated (${args.action})`;
  }
});

export const nxMeetDiscuss = tool({
  description: "Append discussion to meet issue",
  args: {
    issue_id: z.string(),
    speaker: z.string(),
    message: z.string()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.MEET_FILE))) {
      throw new Error("No active meet session.");
    }
    const meet = MeetFileSchema.parse(await readJsonFile<MeetFile>(paths.MEET_FILE, {} as MeetFile));
    const issue = meet.issues.find((item) => item.id === args.issue_id);

    if (!issue) {
      throw new Error(`issue not found: ${args.issue_id}`);
    }

    const allowedSpeaker =
      args.speaker === "lead" ||
      args.speaker === "user" ||
      meet.attendees.some((attendee) => attendee.role.toLowerCase() === args.speaker.toLowerCase());

    if (!allowedSpeaker) {
      throw new Error(`speaker is not in attendees: ${args.speaker}`);
    }

    if (issue.status === "pending") {
      issue.status = "discussing";
    }

    issue.discussion.push(`[${args.speaker}] ${args.message}`);
    await writeJsonFile(paths.MEET_FILE, meet);

    return `Discussion recorded for ${args.issue_id}`;
  }
});

export const nxMeetDecide = tool({
  description: "Decide meet issue",
  args: {
    issue_id: z.string(),
    decision: z.string()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    if (!(await fileExists(paths.MEET_FILE))) {
      throw new Error("No active meet session.");
    }
    const meet = MeetFileSchema.parse(await readJsonFile<MeetFile>(paths.MEET_FILE, {} as MeetFile));
    const issue = meet.issues.find((item) => item.id === args.issue_id);

    if (!issue) {
      throw new Error(`issue not found: ${args.issue_id}`);
    }

    issue.status = "decided";
    issue.decision = args.decision;

    await writeJsonFile(paths.MEET_FILE, meet);

    const allDecided = meet.issues.every((item) => item.status === "decided");
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
    const meet = MeetFileSchema.parse(await readJsonFile<MeetFile>(paths.MEET_FILE, {} as MeetFile));

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

    return exists ? "Attendee already joined." : `Joined attendee ${args.role} (${args.name})`;
  }
});
