import fs from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

const EXT_TO_LANG: Record<string, string> = {
  ts: "TypeScript",
  tsx: "Tsx",
  js: "JavaScript",
  jsx: "Jsx",
  css: "Css",
  html: "Html",
};

function getLang(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_LANG[ext] ?? "TypeScript";
}

function loadAstGrep(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@ast-grep/napi");
}

export const nxAstSearch = tool({
  description: "Search source code with structural AST pattern (ast-grep / tree-sitter)",
  args: {
    file: z.string(),
    pattern: z.string()
  },
  async execute(args, context) {
    const abs = path.isAbsolute(args.file) ? args.file : path.join(context.worktree ?? context.directory, args.file);
    const lang = getLang(abs);

    const ag = loadAstGrep();
    const source = await fs.readFile(abs, "utf8");
    const root = ag.parse(lang, source).root();
    const nodes = root.findAll(args.pattern);

    const matches = nodes.map((node: any) => ({
      line: node.range().start.line + 1,
      text: node.text().slice(0, 200)
    }));

    return JSON.stringify({ file: args.file, matches }, null, 2);
  }
});

export const nxAstReplace = tool({
  description: "Preview or apply structural AST replacement (ast-grep / tree-sitter). dry_run=true by default.",
  args: {
    file: z.string(),
    pattern: z.string(),
    replace: z.string(),
    dry_run: z.boolean().default(true)
  },
  async execute(args, context) {
    const abs = path.isAbsolute(args.file) ? args.file : path.join(context.worktree ?? context.directory, args.file);
    const lang = getLang(abs);

    const ag = loadAstGrep();
    const original = await fs.readFile(abs, "utf8");
    const root = ag.parse(lang, original).root();
    const nodes: any[] = root.findAll(args.pattern);

    // Replace from back to front to preserve offsets
    const sorted = [...nodes].sort((a: any, b: any) => b.range().start.index - a.range().start.index);
    let next = original;
    for (const node of sorted) {
      const range = node.range();
      next = next.slice(0, range.start.index) + args.replace + next.slice(range.end.index);
    }

    if (!args.dry_run && original !== next) {
      writeFileSync(abs, next, "utf8");
    }

    return JSON.stringify(
      {
        file: args.file,
        dryRun: args.dry_run,
        replacementCount: nodes.length,
        changed: original !== next,
        preview: original !== next ? next.slice(0, 400) : null
      },
      null,
      2
    );
  }
});
