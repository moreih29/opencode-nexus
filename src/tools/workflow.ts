import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { tool } from "@opencode-ai/plugin";
import { createNexusPaths } from "../shared/paths";
import { ensureNexusStructure, fileExists } from "../shared/state";
import { readJsonFile } from "../shared/json-store";

const execFileAsync = promisify(execFile);
const z = tool.schema;

export const nxInit = tool({
  description: "Initialize Nexus core knowledge from the repository",
  args: {
    reset: z.boolean().default(false),
    cleanup_backup: z.string().optional(),
    mission: z.string().optional(),
    design: z.string().optional(),
    roadmap: z.string().optional(),
    setup_rules: z.boolean().default(false)
  },
  async execute(args, context) {
    const root = context.worktree ?? context.directory;
    const paths = createNexusPaths(root);
    await ensureNexusStructure(paths);

    if (args.cleanup_backup) {
      const backupDir = path.join(paths.NEXUS_ROOT, args.cleanup_backup);
      if (!path.basename(backupDir).startsWith("core.bak.")) {
        throw new Error("cleanup_backup must point to a core.bak.* directory inside .nexus");
      }
      if (!(await fileExists(backupDir))) {
        return `Backup not found: ${args.cleanup_backup}`;
      }
      await fs.rm(backupDir, { recursive: true, force: true });
      return `Deleted backup ${args.cleanup_backup}`;
    }

    const identityDir = path.join(paths.CORE_ROOT, "identity");
    const codebaseDir = path.join(paths.CORE_ROOT, "codebase");
    const identityExisting = await listMarkdownFiles(identityDir);
    const codebaseExisting = await listMarkdownFiles(codebaseDir);
    const hasCore = identityExisting.length > 0 || codebaseExisting.length > 0;

    let mode = hasCore ? "resume" : "first-run";
    let backupPath: string | null = null;

    if (args.reset && hasCore) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = path.join(paths.NEXUS_ROOT, `core.bak.${stamp}`);
      await fs.rename(paths.CORE_ROOT, backupPath);
      await ensureNexusStructure(paths);
      mode = "reset";
    }

    const scan = await scanProject(root);
    const generatedFiles: string[] = [];

    generatedFiles.push(
      ...(await writeIfChanged(
        path.join(codebaseDir, "architecture.md"),
        buildArchitectureDoc(scan),
        path.join("core", "codebase", "architecture.md")
      )),
      ...(await writeIfChanged(
        path.join(codebaseDir, "development.md"),
        buildDevelopmentDoc(scan),
        path.join("core", "codebase", "development.md")
      )),
      ...(await writeIfChanged(
        path.join(codebaseDir, "tools.md"),
        buildToolsDoc(scan),
        path.join("core", "codebase", "tools.md")
      ))
    );

    const proposedIdentity = buildIdentityDrafts(scan);
    generatedFiles.push(
      ...(await writeIdentityDoc(identityDir, "mission", args.mission, proposedIdentity.mission)),
      ...(await writeIdentityDoc(identityDir, "design", args.design, proposedIdentity.design)),
      ...(await writeIdentityDoc(identityDir, "roadmap", args.roadmap, proposedIdentity.roadmap))
    );

    if (args.setup_rules) {
      generatedFiles.push(
        ...(await writeIfChanged(
          path.join(paths.RULES_ROOT, "dev-rules.md"),
          buildRulesDoc(scan),
          path.join("rules", "dev-rules.md")
        ))
      );
    }

    return JSON.stringify(
      {
        mode,
        backupPath,
        scan,
        primaryDocs: scan.primaryDocs,
        legacyDocs: scan.legacyDocs,
        legacyInputsUsed: scan.legacyInputsUsed,
        generatedFiles,
        proposedIdentity,
        nextSteps: [
          "Review proposed identity fields if any were not explicitly provided.",
          "Prefer AGENTS.md and opencode.json.instructions as the primary instruction path in OpenCode.",
          "Use [meet] for major decisions before implementation.",
          "Use nx_sync after completed cycles to promote decisions into core knowledge."
        ]
      },
      null,
      2
    );
  }
});

