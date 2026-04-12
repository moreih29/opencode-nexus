// Ported from: claude-nexus/generate-from-nexus-core.lib.mjs @ commit 94997d1 — sync with upstream when Gap fixes merge.
// Pure functions for transforming @moreih29/nexus-core assets
// into opencode-nexus src/agents/prompts.generated.ts, src/skills/prompts.generated.ts

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// ==========================================================================
// Constants
// ==========================================================================

/**
 * Model tier → opencode model name mapping.
 * catalog.ts currently uses a single model for all tiers;
 * keeping both tiers explicit here for future differentiation.
 * @type {Record<string, string>}
 */
export const MODEL_TIER_TO_OPENCODE = {
  high: 'openai/gpt-5.3-codex',
  standard: 'openai/gpt-5.3-codex',
};

// MAX_TURNS_MAP removed — opencode has no maxTurns concept.

// FIELD_ORDER removed — opencode uses TypeScript literal emission, not YAML frontmatter.
// Field order is enforced by the TypeScript type in prompts.generated.ts (commit #2).

// SKILL_FIELD_ORDER removed for same reason.

// SKILL_PURPOSE_OVERRIDE removed in v0.2.0 migration — use manifest.json `summary` field instead.
// See: MIGRATIONS/v0_1_to_v0_2.md Step 5.5

// ==========================================================================
// Path helpers
// ==========================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
export const OPENCODE_NEXUS_ROOT = join(__dirname, '..');
export const NEXUS_CORE_ROOT = join(OPENCODE_NEXUS_ROOT, 'node_modules/@moreih29/nexus-core');

// ==========================================================================
// Loading functions
// ==========================================================================

