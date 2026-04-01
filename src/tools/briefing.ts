import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { createNexusPaths } from "../shared/paths";
import { matchesHint } from "../shared/markdown";

const z = tool.schema;

const MATRIX: Record<string, Array<"identity" | "codebase" | "reference" | "memory">> = {
  architect: ["identity", "codebase", "reference", "memory"],
  designer: ["identity", "codebase", "reference", "memory"],
  postdoc: ["identity", "reference", "memory"],
  strategist: ["identity", "reference", "memory"],
  engineer: ["codebase", "memory"],
  researcher: ["identity", "reference", "memory"],
  writer: ["identity", "reference", "memory"],
  qa: ["codebase", "memory"],
  reviewer: ["identity", "reference", "memory"]
};

export const nxBriefing = tool({
  description: "Build role-based briefing from Nexus knowledge",
  args: {
    role: z.string(),
    hint: z.string().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const role = args.role.trim().toLowerCase();
    const layers = MATRIX[role] ?? ["identity", "codebase", "reference", "memory"];

    const sections: string[] = [];

    const rules = await readMarkdownDir(paths.RULES_ROOT, args.hint);
    if (rules.length > 0) {
      sections.push("## Rules\n" + rules.join("\n\n"));
    }

    for (const layer of layers) {
      const layerPath = path.join(paths.CORE_ROOT, layer);
      const docs = await readMarkdownDir(layerPath, args.hint);
      if (docs.length > 0) {
        sections.push(`## ${capitalize(layer)}\n` + docs.join("\n\n"));
      }
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
