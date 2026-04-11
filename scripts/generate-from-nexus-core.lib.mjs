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

/** opencode-nexus local skill purpose strings (CA-2 workaround). Keyed by skill id. */
export const SKILL_PURPOSE_OVERRIDE = {
  'nx-init':  'Full project onboarding: scan codebase, establish project mission and essentials, generate context knowledge',
  'nx-plan':  'Structured planning — subagent-based analysis, deliberate decisions, produce execution plan',
  'nx-run':   'Execution — user-directed agent composition',
  'nx-setup': 'Configure Nexus interactively',
  'nx-sync':  'Synchronize .nexus/context/ design documents with current project state',
};

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
 * Reads vocabulary/capabilities.yml directly.
 * @returns {Map<string, string[]>}
 */
export function indexCapabilities() {
  const path = join(NEXUS_CORE_ROOT, 'vocabulary/capabilities.yml');
  const doc = parseYaml(readFileSync(path, 'utf8'));
  const map = new Map();
  for (const cap of doc.capabilities) {
    // opencode harness mapping (not claude_code)
    const tools = cap.harness_mapping?.opencode ?? [];
    map.set(cap.id, tools);
  }
  return map;
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
 * Derive disallowedTools array from capability ids using opencode harness mapping.
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
        `Capability "${capId}" has no harness_mapping.opencode in vocabulary/capabilities.yml. ` +
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

  // TODO (commit #2): emit TypeScript literal for src/agents/prompts.generated.ts
  // For now, return raw body as prompt and structured meta for downstream use.
  return { prompt: body, meta: agentMeta };
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
 * @param {any} meta
 * @param {string} body - already verified
 * @param {string} pluginName
 * @param {string} [label]
 * @returns {{ prompt: string, meta: { id: string, name: string, description: string, trigger_display: string, purpose: string, disable_model_invocation?: boolean } }}
 */
export function transformSkill(meta, body, pluginName, label = '') {
  const purpose = SKILL_PURPOSE_OVERRIDE[meta.id];
  if (!purpose) {
    throw new Error(
      `No SKILL_PURPOSE_OVERRIDE entry for skill "${meta.id}". ` +
      `Add it to generate-from-nexus-core.lib.mjs.`
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

  // TODO (commit #2): emit TypeScript literal for src/skills/prompts.generated.ts
  return { prompt: body, meta: skillMeta };
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