/** @returns {any} manifest.json parsed object */
export function loadManifest() {
  const path = join(NEXUS_CORE_ROOT, 'manifest.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Cross-check manifest.nexus_core_version vs node_modules/@moreih29/nexus-core/package.json version.
 * Throws if mismatch.
 * @param {any} manifest
 */
export function verifyManifestVersion(manifest) {
  const pkgPath = join(NEXUS_CORE_ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (manifest.nexus_core_version !== pkg.version) {
    throw new Error(
      `manifest.nexus_core_version (${manifest.nexus_core_version}) !== ` +
      `package.json version (${pkg.version})`
    );
  }
}

/**
 * Index capabilities: capability id → opencode tool name array.
 * Reads nexus-core vocabulary/capabilities.yml (X3 schema: blocks_semantic_classes)
 * and resolves through local capability-map.yml.
 * @returns {Map<string, string[]>}
 */
export function indexCapabilities() {
  const capsPath = join(NEXUS_CORE_ROOT, 'vocabulary/capabilities.yml');
  const capsDoc = parseYaml(readFileSync(capsPath, 'utf8'));

  const mapPath = join(OPENCODE_NEXUS_ROOT, 'capability-map.yml');
  const mapDoc = parseYaml(readFileSync(mapPath, 'utf8'));
  const classMap = mapDoc.semantic_class_map;

  const result = new Map();
  for (const cap of capsDoc.capabilities) {
    const seen = new Set();
    const tools = [];
    for (const cls of cap.blocks_semantic_classes ?? []) {
      const mapped = classMap[cls];
      if (mapped === undefined) {
        throw new Error(
          `Semantic class "${cls}" (from capability "${cap.id}") has no entry in capability-map.yml. ` +
          `Add it to maintain full coverage.`
        );
      }
      for (const tool of mapped) {
        if (!seen.has(tool)) {
          seen.add(tool);
          tools.push(tool);
        }
      }
    }
    result.set(cap.id, tools);
  }
  return result;
}

// ==========================================================================
// Hash verification
// ==========================================================================

/**
 * Verify content sha256 matches expected "sha256:<hex>" prefix. Throws on mismatch.
 * @param {string} content
 * @param {string} expectedHashPrefixed e.g. "sha256:abc123..."
 * @param {string} [label]
 */
export function verifyBodyHash(content, expectedHashPrefixed, label = '') {
  const actual = 'sha256:' + createHash('sha256').update(content).digest('hex');
  if (actual !== expectedHashPrefixed) {
    throw new Error(
      `body_hash mismatch${label ? ` for ${label}` : ''}:\n` +
      `  expected: ${expectedHashPrefixed}\n` +
      `  actual:   ${actual}`
    );
  }
}

// ==========================================================================
// Derive disallowedTools
// ==========================================================================

/**
 * Derive disallowedTools array from capability ids using capability-map.yml resolution.
 * Preserves insertion order, dedupes via Set, throws on unmapped capability.
 * @param {string[]} capabilityIds
 * @param {Map<string, string[]>} capsMap
 * @returns {string[]}
 */
export function deriveDisallowedTools(capabilityIds, capsMap) {
  const seen = new Set();
  const result = [];
  for (const capId of capabilityIds ?? []) {
    const tools = capsMap.get(capId);
    if (!tools) {
      throw new Error(
        `Capability "${capId}" not found in vocabulary/capabilities.yml. ` +
        `Cannot safely derive disallowedTools.`
      );
    }
    for (const tool of tools) {
      if (!seen.has(tool)) {
        seen.add(tool);
        result.push(tool);
      }
    }
  }
  return result;
}

// ==========================================================================
// Transform functions
// ==========================================================================

/**
 * Normalize a multi-line folded description to a single line.
 * @param {string} s
 * @returns {string}
 */
function collapseDescription(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/**
 * Transform one agent's meta + body.
 * Returns a structured object for TypeScript literal emission (commit #2 wires this into the
 * actual TS codegen; scaffold only in commit #1).
 * @param {any} meta - parsed meta.yml object
 * @param {string} body - raw body.md content (already sha256-verified by caller)
 * @param {Map<string, string[]>} capsMap
 * @param {string} [label]
 * @returns {{ prompt: string, meta: { id: string, name: string, category: string, description: string, model: string, disallowedTools: string[], task?: string, alias_ko?: string, resume_tier: string } }}
 */
export function transformAgent(meta, body, capsMap, label = '') {
  const model = MODEL_TIER_TO_OPENCODE[meta.model_tier];
  if (!model) {
    throw new Error(`Unknown model_tier "${meta.model_tier}" for ${label || meta.id}`);
  }

  const disallowedTools = deriveDisallowedTools(meta.capabilities, capsMap);

  const agentMeta = {
    id: meta.id,
    name: meta.name,
    category: meta.category,
    description: collapseDescription(meta.description),
    model,
    disallowedTools,
    ...(meta.task ? { task: meta.task } : {}),
    ...(meta.alias_ko ? { alias_ko: meta.alias_ko } : {}),
    resume_tier: meta.resume_tier,
  };

  return { prompt: body, meta: agentMeta };
}

/**
 * Escape a raw string for safe embedding inside a JavaScript template literal.
 * Order matters: backslash must be escaped first.
 * @param {string} s
 * @returns {string}
 */
export function escapeTemplateLiteral(s) {
  return s
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('${', '\\${');
}

/**
 * Emit one AGENT_META entry as a TypeScript object literal string.
 * @param {{ id: string, name: string, category: string, description: string, model: string, disallowedTools: string[], task?: string, alias_ko?: string, resume_tier: string }} meta
 * @returns {string}
 */
function emitAgentMetaEntry(meta) {
  const lines = [
    `    id: ${JSON.stringify(meta.id)},`,
    `    name: ${JSON.stringify(meta.name)},`,
    `    category: ${JSON.stringify(meta.category)},`,
    `    description: ${JSON.stringify(meta.description)},`,
    `    model: ${JSON.stringify(meta.model)},`,
    `    disallowedTools: [${meta.disallowedTools.map(t => JSON.stringify(t)).join(', ')}],`,
  ];
  if (meta.task) lines.push(`    task: ${JSON.stringify(meta.task)},`);
  if (meta.alias_ko) lines.push(`    alias_ko: ${JSON.stringify(meta.alias_ko)},`);
  lines.push(`    resume_tier: ${JSON.stringify(meta.resume_tier)},`);
  return `  ${meta.id}: {\n${lines.join('\n')}\n  },`;
}

/**
 * Build the content of src/agents/prompts.generated.ts from accumulated agent entries.
 * @param {{ id: string, prompt: string, meta: object }[]} agents
 * @param {string} nexusCoreVersion
 * @param {string} nexusCoreCommit
 * @param {Map<string, string[]>} capsMap
 * @returns {string}
 */
export function buildAgentPromptsFile(agents, nexusCoreVersion, nexusCoreCommit, capsMap) {
  const promptEntries = agents
    .map(({ id, prompt }) => `  ${id}: \`${escapeTemplateLiteral(prompt)}\`,`)
    .join('\n');

  const metaEntries = agents
    .map(({ meta }) => emitAgentMetaEntry(meta))
    .join('\n');

  const noFileEditTools = capsMap.get('no_file_edit') ?? [];
  const noFileEditLiteral = noFileEditTools.map(t => JSON.stringify(t)).join(', ');

  return [
    `// AUTO-GENERATED — do not edit by hand.`,
    `// Source: @moreih29/nexus-core@${nexusCoreVersion} (${nexusCoreCommit})`,
    `// Regenerate: bun run generate:prompts`,
    ``,
    `export const AGENT_PROMPTS: Record<string, string> = {`,
    promptEntries,
    `};`,
    ``,
    `export const AGENT_META: Record<string, {`,
    `  id: string;`,
    `  name: string;`,
    `  category: string;`,
    `  description: string;`,
    `  model: string;`,
    `  disallowedTools: string[];`,
    `  task?: string;`,
    `  alias_ko?: string;`,
    `  resume_tier: string;`,
    `}> = {`,
    metaEntries,
    `};`,
    ``,
    `export const NO_FILE_EDIT_TOOLS: readonly string[] = [${noFileEditLiteral}] as const;`,
    ``,
  ].join('\n');
}

/**
 * Build the content of src/skills/prompts.generated.ts from accumulated skill entries.
 * @param {{ id: string, prompt: string }[]} skills
 * @param {string} nexusCoreVersion
 * @param {string} nexusCoreCommit
 * @returns {string}
 */
export function buildSkillPromptsFile(skills, nexusCoreVersion, nexusCoreCommit) {
  const entries = skills
    .map(({ id, prompt }) => `  "${id}": \`${escapeTemplateLiteral(prompt)}\`,`)
    .join('\n');
  return [
    `// AUTO-GENERATED — do not edit by hand.`,
    `// Source: @moreih29/nexus-core@${nexusCoreVersion} (${nexusCoreCommit})`,
    `// Regenerate: bun run generate:prompts`,
    ``,
    `export const SKILL_PROMPTS: Record<string, string> = {`,
    entries,
    `};`,
    ``,
  ].join('\n');
}

/**
 * Derive skill trigger_display.
 * @param {any} meta
 * @param {string} pluginName
 * @returns {string}
 */
export function deriveSkillTriggerDisplay(meta, pluginName) {
  if (Array.isArray(meta.triggers) && meta.triggers.length > 0) {
    return `[${meta.triggers[0]}]`;
  }
  if (meta.manual_only === true) {
    return `/${pluginName}:${meta.id}`;
  }
  throw new Error(
    `Skill "${meta.id}" has neither triggers nor manual_only — ambiguous invocation`
  );
}

/**
 * Transform one skill's meta + body.
 * Returns a structured object for TypeScript literal emission (commit #2).
 * If meta.harness_docs_refs is a non-empty array, appends each harness doc
 * from harness-docs/{ref}.md to the prompt body. Missing files warn but do not fail.
 * @param {any} meta
 * @param {string} body - already verified
 * @param {string} pluginName
 * @param {string} [label]
 * @returns {{ prompt: string, meta: { id: string, name: string, description: string, trigger_display: string, purpose: string, disable_model_invocation?: boolean } }}
 */
export function transformSkill(meta, body, pluginName, label = '') {
  const purpose = meta.summary ?? collapseDescription(meta.description);
  if (!purpose) {
    throw new Error(
      `Skill "${meta.id}" has no summary or description field in meta.yml.`
    );
  }

  const skillMeta = {
    id: meta.id,
    name: meta.name,
    description: collapseDescription(meta.description),
    trigger_display: deriveSkillTriggerDisplay(meta, pluginName),
    purpose,
    ...(meta.manual_only === true ? { disable_model_invocation: true } : {}),
  };

  let prompt = body;
  if (Array.isArray(meta.harness_docs_refs) && meta.harness_docs_refs.length > 0) {
    for (const ref of meta.harness_docs_refs) {
      const docPath = join(OPENCODE_NEXUS_ROOT, 'harness-docs', `${ref}.md`);
      let content;
      try {
        content = readFileSync(docPath, 'utf8');
      } catch {
        console.warn(
          `[generate-from-nexus-core] harness_docs_refs: "${ref}.md" not found at ${docPath} — skipping`
        );
        continue;
      }
      prompt += `\n\n---\n\n## Harness-Specific: ${ref}\n\n${content}`;
    }
  }

  return { prompt, meta: skillMeta };
}

/**
 * Transform vocabulary tags to tags array format.
 * @param {any} tagsVocab - parsed vocabulary/tags.yml { tags: [...] }
 * @returns {Array<{tag: string, purpose: string}>}
 */
export function transformTags(tagsVocab) {
  return tagsVocab.tags.map(t => ({
    tag: t.trigger.replace(/^\[|\]$/g, ''),
    purpose: t.description,
  }));
}

/**
 * Load plugin name from opencode.json or package.json name field.
 * @returns {string}
 */
let _pluginNameCache = null;
export function loadPluginName() {
  if (_pluginNameCache !== null) return _pluginNameCache;
  const pkgPath = join(OPENCODE_NEXUS_ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  // opencode plugin name is the npm package name (without scope)
  _pluginNameCache = pkg.name;
  return _pluginNameCache;
}

/**
 * Load vocabulary/tags.yml for tag drift checking (also used by transformTags).
 * @returns {any}
 */
export function loadTagsVocab() {
  const path = join(NEXUS_CORE_ROOT, 'vocabulary/tags.yml');
  return parseYaml(readFileSync(path, 'utf8'));
}

// ==========================================================================
// Tag drift detection
// ==========================================================================

/**
 * Extract HANDLED_TAG_IDS array from tag-parser.ts source via targeted regex.
 * Returns empty array (with warn) if file is missing or constant is absent —
 * safe for scaffold commits before tag-parser.ts is updated.
 * @param {string} gateSrcPath
 * @returns {string[]}
 */
export function loadHandledTagIdsFromGate(gateSrcPath) {
  let src;
  try {
    src = readFileSync(gateSrcPath, 'utf8');
  } catch {
    console.warn(
      `[generate-from-nexus-core] HANDLED_TAG_IDS source not readable: ${gateSrcPath}. ` +
      `Skipping tag drift check (scaffold mode).`
    );
    return [];
  }
  const m = src.match(
    /export\s+const\s+HANDLED_TAG_IDS\s*=\s*\[([^\]]+)\]\s*as\s+const\s*;/
  );
  if (!m) {
    console.warn(
      `[generate-from-nexus-core] HANDLED_TAG_IDS constant not found in ${gateSrcPath}. ` +
      `Skipping tag drift check (scaffold mode).`
    );
    return [];
  }
  return m[1]
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/**
 * Verify that tag-parser.ts HANDLED_TAG_IDS set-equals nexus-core vocabulary/tags.yml ids.
 * Warns only (does not throw) when loadHandledTagIdsFromGate returns empty —
 * safe for scaffold commits before HANDLED_TAG_IDS is defined.
 * @param {any} tagsVocab - parsed vocabulary/tags.yml
 * @param {string} gateSrcPath
 */
export function verifyTagDrift(tagsVocab, gateSrcPath) {
  const fromGate = loadHandledTagIdsFromGate(gateSrcPath);
  if (fromGate.length === 0) {
    // Already warned by loadHandledTagIdsFromGate; skip drift check.
    return;
  }
  const fromVocab = new Set(tagsVocab.tags.map(t => t.id));
  const fromGateSet = new Set(fromGate);
  const missingInGate = [...fromVocab].filter(x => !fromGateSet.has(x));
  const extraInGate = fromGate.filter(x => !fromVocab.has(x));
  if (missingInGate.length > 0 || extraInGate.length > 0) {
    throw new Error(
      `Tag drift detected:\n` +
      (missingInGate.length ? `  Missing in tag-parser.ts: [${missingInGate.join(', ')}]\n` : '') +
      (extraInGate.length ? `  Extra in tag-parser.ts (not in vocab): [${extraInGate.join(', ')}]\n` : '')
    );
  }
}

// ==========================================================================
// Catalog consistency
// ==========================================================================

/**
 * Agents whose catalog.ts disallowedTools intentionally diverges from
 * AGENT_META (resolved from nexus-core capabilities). Each entry must
 * reference an open upstream issue explaining the divergence.
 *
 * postdoc: opencode-nexus blocks `bash` for the research-methodology agent.
 *   nexus-core plan session #2 Issue #3 rejected adding `no_shell_exec`
 *   (see nexus-core/.nexus/context/boundaries.md:100). We filed
 *   moreih29/nexus-core#3 requesting reconsideration as an opt-in capability.
 *   Until that lands, postdoc's catalog.ts entry keeps `bash` in disallowedTools
 *   while AGENT_META does not — consistency check skips this agent.
 */
const CATALOG_CONSISTENCY_EXEMPT = new Set([
  'postdoc', // Gap 1 workaround — see moreih29/nexus-core#3
]);

/**
 * Verify that `NEXUS_AGENT_CATALOG[id].disallowedTools` in catalog.ts matches
 * `AGENT_META[id].disallowedTools` in the generated file, detecting silent
 * drift. Reads catalog.ts as text (no TypeScript preprocessor available in the
 * build script) and uses a regex to extract each agent's disallowedTools array.
 *
 * Exempt agents (see CATALOG_CONSISTENCY_EXEMPT) are skipped entirely.
 *
 * Throws ERR_CATALOG_MISMATCH on any drift (hard-fail; extends the §8.8 error set).
 *
 * @param {Array<{id: string, meta: {disallowedTools: string[]}}>} agentEntries
 * @param {string} catalogPath - absolute path to src/agents/catalog.ts
 */
export function verifyCatalogConsistency(agentEntries, catalogPath) {
  const src = readFileSync(catalogPath, 'utf8');
  const issues = [];

  for (const entry of agentEntries) {
    if (CATALOG_CONSISTENCY_EXEMPT.has(entry.id)) continue;

    // Match: id: "architect" ... disallowedTools: ["edit", "write", ...]
    // Across newlines between id and disallowedTools.
    const pattern = new RegExp(
      `id:\\s*["']${entry.id}["'][\\s\\S]*?disallowedTools:\\s*\\[([^\\]]*)\\]`,
      'm'
    );
    const match = src.match(pattern);
    if (!match) {
      issues.push(`  ${entry.id}: not found in catalog.ts (or missing disallowedTools field)`);
      continue;
    }

    const catalogTools = match[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
    const metaTools = entry.meta?.disallowedTools ?? [];

    const catalogSet = new Set(catalogTools);
    const metaSet = new Set(metaTools);
    const missingInCatalog = [...metaSet].filter((x) => !catalogSet.has(x));
    const extraInCatalog = [...catalogSet].filter((x) => !metaSet.has(x));

    if (missingInCatalog.length || extraInCatalog.length) {
      issues.push(
        `  ${entry.id}:` +
          (missingInCatalog.length
            ? ` missing in catalog.ts=[${missingInCatalog.join(', ')}]`
            : '') +
          (extraInCatalog.length
            ? ` extra in catalog.ts=[${extraInCatalog.join(', ')}]`
            : '')
      );
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `ERR_CATALOG_MISMATCH: catalog.ts disallowedTools drift vs AGENT_META\n` +
        issues.join('\n') +
        `\n\nUpdate catalog.ts to match AGENT_META, or add the agent to ` +
        `CATALOG_CONSISTENCY_EXEMPT with an upstream issue reference.`
    );
  }
}

// ==========================================================================
// File writing
// ==========================================================================

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

/**
 * Write file content, creating parent directories as needed. LF only.
 * @param {string} dst - absolute path
 * @param {string} content
 */
export function writeGenerated(dst, content) {
  const dir = dirname(dst);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(dst, content, 'utf8');
}
