import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { createNexusPaths } from "../shared/paths";
import { ensureTagsFrontmatter, extractTags } from "../shared/markdown";

const z = tool.schema;
const LAYERS = ["identity", "codebase", "reference", "memory"] as const;
type Layer = (typeof LAYERS)[number];

export const nxCoreRead = tool({
  description: "Read Nexus core knowledge",
  args: {
    layer: z.enum(LAYERS).optional(),
    topic: z.string().optional(),
    tag: z.string().optional()
  },
  async execute(args, context) {
    const root = createNexusPaths(context.worktree ?? context.directory).CORE_ROOT;

    if (!args.layer) {
      const overview: Record<string, string[]> = {};
      for (const layer of LAYERS) {
        overview[layer] = await listTopics(path.join(root, layer));
      }
      return JSON.stringify({ layers: overview }, null, 2);
    }

    const layerRoot = path.join(root, args.layer);
    if (!args.topic) {
      const topics = await listTopics(layerRoot);
      return JSON.stringify({ layer: args.layer, topics }, null, 2);
    }

    const filePath = toTopicPath(layerRoot, args.topic);
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

export const nxCoreWrite = tool({
  description: "Write Nexus core knowledge",
  args: {
    layer: z.enum(LAYERS),
    topic: z.string(),
    content: z.string(),
    tags: z.array(z.string()).optional()
  },
  async execute(args, context) {
    const root = createNexusPaths(context.worktree ?? context.directory).CORE_ROOT;
    const layerRoot = path.join(root, args.layer);
    await fs.mkdir(layerRoot, { recursive: true });

    const filePath = toTopicPath(layerRoot, args.topic);
    const next = ensureTagsFrontmatter(args.content, args.tags);
    await fs.writeFile(filePath, next.endsWith("\n") ? next : `${next}\n`, "utf8");

    return `Wrote ${args.layer}/${normalizeTopic(args.topic)}.md`;
  }
});

async function listTopics(layerRoot: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(layerRoot, { withFileTypes: true });
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

function toTopicPath(layerRoot: string, topic: string): string {
  return path.join(layerRoot, `${normalizeTopic(topic)}.md`);
}