export const nxSync = tool({
  description: "Promote archived cycle history into Nexus core knowledge",
  args: {
    scope: z.enum(["all", "memory", "codebase", "reference"]).default("all"),
    cycle_index: z.number().optional()
  },
  async execute(args, context) {
    const root = context.worktree ?? context.directory;
    const paths = createNexusPaths(root);
    await ensureNexusStructure(paths);

    const history = await readJsonFile<{ cycles?: Array<any> }>(paths.HISTORY_FILE, { cycles: [] });
    const cycles = history.cycles ?? [];
    if (cycles.length === 0) {
      return "No archived cycles found. Complete a task cycle before syncing knowledge.";
    }

    const index = args.cycle_index ?? cycles.length - 1;
    const cycle = cycles[index];
    if (!cycle) {
      throw new Error(`Cycle index out of range: ${index}`);
    }

    const gitSignals = await readGitSignals(root);
    const summary = summarizeCycle(cycle, gitSignals);
    const generatedFiles: string[] = [];
    const scannedLayers = args.scope === "all" ? ["memory", "codebase", "reference"] : [args.scope];
    const sources = [
      "archived cycle history",
      gitSignals.changedFiles.length > 0 ? "git working tree changes" : "git working tree changes (none detected)",
      gitSignals.recentCommits.length > 0 ? "recent git commits" : "recent git commits (none detected)",
      "current core files"
    ];
    const needsVerification = [
      ...(gitSignals.changedFiles.length === 0 ? ["No git working tree changes detected during sync."] : []),
      ...(summary.decisionCount === 0 ? ["No recorded meet decisions were available in the archived cycle."] : [])
    ];

    if (args.scope === "all" || args.scope === "memory") {
      generatedFiles.push(
        ...(await writeIfChanged(
          path.join(paths.CORE_ROOT, "memory", "recent-cycle-summary.md"),
          buildRecentCycleMemoryDoc(summary),
          path.join("core", "memory", "recent-cycle-summary.md")
        ))
      );
    }
    if (args.scope === "all" || args.scope === "codebase") {
      generatedFiles.push(
        ...(await writeIfChanged(
          path.join(paths.CORE_ROOT, "codebase", "recent-changes.md"),
          buildRecentChangesDoc(summary),
          path.join("core", "codebase", "recent-changes.md")
        ))
      );
    }
    if (args.scope === "all" || args.scope === "reference") {
      generatedFiles.push(
        ...(await writeIfChanged(
          path.join(paths.CORE_ROOT, "reference", "decision-log.md"),
          buildDecisionLogDoc(summary),
          path.join("core", "reference", "decision-log.md")
        ))
      );
    }

    return JSON.stringify(
      {
        synced: true,
        cycleIndex: index,
        sources,
        scannedLayers,
        generatedFiles,
        needsVerification,
        summary
      },
      null,
      2
    );
  }
});

async function scanProject(root: string) {
  const topLevel = (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => ![".git", ".nexus", "node_modules", "dist"].includes(entry.name))
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort();

  const packageJson = await readJsonIfExists<Record<string, any>>(path.join(root, "package.json"));
  const scripts = packageJson?.scripts ? Object.keys(packageJson.scripts).sort() : [];
  const deps = [
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.devDependencies ?? {})
  ];
  const docs = (await Promise.all(["AGENTS.md", "README.md", "README.en.md", "CLAUDE.md", "docs"].map(async (entry) => ((await fileExists(path.join(root, entry))) ? entry : null)))).filter(
    (entry): entry is string => Boolean(entry)
  );
  const primaryDocs = docs.filter((entry) => entry !== "CLAUDE.md");
  const legacyDocs = docs.filter((entry) => entry === "CLAUDE.md");
  const languageHints = await detectLanguages(root);
  const gitCommits = await readRecentCommits(root);

  return {
    topLevel,
    docs,
    primaryDocs,
    legacyDocs,
    legacyInputsUsed: legacyDocs,
    packageManager: (await fileExists(path.join(root, "bun.lock"))) ? "bun" : packageJson ? "npm-compatible" : "unknown",
    scripts,
    frameworks: detectFrameworks(deps, languageHints),
    languageHints,
    recentCommits: gitCommits
  };
}

