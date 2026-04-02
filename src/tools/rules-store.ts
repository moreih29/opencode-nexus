import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { createNexusPaths } from "../shared/paths.js";
import { ensureTagsFrontmatter, extractTags } from "../shared/markdown.js";

const z = tool.schema;

export const nxRulesRead = tool({
  description: "Read Nexus rules documents",
  args: {
    topic: z.string().optional(),
    tag: z.string().optional()
  },
  async execute(args, context) {
    const rulesRoot = createNexusPaths(context.worktree ?? context.directory).RULES_ROOT;

    if (!args.topic) {
      const entries = await safeReadDir(rulesRoot);
      return JSON.stringify({ topics: entries }, null, 2);
    }

    const filePath = path.join(rulesRoot, `${normalizeTopic(args.topic)}.md`);
    const content = await fs.readFile(filePath, "utf8");

    if (args.tag) {
      const tags = extractTags(content);
      if (!tags.includes(args.tag.trim().toLowerCase())) {
        return "";
      }
    }

    return content;
  }
});

export const nxRulesWrite = tool({
  description: "Write Nexus rules documents",
  args: {
    topic: z.string(),
    content: z.string(),
    tags: z.array(z.string()).optional()
  },
  async execute(args, context) {
    const rulesRoot = createNexusPaths(context.worktree ?? context.directory).RULES_ROOT;
    await fs.mkdir(rulesRoot, { recursive: true });

    const filePath = path.join(rulesRoot, `${normalizeTopic(args.topic)}.md`);
    const next = ensureTagsFrontmatter(args.content, args.tags);
    await fs.writeFile(filePath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
    return `Wrote rules/${normalizeTopic(args.topic)}.md`;
  }
});

async function safeReadDir(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name.replace(/\.md$/, ""))
      .sort();
  } catch {
    return [];
  }
}

function normalizeTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, "-").toLowerCase();
}
