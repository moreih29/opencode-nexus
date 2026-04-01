import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs"]);
const SKIP_DIRS = new Set([".git", ".nexus", "node_modules", "dist"]);

export const nxLspDocumentSymbols = tool({
  description: "List heuristic symbol definitions in a file",
  args: {
    file: z.string()
  },
  async execute(args, context) {
    const abs = resolveFile(context, args.file);
    const text = await fs.readFile(abs, "utf8");
    return JSON.stringify({ file: args.file, symbols: collectDefinitions(text) }, null, 2);
  }
});

export const nxLspSymbols = nxLspDocumentSymbols;

export const nxLspWorkspaceSymbols = tool({
  description: "Search workspace symbol definitions",
  args: {
    query: z.string()
  },
  async execute(args, context) {
    const files = await listWorkspaceFiles(context.worktree ?? context.directory);
    const matches: Array<{ file: string; line: number; kind: string; name: string }> = [];
    for (const file of files) {
      const text = await fs.readFile(file, "utf8");
      for (const symbol of collectDefinitions(text)) {
        if (symbol.name.toLowerCase().includes(args.query.toLowerCase())) {
          matches.push({ ...symbol, file: path.relative(context.worktree ?? context.directory, file) });
        }
      }
    }
    return JSON.stringify({ query: args.query, symbols: matches }, null, 2);
  }
});

export const nxLspHover = tool({
  description: "Get heuristic symbol information at a position",
  args: {
    file: z.string(),
    line: z.number(),
    character: z.number()
  },
  async execute(args, context) {
    const abs = resolveFile(context, args.file);
    const text = await fs.readFile(abs, "utf8");
    const lines = text.split("\n");
    const lineText = lines[args.line - 1] ?? "";
    const symbol = extractSymbolAtPosition(lineText, args.character);
    const definition = symbol ? findDefinitionInText(text, symbol) : null;
    return JSON.stringify(
      {
        file: args.file,
        line: args.line,
        character: args.character,
        symbol,
        lineText,
        definition
      },
      null,
      2
    );
  }
});

export const nxLspGotoDefinition = tool({
  description: "Find heuristic definition locations for a symbol",
  args: {
    file: z.string(),
    line: z.number(),
    character: z.number()
  },
  async execute(args, context) {
    const root = context.worktree ?? context.directory;
    const abs = resolveFile(context, args.file);
    const text = await fs.readFile(abs, "utf8");
    const symbol = extractSymbolAtPosition(text.split("\n")[args.line - 1] ?? "", args.character);
    if (!symbol) {
      return JSON.stringify({ definitions: [] }, null, 2);
    }

    const files = await listWorkspaceFiles(root);
    const definitions: Array<{ file: string; line: number; kind: string; name: string }> = [];
    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      for (const entry of collectDefinitions(content)) {
        if (entry.name === symbol) {
          definitions.push({ ...entry, file: path.relative(root, file) });
        }
      }
    }
    return JSON.stringify({ symbol, definitions }, null, 2);
  }
});

export const nxLspDiagnostics = tool({
  description: "Return lightweight diagnostics and refactor hints",
  args: {
    file: z.string()
  },
  async execute(args, context) {
    const abs = resolveFile(context, args.file);
    const text = await fs.readFile(abs, "utf8");
    const diagnostics: Array<{ line: number; severity: string; message: string }> = [];
    text.split("\n").forEach((line, index) => {
      if (/TODO|FIXME/.test(line)) diagnostics.push({ line: index + 1, severity: "info", message: "TODO/FIXME marker" });
      if (/console\.log/.test(line)) diagnostics.push({ line: index + 1, severity: "warning", message: "console.log left in source" });
      if (/debugger\b/.test(line)) diagnostics.push({ line: index + 1, severity: "warning", message: "debugger statement" });
    });
    return JSON.stringify({ file: args.file, diagnostics }, null, 2);
  }
});

export const nxLspCodeActions = tool({
  description: "Suggest lightweight code actions for a file",
  args: {
    file: z.string()
  },
  async execute(args, context) {
    const diagnostics = JSON.parse(await nxLspDiagnostics.execute(args, context)) as {
      diagnostics: Array<{ line: number; severity: string; message: string }>;
    };
    const actions = diagnostics.diagnostics.map((item) => ({
      line: item.line,
      title: item.message.includes("console.log")
        ? "Remove or replace console.log"
        : item.message.includes("debugger")
          ? "Remove debugger statement"
          : "Resolve marker before close",
      kind: "quickfix"
    }));
    return JSON.stringify({ file: args.file, actions }, null, 2);
  }
});