function buildArchitectureDoc(scan: Awaited<ReturnType<typeof scanProject>>): string {
  return [
    "<!-- tags: codebase, architecture -->",
    "# Architecture Overview",
    "",
    "## Top-level Structure",
    ...scan.topLevel.map((entry) => `- ${entry}`),
    "",
    "## Frameworks and Languages",
    `- Frameworks: ${scan.frameworks.join(", ") || "unknown"}`,
    `- Languages: ${scan.languageHints.join(", ") || "unknown"}`,
    "",
    "## Notes",
    "- Generated by nx_init from repository structure.",
    "- Refine this document as architectural boundaries become clearer."
  ].join("\n");
}

function buildDevelopmentDoc(scan: Awaited<ReturnType<typeof scanProject>>): string {
  return [
    "<!-- tags: codebase, development -->",
    "# Development Workflow",
    "",
    `- Package manager: ${scan.packageManager}`,
    `- Scripts: ${scan.scripts.join(", ") || "none detected"}`,
    `- Primary docs: ${scan.primaryDocs.join(", ") || "none detected"}`,
    `- Legacy docs: ${scan.legacyDocs.join(", ") || "none detected"}`,
    "",
    "## Recent Activity",
    ...scan.recentCommits.map((commit) => `- ${commit}`)
  ].join("\n");
}

function buildToolsDoc(scan: Awaited<ReturnType<typeof scanProject>>): string {
  return [
    "<!-- tags: codebase, tools -->",
    "# Tooling and Runtime",
    "",
    `- Package manager: ${scan.packageManager}`,
    `- Framework/tool hints: ${scan.frameworks.join(", ") || "unknown"}`,
    `- Top-level modules: ${scan.topLevel.join(", ") || "unknown"}`,
    "",
    "## Source of Truth",
    "- Keep this file focused on verified tooling facts from the repository.",
    "- Prefer nx_sync updates after each completed execution cycle."
  ].join("\n");
}

function buildIdentityDrafts(scan: Awaited<ReturnType<typeof scanProject>>) {
  const frameworks = scan.frameworks.join(", ") || "the detected stack";
  return {
    mission: `This project organizes and executes work around ${frameworks}, with Nexus knowledge and orchestration stored in .nexus/. Confirm the core product goal and user value.`,
    design: `The repository currently points to a ${frameworks} stack with top-level modules ${scan.topLevel.join(", ") || "not yet classified"}. Confirm the key architectural decisions and why this stack was chosen.`,
    roadmap: `Short-term priorities appear to align with the current scripts (${scan.scripts.join(", ") || "none detected"}) and recent work (${scan.recentCommits[0] ?? "no recent commit summary"}). Confirm the next 1-3 priorities.`
  };
}

function buildRulesDoc(scan: Awaited<ReturnType<typeof scanProject>>): string {
  return [
    "<!-- tags: dev, workflow -->",
    "# Dev Rules",
    "",
    "## Build and Test",
    `- Use ${scan.packageManager} commands that already exist in the repository scripts when possible.`,
    `- Known scripts: ${scan.scripts.join(", ") || "none detected"}`,
    "",
    "## Execution Flow",
    "- Use [meet] for significant decisions before implementation.",
    "- Register tasks before file edits and close each cycle with nx_task_close.",
    "- Run nx_sync after meaningful completed cycles to update core knowledge."
  ].join("\n");
}

