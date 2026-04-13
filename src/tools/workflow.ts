import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { tool } from "@opencode-ai/plugin";
import { createNexusPaths } from "../shared/paths.js";
import { ensureNexusStructure, fileExists } from "../shared/state.js";

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

    const contextExisting = await listMarkdownFiles(paths.CONTEXT_ROOT);
    const hasCore = contextExisting.length > 0;

    let mode = hasCore ? "resume" : "first-run";
    let backupPath: string | null = null;

    if (args.reset && hasCore) {
      mode = "reset";
    }

    const scan = await scanProject(root);
    const generatedFiles: string[] = [];
    const identityInputs = {
      mission: args.mission?.trim(),
      design: args.design?.trim(),
      roadmap: args.roadmap?.trim()
    };

    generatedFiles.push(
      ...(await writeIfChanged(
        path.join(paths.CONTEXT_ROOT, "architecture.md"),
        buildArchitectureDoc(scan),
        path.join("context", "architecture.md")
      )),
      ...(await writeIfChanged(
        path.join(paths.CONTEXT_ROOT, "development.md"),
        buildDevelopmentDoc(scan),
        path.join("context", "development.md")
      )),
      ...(await writeIfChanged(
        path.join(paths.CONTEXT_ROOT, "tools.md"),
        buildToolsDoc(scan),
        path.join("context", "tools.md")
      ))
    );

    const proposedIdentity = buildIdentityDrafts(scan);
    const confirmationQuestions = buildIdentityConfirmationQuestions(proposedIdentity, identityInputs);
    generatedFiles.push(
      ...(await writeIdentityDoc(paths.CONTEXT_ROOT, "mission", identityInputs.mission, proposedIdentity.mission)),
      ...(await writeIdentityDoc(paths.CONTEXT_ROOT, "design", identityInputs.design, proposedIdentity.design)),
      ...(await writeIdentityDoc(paths.CONTEXT_ROOT, "roadmap", identityInputs.roadmap, proposedIdentity.roadmap))
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
        identityNeedsConfirmation: confirmationQuestions.length > 0,
        confirmationQuestions,
        instructionFiles: {
          primary: scan.primaryDocs.includes("AGENTS.md") ? "AGENTS.md" : null,
          legacy: scan.legacyDocs.includes("CLAUDE.md") ? "CLAUDE.md" : null
        },
        nextSteps: [
          ...(confirmationQuestions.length > 0
            ? ["Answer the confirmation questions and rerun nx_init with the confirmed mission, design, and roadmap values."]
            : ["Identity values were explicitly provided for this run."]),
          "Prefer AGENTS.md and opencode.json.instructions as the primary instruction path in OpenCode.",
          "Use [plan] for major decisions before implementation.",
          "Use nx_sync after completed cycles to promote decisions into core knowledge."
        ]
      },
      null,
      2
    );
  }
});

export const nxSync = tool({
  description: "Trigger Nexus context knowledge synchronization",
  args: {},
  async execute(_args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    await ensureNexusStructure(paths);
    return "Sync triggered. Follow nx-sync skill workflow: read .nexus/context/, run git diff, spawn Writer agent to update files. See [sync] tag.";
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

function buildIdentityConfirmationQuestions(
  proposedIdentity: ReturnType<typeof buildIdentityDrafts>,
  identityInputs: { mission?: string; design?: string; roadmap?: string }
) {
  const questions: Array<{ field: "mission" | "design" | "roadmap"; prompt: string; draft: string }> = [];
  if (!identityInputs.mission) {
    questions.push({
      field: "mission",
      prompt: "Confirm the project mission: what problem does this project solve and for whom?",
      draft: proposedIdentity.mission
    });
  }
  if (!identityInputs.design) {
    questions.push({
      field: "design",
      prompt: "Confirm the design rationale: what key architectural decisions and trade-offs define this project?",
      draft: proposedIdentity.design
    });
  }
  if (!identityInputs.roadmap) {
    questions.push({
      field: "roadmap",
      prompt: "Confirm the near-term roadmap: what are the next 1-3 priorities for this project?",
      draft: proposedIdentity.roadmap
    });
  }
  return questions;
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
    "- Use [plan] for significant decisions before implementation.",
    "- Register tasks before file edits and close each cycle with nx_task_close.",
    "- Run nx_sync after meaningful completed cycles to update core knowledge."
  ].join("\n");
}

async function writeIdentityDoc(contextRoot: string, name: string, explicitContent: string | undefined, fallback: string): Promise<string[]> {
  const filePath = path.join(contextRoot, `${name}.md`);
  if (explicitContent && explicitContent.trim().length > 0) {
    return writeIfChanged(filePath, `<!-- tags: identity, ${name} -->\n# ${capitalize(name)}\n\n${explicitContent.trim()}\n`, path.join("context", `${name}.md`));
  }
  if (await fileExists(filePath)) {
    return [];
  }
  return writeIfChanged(
    filePath,
    `<!-- tags: identity, draft -->\n# ${capitalize(name)}\n\n${fallback}\n\n> Draft generated by nx_init. Replace with confirmed project-specific content.\n`,
    path.join("context", `${name}.md`)
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


async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  if (!(await fileExists(filePath))) {
    return null;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
