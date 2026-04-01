import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

export const nxAstSearch = tool({
  description: "Search source code with regex",
  args: {
    file: z.string(),
    pattern: z.string()
  },
  async execute(args, context) {
    const abs = path.isAbsolute(args.file) ? args.file : path.join(context.worktree ?? context.directory, args.file);
    const regex = new RegExp(args.pattern, "g");
    const lines = (await fs.readFile(abs, "utf8")).split("\n");
    const matches: Array<{ line: number; text: string }> = [];
    lines.forEach((line, idx) => {
      if (regex.test(line)) {
        matches.push({ line: idx + 1, text: line });
      }
      regex.lastIndex = 0;
    });
    return JSON.stringify({ file: args.file, matches }, null, 2);
  }
});

export const nxAstReplace = tool({
  description: "Preview or apply regex-backed source replacement",
  args: {
    file: z.string(),
    pattern: z.string(),
    replace: z.string(),
    dry_run: z.boolean().default(true)
  },
  async execute(args, context) {
    const abs = path.isAbsolute(args.file) ? args.file : path.join(context.worktree ?? context.directory, args.file);
    const regex = new RegExp(args.pattern, "g");
    const original = await fs.readFile(abs, "utf8");
    const matches = Array.from(original.matchAll(regex)).map((match) => match[0]);
    const next = original.replace(regex, args.replace);

    if (!args.dry_run) {
      await fs.writeFile(abs, next, "utf8");
    }

    return JSON.stringify(
      {
        file: args.file,
        dryRun: args.dry_run,
        replacementCount: matches.length,
        changed: original !== next,
        preview: original !== next ? next.slice(0, 400) : null
      },
      null,
      2
    );
  }
});