function summarizeCycle(cycle: any, gitSignals: Awaited<ReturnType<typeof readGitSignals>>) {
  const tasks = Array.isArray(cycle?.tasks?.tasks) ? cycle.tasks.tasks : [];
  const issues = Array.isArray(cycle?.meet?.issues) ? cycle.meet.issues : [];
  const decisions = issues
    .filter((issue: any) => typeof issue?.decision === "string" && issue.decision.length > 0)
    .map((issue: any) => ({ id: String(issue.id ?? "unknown"), title: String(issue.title ?? "untitled"), decision: issue.decision }));
  return {
    completedAt: String(cycle?.completed_at ?? new Date().toISOString()),
    branch: String(cycle?.branch ?? "unknown"),
    topic: typeof cycle?.meet?.topic === "string" ? cycle.meet.topic : null,
    taskTitles: tasks.map((task: any) => String(task.title ?? task.id ?? "unknown task")),
    decisions,
    taskCount: tasks.length,
    decisionCount: decisions.length,
    changedFiles: gitSignals.changedFiles,
    recentCommits: gitSignals.recentCommits,
    memoryHint:
      cycle?.memoryHint && typeof cycle.memoryHint === "object"
        ? {
            hadLoopDetection: Boolean((cycle.memoryHint as { hadLoopDetection?: unknown }).hadLoopDetection),
            reopenCount: Number((cycle.memoryHint as { reopenCount?: unknown }).reopenCount ?? 0),
            blockedTransitions: Number((cycle.memoryHint as { blockedTransitions?: unknown }).blockedTransitions ?? 0)
          }
        : null
  };
}

function buildRecentCycleMemoryDoc(summary: ReturnType<typeof summarizeCycle>): string {
  return [
    "<!-- tags: memory, cycle -->",
    "# Recent Cycle Summary",
    "",
    `- Completed at: ${summary.completedAt}`,
    `- Branch: ${summary.branch}`,
    `- Topic: ${summary.topic ?? "none"}`,
    `- Task count: ${summary.taskCount}`,
    `- Decision count: ${summary.decisionCount}`,
    `- Loop detection: ${summary.memoryHint?.hadLoopDetection ? "yes" : "no"}`,
    `- Reopen count: ${summary.memoryHint?.reopenCount ?? 0}`,
    `- Blocked transitions: ${summary.memoryHint?.blockedTransitions ?? 0}`,
    `- Git changed files seen during sync: ${summary.changedFiles.length}`,
    "",
    "## Tasks",
    ...summary.taskTitles.map((task: string) => `- ${task}`),
    "",
    "## Decisions",
    ...(summary.decisions.length > 0
      ? summary.decisions.map((decision: { id: string; title: string; decision: string }) => `- ${decision.id} ${decision.title}: ${decision.decision}`)
      : ["- none recorded"]),
    "",
    "## Git Signals",
    ...(summary.changedFiles.length > 0 ? summary.changedFiles.map((file: string) => `- ${file}`) : ["- none detected"])
  ].join("\n");
}

function buildRecentChangesDoc(summary: ReturnType<typeof summarizeCycle>): string {
  return [
    "<!-- tags: codebase, changes -->",
    "# Recent Changes",
    "",
    `- Latest archived branch: ${summary.branch}`,
    `- Latest meet topic: ${summary.topic ?? "none"}`,
    `- Lifecycle signals: reopen=${summary.memoryHint?.reopenCount ?? 0}, blocked=${summary.memoryHint?.blockedTransitions ?? 0}`,
    "",
    "## Completed Work",
    ...summary.taskTitles.map((task: string) => `- ${task}`),
    "",
    "## Git Diff Signals",
    ...(summary.changedFiles.length > 0 ? summary.changedFiles.map((file: string) => `- ${file}`) : ["- none detected"]),
    "",
    "## Recent Commits",
    ...(summary.recentCommits.length > 0 ? summary.recentCommits.map((commit: string) => `- ${commit}`) : ["- none detected"]),
    "",
    "## Design Decisions",
    ...(summary.decisions.length > 0
      ? summary.decisions.map((decision: { title: string; decision: string }) => `- ${decision.title}: ${decision.decision}`)
      : ["- none recorded"])
  ].join("\n");
}

