import fs from "node:fs/promises";
import path from "node:path";
import type { NexusPaths } from "./paths.js";

export interface KnowledgeIndexSnapshot {
  context: string[];
  memory: string[];
  rules: string[];
}

interface KnowledgeIndexCacheEntry {
  snapshot: KnowledgeIndexSnapshot;
  collectedAt: number;
}

const knowledgeIndexCache = new Map<string, KnowledgeIndexCacheEntry>();

export async function collectKnowledgeIndex(
  paths: Pick<NexusPaths, "PROJECT_ROOT" | "CONTEXT_ROOT" | "MEMORY_ROOT" | "RULES_ROOT" | "NEXUS_ROOT">
): Promise<KnowledgeIndexSnapshot> {
  const cacheKey = paths.PROJECT_ROOT;
  const cached = knowledgeIndexCache.get(cacheKey);
  if (cached) {
    return cached.snapshot;
  }

  const snapshot: KnowledgeIndexSnapshot = {
    context: await collectMarkdownFiles(paths.CONTEXT_ROOT, path.join(".nexus", "context")),
    memory: await collectMarkdownFiles(paths.MEMORY_ROOT, path.join(".nexus", "memory")),
    rules: await collectMarkdownFiles(paths.RULES_ROOT, path.join(".nexus", "rules"))
  };

  knowledgeIndexCache.set(cacheKey, {
    snapshot,
    collectedAt: Date.now()
  });

  return snapshot;
}

export function invalidateKnowledgeIndex(projectRoot: string): void {
  knowledgeIndexCache.delete(projectRoot);
}

export function formatKnowledgeIndexBlock(index: KnowledgeIndexSnapshot): string {
  return [
    "KNOWLEDGE_INDEX:",
    formatKnowledgeSection("context", index.context),
    formatKnowledgeSection("memory", index.memory),
    formatKnowledgeSection("rules", index.rules)
  ].join("\n");
}

export async function appendKnowledgeIndexToTaskArgs(
  paths: Pick<NexusPaths, "PROJECT_ROOT" | "CONTEXT_ROOT" | "MEMORY_ROOT" | "RULES_ROOT" | "NEXUS_ROOT">,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const prompt = typeof args.prompt === "string" ? args.prompt : null;
  const description = typeof args.description === "string" ? args.description : null;
  if (!prompt && !description) {
    return args;
  }

  const index = await collectKnowledgeIndex(paths);
  const block = formatKnowledgeIndexBlock(index);

  if (prompt && !prompt.includes("KNOWLEDGE_INDEX:")) {
    return {
      ...args,
      prompt: `${prompt}\n\n${block}`
    };
  }

  if (description && !description.includes("KNOWLEDGE_INDEX:")) {
    return {
      ...args,
      description: `${description}\n\n${block}`
    };
  }

  return args;
}

async function collectMarkdownFiles(root: string, relativePrefix: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(relativePrefix, entry.name).split(path.sep).join("/"))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function formatKnowledgeSection(section: string, files: string[]): string {
  if (files.length === 0) {
    return `${section}: []`;
  }
  return `${section}: [${files.join(", ")}]`;
}
