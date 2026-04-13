import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { createNexusPaths } from "../shared/paths.js";
import { readJsonFile } from "../shared/json-store.js";
import { matchesHint } from "../shared/markdown.js";

const z = tool.schema;

export const nxBriefing = tool({
  description: "Build role-based briefing from Nexus knowledge",
  args: {
    role: z.string(),
    hint: z.string().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const role = args.role.trim().toLowerCase();

    const sections: string[] = [];

    const decisions = await readLatestDecisions(paths.HISTORY_FILE);
    if (decisions.length > 0) {
      sections.push("## Decisions\n" + decisions.map((d) => `- ${d}`).join("\n"));
    }

    const rules = await readMarkdownDir(paths.RULES_ROOT, args.hint);
    if (rules.length > 0) {
      sections.push("## Rules\n" + rules.join("\n\n"));
    }

    const contextDocs = await readMarkdownDir(paths.CONTEXT_ROOT, args.hint);
    if (contextDocs.length > 0) {
      sections.push("## Context\n" + contextDocs.join("\n\n"));
    }

    const memoryDocs = await readMarkdownDir(paths.MEMORY_ROOT, args.hint);
    if (memoryDocs.length > 0) {
      sections.push("## Memory\n" + memoryDocs.join("\n\n"));
    }

    if (sections.length === 0) {
      return "No matching briefing content found.";
    }

    return `# Briefing for ${role}\n\n${sections.join("\n\n")}`;
  }
});

async function readMarkdownDir(dir: string, hint?: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort();

    const docs: string[] = [];
    for (const file of files) {
      const content = await fs.readFile(path.join(dir, file), "utf8");
      if (!matchesHint(content, hint)) {
        continue;
      }
      docs.push(`### ${file.replace(/\.md$/, "")}\n${content}`);
    }
    return docs;
  } catch {
    return [];
  }
}

async function readLatestDecisions(historyFile: string): Promise<string[]> {
  const history = await readJsonFile<{ cycles?: Array<{ plan?: { issues?: Array<{ decision?: string }> } }> }>(historyFile, {
    cycles: []
  });
  const cycles = history.cycles ?? [];
  const latest = cycles[cycles.length - 1];
  const issues = latest?.plan?.issues ?? [];
  return issues.map((i) => i.decision).filter((v): v is string => typeof v === "string" && v.length > 0);
}
