import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

export const nxLspSymbols = tool({
  description: "List simple symbols from files",
  args: {
    file: z.string()
  },
  async execute(args, context) {
    const abs = path.isAbsolute(args.file) ? args.file : path.join(context.worktree ?? context.directory, args.file);
    const text = await fs.readFile(abs, "utf8");
    const lines = text.split("\n");
    const symbols: Array<{ line: number; kind: string; name: string }> = [];
    lines.forEach((line, idx) => {
      const fn = line.match(/function\s+([A-Za-z0-9_]+)/);
      if (fn) symbols.push({ line: idx + 1, kind: "function", name: fn[1] });
      const cls = line.match(/class\s+([A-Za-z0-9_]+)/);
      if (cls) symbols.push({ line: idx + 1, kind: "class", name: cls[1] });
      const cst = line.match(/const\s+([A-Za-z0-9_]+)/);
      if (cst) symbols.push({ line: idx + 1, kind: "const", name: cst[1] });
    });
    return JSON.stringify({ file: args.file, symbols }, null, 2);
  }
});

export const nxLspDiagnostics = tool({
  description: "Return lightweight diagnostics",
  args: {
    file: z.string()
  },
  async execute(args, context) {
    const abs = path.isAbsolute(args.file) ? args.file : path.join(context.worktree ?? context.directory, args.file);
    const text = await fs.readFile(abs, "utf8");
    const diagnostics: Array<{ line: number; severity: string; message: string }> = [];
    text.split("\n").forEach((line, idx) => {
      if (line.includes("TODO")) {
        diagnostics.push({ line: idx + 1, severity: "info", message: "TODO marker" });
      }
    });
    return JSON.stringify({ file: args.file, diagnostics }, null, 2);
  }
});

export const nxLspFindReferences = tool({
  description: "Find textual references in a file",
  args: {
    file: z.string(),
    symbol: z.string()
  },
  async execute(args, context) {
    const abs = path.isAbsolute(args.file) ? args.file : path.join(context.worktree ?? context.directory, args.file);
    const lines = (await fs.readFile(abs, "utf8")).split("\n");
    const refs = lines
      .map((line, idx) => ({ line: idx + 1, text: line }))
      .filter((item) => item.text.includes(args.symbol));
    return JSON.stringify({ file: args.file, symbol: args.symbol, refs }, null, 2);
  }
});

export const nxLspRename = tool({
  description: "Rename symbol text in a file",
  args: {
    file: z.string(),
    from: z.string(),
    to: z.string()
  },
  async execute(args, context) {
    const abs = path.isAbsolute(args.file) ? args.file : path.join(context.worktree ?? context.directory, args.file);
    const original = await fs.readFile(abs, "utf8");
    const updated = original.split(args.from).join(args.to);
    await fs.writeFile(abs, updated, "utf8");
    return `Renamed '${args.from}' -> '${args.to}' in ${args.file}`;
  }
});