export const nxLspFindReferences = tool({
  description: "Find workspace references for a symbol",
  args: {
    file: z.string(),
    symbol: z.string().optional(),
    line: z.number().optional(),
    character: z.number().optional(),
    includeDeclaration: z.boolean().default(true)
  },
  async execute(args, context) {
    const root = context.worktree ?? context.directory;
    const targetSymbol = args.symbol ?? (await symbolFromPosition(context, args.file, args.line, args.character));
    if (!targetSymbol) {
      return JSON.stringify({ symbol: null, refs: [] }, null, 2);
    }

    const files = await listWorkspaceFiles(root);
    const refs: Array<{ file: string; line: number; text: string }> = [];
    const boundary = new RegExp(`\\b${escapeRegExp(targetSymbol)}\\b`);
    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      const definitions = collectDefinitions(content).filter((definition) => definition.name === targetSymbol);
      content.split("\n").forEach((line, index) => {
        if (!boundary.test(line)) {
          return;
        }
        const isDeclaration = definitions.some((definition) => definition.line === index + 1);
        if (!args.includeDeclaration && isDeclaration) {
          return;
        }
        refs.push({ file: path.relative(root, file), line: index + 1, text: line.trim() });
      });
    }
    return JSON.stringify({ symbol: targetSymbol, refs }, null, 2);
  }
});

export const nxLspRename = tool({
  description: "Preview or apply a workspace rename with word-boundary matching",
  args: {
    file: z.string(),
    from: z.string().optional(),
    to: z.string(),
    line: z.number().optional(),
    character: z.number().optional(),
    apply: z.boolean().default(false)
  },
  async execute(args, context) {
    const root = context.worktree ?? context.directory;
    const symbol = args.from ?? (await symbolFromPosition(context, args.file, args.line, args.character));
    if (!symbol) {
      throw new Error("Unable to determine symbol to rename. Provide from or a valid line/character.");
    }

    const files = await listWorkspaceFiles(root);
    const regex = new RegExp(`\\b${escapeRegExp(symbol)}\\b`, "g");
    const edits: Array<{ file: string; occurrences: number }> = [];

    for (const file of files) {
      const content = await fs.readFile(file, "utf8");
      const matches = content.match(regex);
      if (!matches || matches.length === 0) {
        continue;
      }
      edits.push({ file: path.relative(root, file), occurrences: matches.length });
      if (args.apply) {
        await fs.writeFile(file, content.replace(regex, args.to), "utf8");
      }
    }

    return JSON.stringify(
      {
        symbol,
        to: args.to,
        apply: args.apply,
        edits,
        totalOccurrences: edits.reduce((sum, edit) => sum + edit.occurrences, 0)
      },
      null,
      2
    );
  }
});

function resolveFile(context: { directory: string; worktree?: string }, file: string): string {
  return path.isAbsolute(file) ? file : path.join(context.worktree ?? context.directory, file);
}

async function symbolFromPosition(
  context: { directory: string; worktree?: string },
  file: string,
  line?: number,
  character?: number
): Promise<string | null> {
  if (!line || !character) {
    return null;
  }
  const abs = resolveFile(context, file);
  const text = await fs.readFile(abs, "utf8");
  return extractSymbolAtPosition(text.split("\n")[line - 1] ?? "", character);
}

function extractSymbolAtPosition(lineText: string, character: number): string | null {
  const zeroBased = Math.max(character - 1, 0);
  for (const match of lineText.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (zeroBased >= start && zeroBased < end) {
      return match[0];
    }
  }
  return null;
}

function findDefinitionInText(text: string, symbol: string) {
  return collectDefinitions(text).find((entry) => entry.name === symbol) ?? null;
}

function collectDefinitions(text: string): Array<{ line: number; kind: string; name: string }> {
  const definitions: Array<{ line: number; kind: string; name: string }> = [];
  const patterns: Array<{ kind: string; regex: RegExp }> = [
    { kind: "function", regex: /^\s*(?:export\s+)?function\s+([A-Za-z0-9_]+)/ },
    { kind: "class", regex: /^\s*(?:export\s+)?class\s+([A-Za-z0-9_]+)/ },
    { kind: "const", regex: /^\s*(?:export\s+)?const\s+([A-Za-z0-9_]+)/ },
    { kind: "let", regex: /^\s*(?:export\s+)?let\s+([A-Za-z0-9_]+)/ },
    { kind: "type", regex: /^\s*(?:export\s+)?type\s+([A-Za-z0-9_]+)/ },
    { kind: "interface", regex: /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_]+)/ },
    { kind: "python-def", regex: /^\s*def\s+([A-Za-z0-9_]+)/ },
    { kind: "struct", regex: /^\s*(?:pub\s+)?struct\s+([A-Za-z0-9_]+)/ }
  ];
  text.split("\n").forEach((line, index) => {
    for (const pattern of patterns) {
      const match = line.match(pattern.regex);
      if (match) {
        definitions.push({ line: index + 1, kind: pattern.kind, name: match[1] });
        break;
      }
    }
  });
  return definitions;
}

async function listWorkspaceFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  await walk(root, results);
  return results;
}

async function walk(current: string, results: string[]): Promise<void> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await walk(path.join(current, entry.name), results);
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(path.join(current, entry.name));
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