function buildDecisionLogDoc(summary: ReturnType<typeof summarizeCycle>): string {
  return [
    "<!-- tags: reference, decisions -->",
    "# Decision Log",
    "",
    `- Synced from archived cycle on ${summary.completedAt}`,
    `- Branch: ${summary.branch}`,
    `- Topic: ${summary.topic ?? "none"}`,
    "",
    ...(summary.decisions.length > 0
      ? summary.decisions.map(
          (decision: { id: string; title: string; decision: string }) => `## ${decision.id}: ${decision.title}\n\n${decision.decision}`
        )
      : ["No decisions were recorded in this cycle."])
  ].join("\n\n");
}

async function writeIdentityDoc(identityDir: string, name: string, explicitContent: string | undefined, fallback: string): Promise<string[]> {
  const filePath = path.join(identityDir, `${name}.md`);
  if (explicitContent && explicitContent.trim().length > 0) {
    return writeIfChanged(filePath, `<!-- tags: identity, ${name} -->\n# ${capitalize(name)}\n\n${explicitContent.trim()}\n`, path.join("core", "identity", `${name}.md`));
  }
  if (await fileExists(filePath)) {
    return [];
  }
  return writeIfChanged(
    filePath,
    `<!-- tags: identity, draft -->\n# ${capitalize(name)}\n\n${fallback}\n\n> Draft generated by nx_init. Replace with confirmed project-specific content.\n`,
    path.join("core", "identity", `${name}.md`)
  );
}

async function writeIfChanged(filePath: string, content: string, label: string): Promise<string[]> {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  const previous = (await fileExists(filePath)) ? await fs.readFile(filePath, "utf8") : null;
  if (previous === normalized) {
    return [];
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, normalized, "utf8");
  return [label];
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

function detectFrameworks(deps: string[], languageHints: string[]): string[] {
  const detected = new Set<string>();
  if (deps.some((dep) => dep === "react" || dep.startsWith("@types/react"))) detected.add("react");
  if (deps.includes("next")) detected.add("next");
  if (deps.includes("vite")) detected.add("vite");
  if (deps.includes("typescript") || deps.includes("ts-node")) detected.add("typescript");
  if (deps.includes("zod")) detected.add("zod");
  return Array.from(detected).concat(languageHints.filter((lang) => lang === "typescript" && !detected.has(lang)));
}

async function detectLanguages(root: string): Promise<string[]> {
  const hints: string[] = [];
  if (await fileExists(path.join(root, "tsconfig.json"))) hints.push("typescript");
  if (await fileExists(path.join(root, "package.json"))) hints.push("javascript");
  if (await fileExists(path.join(root, "pyproject.toml"))) hints.push("python");
  if (await fileExists(path.join(root, "Cargo.toml"))) hints.push("rust");
  if (await fileExists(path.join(root, "go.mod"))) hints.push("go");
  return Array.from(new Set(hints));
}

async function readRecentCommits(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["log", "-5", "--pretty=format:%s"], { cwd: root });
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function readGitSignals(root: string): Promise<{ changedFiles: string[]; recentCommits: string[] }> {
  const recentCommits = await readRecentCommits(root);
  try {
    const { stdout } = await execFileAsync("git", ["status", "--short", "--untracked-files=all"], { cwd: root });
    const changedFiles = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const normalized = line.replace(/^..\s+/, "");
        const renamed = normalized.split(" -> ").at(-1);
        return renamed ?? normalized;
      });
    return { changedFiles, recentCommits };
  } catch {
    return { changedFiles: [], recentCommits };
  }
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
