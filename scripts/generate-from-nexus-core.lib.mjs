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
// Invocation map and macro expansion (v0.8.0)
// ==========================================================================

let _invocationMapCache = null;

/**
 * Load invocation-map.yml from the opencode-nexus root.
 * Cached after first load.
 * @returns {any}
 */
export function loadInvocationMap() {
  if (_invocationMapCache !== null) return _invocationMapCache;
  const mapPath = join(OPENCODE_NEXUS_ROOT, 'invocation-map.yml');
  _invocationMapCache = parseYaml(readFileSync(mapPath, 'utf8'));
  return _invocationMapCache;
}

/**
 * Load canonical invocation ids from nexus-core vocabulary.
 * @returns {Set<string>}
 */
export function loadInvocationIds() {
  const path = join(NEXUS_CORE_ROOT, 'vocabulary/invocations.yml');
  const doc = parseYaml(readFileSync(path, 'utf8'));
  return new Set((doc.invocations ?? []).map(invocation => invocation.id));
}

/**
 * Apply cross-harness replacement: replace all occurrences of
 * each key in cross_harness_map with its mapped value.
 * e.g., "claude-nexus:nx-plan" -> "opencode-nexus:nx-plan"
 * @param {string} content
 * @returns {string}
 */
export function applyCrossHarnessReplacement(content) {
  const map = loadInvocationMap();
  const crossMap = map.cross_harness_map ?? {};
  let result = content;
  for (const [from, to] of Object.entries(crossMap)) {
    if (from && to) {
      result = result.split(from).join(to);
    }
  }
  return result;
}

/**
 * Parse one macro parameter value.
 * Supports quoted strings, arrays, objects, and heredoc markers (>>IDENT).
 * @param {string} source
 * @param {number} start
 * @returns {{ value: string, nextIndex: number }}
 */
function parseMacroValue(source, start) {
  const ch = source[start];
  if (ch === '"' || ch === "'") {
    let i = start + 1;
    let value = '';
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        value += source[i + 1];
        i += 2;
        continue;
      }
      if (source[i] === ch) return { value, nextIndex: i + 1 };
      value += source[i];
      i += 1;
    }
    throw new Error(`Unterminated quoted value in macro params: ${source}`);
  }

  if (source.startsWith('>>', start)) {
    let i = start + 2;
    while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i += 1;
    return { value: source.slice(start, i), nextIndex: i };
  }

  if (ch === '[' || ch === '{') {
    const stack = [ch];
    const closing = { '[': ']', '{': '}' };
    let i = start + 1;
    while (i < source.length && stack.length > 0) {
      const current = source[i];
      if (current === '"' || current === "'") {
        const parsed = parseMacroValue(source, i);
        i = parsed.nextIndex;
        continue;
      }
      if (current === '[' || current === '{') stack.push(current);
      if ((current === ']' || current === '}') && current === closing[stack[stack.length - 1]]) {
        stack.pop();
      }
      i += 1;
    }
    if (stack.length > 0) throw new Error(`Unterminated structured value in macro params: ${source}`);
    return { value: source.slice(start, i), nextIndex: i };
  }

  let i = start;
  while (i < source.length && !/\s/.test(source[i])) i += 1;
  return { value: source.slice(start, i), nextIndex: i };
}

/**
 * Parse `key=value` params from a macro header.
 * @param {string} source
 * @returns {Record<string, string>}
 */
function parseMacroParams(source) {
  const params = {};
  let i = 0;
  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i])) i += 1;
    if (i >= source.length) break;

    const keyStart = i;
    while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i += 1;
    const key = source.slice(keyStart, i);
    if (!key) throw new Error(`Invalid macro params near: ${source.slice(i)}`);

    while (i < source.length && /\s/.test(source[i])) i += 1;
    if (source[i] !== '=') throw new Error(`Expected '=' after macro param ${key}`);
    i += 1;
    while (i < source.length && /\s/.test(source[i])) i += 1;

    const parsed = parseMacroValue(source, i);
    params[key] = parsed.value;
    i = parsed.nextIndex;
  }
  return params;
}

/**
 * Parse user_question options into a simple prose list when possible.
 * @param {string} optionsRaw
 * @returns {string}
 */
function formatQuestionOptions(optionsRaw) {
  if (!optionsRaw || optionsRaw === '[]') return '1. Type your answer';

  const entries = [];
  const objectPattern = /\{\s*label:\s*("([^"]*)"|'([^']*)'|([^,}]+))\s*,\s*description:\s*("([^"]*)"|'([^']*)'|([^}]+))\s*\}/g;
  let match;
  while ((match = objectPattern.exec(optionsRaw)) !== null) {
    const label = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    const description = (match[6] ?? match[7] ?? match[8] ?? '').trim();
    entries.push(`${entries.length + 1}. ${label}${description ? ` - ${description}` : ''}`);
  }

  if (entries.length > 0) return entries.join('\n');
  return `1. ${optionsRaw}`;
}

/**
 * Render a concrete local fallback for a single primitive invocation.
 * @param {string} primitiveId
 * @param {Record<string, string>} params
 * @returns {string}
 */
function renderPrimitive(primitiveId, params) {
  const map = loadInvocationMap();

  if (primitiveId === 'skill_activation') {
    const skillTool = map.skill_activation?.tool ?? 'skill';
    const bits = [`name: ${JSON.stringify(params.skill ?? '')}`];
    if (params.mode) bits.push(`mode: ${JSON.stringify(params.mode)}`);
    const modeSuffix = params.mode ? ' (experimental `mode` passthrough)' : '';
    return `${skillTool}({ ${bits.join(', ')} })${modeSuffix}`;
  }

  if (primitiveId === 'subagent_spawn') {
    const taskTool = map.subagent_spawn?.runtime_tool ?? 'task';
    const bits = [];
    bits.push(`description: ${JSON.stringify(params.name ?? '<short task description>')}`);
    if (params.prompt !== undefined) bits.push(`prompt: ${JSON.stringify(params.prompt)}`);
    bits.push(`subagent_type: ${JSON.stringify(params.target_role ?? '')}`);
    const rendered = `${taskTool}({ ${bits.join(', ')} })`;
    if (!params.resume_tier_hint) return rendered;
    return `${rendered} (resume_tier_hint ${JSON.stringify(params.resume_tier_hint)} remains advisory only)`;
  }

  if (primitiveId === 'task_register') {
    const todoTool = map.task_register?.approximation_tool ?? 'todowrite';
    return `${todoTool}({ todos: [{ content: ${JSON.stringify(params.label ?? '<task>')}, status: ${JSON.stringify(params.state ?? 'pending')}, priority: "medium" }] }) (approximation: session todo management, not a true task register)`;
  }

  if (primitiveId === 'user_question') {
    const questionTool = map.user_question?.tool ?? 'question';
    const questionBits = [
      `question: ${JSON.stringify(params.question ?? '')}`,
      `header: ${JSON.stringify(params.header ?? 'Response')}`,
      `options: ${params.options ?? '[]'}`,
      `multiple: ${params.multiple ?? 'false'}`,
    ];
    if (params.custom !== undefined) questionBits.push(`custom: ${params.custom}`);
    const lines = [`${questionTool}({ questions: [{ ${questionBits.join(', ')} }] })`];
    if (params.options !== undefined && params.options !== '[]') {
      lines.push('Options:');
      lines.push(formatQuestionOptions(params.options));
    }
    return lines.join('\n');
  }

  throw new Error(`Unsupported primitive_id "${primitiveId}" for local rendering.`);
}

/**
 * Expand `{{primitive ...}}` macros, including heredoc values.
 * @param {string} content
 * @returns {string}
 */
export function expandPrimitiveMacros(content) {
  const invocationIds = loadInvocationIds();
  let cursor = 0;
  let output = '';

  while (cursor < content.length) {
    const start = content.indexOf('{{', cursor);
    if (start === -1) {
      output += content.slice(cursor);
      break;
    }

    output += content.slice(cursor, start);
    const end = content.indexOf('}}', start);
    if (end === -1) throw new Error('Unterminated macro header in body.md');

    const header = content.slice(start + 2, end).trim();
    const spaceIndex = header.search(/\s/);
    const primitiveId = spaceIndex === -1 ? header : header.slice(0, spaceIndex);
    const argsStr = spaceIndex === -1 ? '' : header.slice(spaceIndex + 1).trim();

    if (!invocationIds.has(primitiveId)) {
      throw new Error(`Unknown primitive_id "${primitiveId}" in body.md macro.`);
    }

    const params = argsStr ? parseMacroParams(argsStr) : {};
    let nextCursor = end + 2;

    for (const [key, value] of Object.entries(params)) {
      if (!value.startsWith('>>')) continue;
      const ident = value.slice(2);
      if (!ident) throw new Error(`Invalid heredoc marker for param ${key} in ${primitiveId}`);

      const bodyStart = content[nextCursor] === '\n' ? nextCursor + 1 : nextCursor;
      const terminator = `\n<<${ident}`;
      const bodyEnd = content.indexOf(terminator, bodyStart);
      if (bodyEnd === -1) throw new Error(`Missing heredoc terminator <<${ident} for ${primitiveId}.${key}`);

      params[key] = content.slice(bodyStart, bodyEnd);
      let afterTerminator = bodyEnd + terminator.length;
      if (content[afterTerminator] === '\r') afterTerminator += 1;
      if (content[afterTerminator] === '\n') afterTerminator += 1;
      nextCursor = afterTerminator;
    }

    output += renderPrimitive(primitiveId, params);
    cursor = nextCursor;
  }

  return output;
}

/**
 * Apply all v0.8.0 body transformations:
 * - expand {{primitive ...}} macros with heredoc support
 * - apply cross-harness replacements
 * @param {string} body
 * @returns {string}
 */
export function transformBody(body) {
  let result = expandPrimitiveMacros(body);
  result = applyCrossHarnessReplacement(result);
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

  return { prompt: transformBody(body), meta: agentMeta };
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
    `  task: string;`,
    `  alias_ko: string;`,
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
 * Build the content for one agent's individual file (src/agents/generated/{id}.ts).
 * @param {{ id: string, prompt: string, meta: object }} agent
 * @param {string} nexusCoreVersion
 * @param {string} nexusCoreCommit
 * @returns {string}
 */
export function buildAgentIndividualFile(agent, nexusCoreVersion, nexusCoreCommit) {
  const { id, prompt, meta } = agent;
  const lines = [
    `// AUTO-GENERATED — do not edit by hand.`,
    `// Source: @moreih29/nexus-core@${nexusCoreVersion} (${nexusCoreCommit})`,
    `// Regenerate: bun run generate:prompts`,
    ``,
    `export const PROMPT = \`${escapeTemplateLiteral(prompt)}\`;`,
    ``,
    `export const META = {`,
    `  id: ${JSON.stringify(meta.id)},`,
    `  name: ${JSON.stringify(meta.name)},`,
    `  category: ${JSON.stringify(meta.category)},`,
    `  description: ${JSON.stringify(meta.description)},`,
    `  model: ${JSON.stringify(meta.model)},`,
    `  disallowedTools: [${meta.disallowedTools.map(t => JSON.stringify(t)).join(', ')}],`,
  ];
  if (meta.task) lines.push(`  task: ${JSON.stringify(meta.task)},`);
  if (meta.alias_ko) lines.push(`  alias_ko: ${JSON.stringify(meta.alias_ko)},`);
  lines.push(`  resume_tier: ${JSON.stringify(meta.resume_tier)},`);
  lines.push(`} as const;`);
  lines.push(``);
  return lines.join('\n');
}

/**
 * Build the index file content for src/agents/generated/index.ts.
 * @param {{ id: string, prompt: string, meta: object }[]} agents
 * @param {Map<string, string[]>} capsMap
 * @param {string} nexusCoreVersion
 * @param {string} nexusCoreCommit
 * @returns {string}
 */
export function buildAgentIndexFile(agents, capsMap, nexusCoreVersion, nexusCoreCommit) {
  const imports = agents
    .map(({ id }) => {
      const varId = id.replace(/-/g, '_');
      return `import { PROMPT as ${varId}_prompt, META as ${varId}_meta } from './${id}.js';`;
    })
    .join('\n');

  const promptEntries = agents
    .map(({ id }) => {
      const varId = id.replace(/-/g, '_');
      return `  ${JSON.stringify(id)}: ${varId}_prompt,`;
    })
    .join('\n');

  const metaEntries = agents
    .map(({ id }) => {
      const varId = id.replace(/-/g, '_');
      return `  ${JSON.stringify(id)}: ${varId}_meta,`;
    })
    .join('\n');

  const noFileEditTools = capsMap.get('no_file_edit') ?? [];
  const noFileEditLiteral = noFileEditTools.map(t => JSON.stringify(t)).join(', ');

  return [
    `// AUTO-GENERATED — do not edit by hand.`,
    `// Source: @moreih29/nexus-core@${nexusCoreVersion} (${nexusCoreCommit})`,
    `// Aggregates all agent prompts and metadata.`,
    ``,
    imports,
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
    `  disallowedTools: readonly string[];`,
    `  task: string;`,
    `  alias_ko: string;`,
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
 * Emit one SKILL_META entry as a TypeScript object literal string.
 * @param {{ id: string, name: string, description: string, trigger_display: string, purpose: string }} meta
 * @returns {string}
 */
function emitSkillMetaEntry(meta) {
  const lines = [
    `    id: ${JSON.stringify(meta.id)},`,
    `    name: ${JSON.stringify(meta.name)},`,
    `    description: ${JSON.stringify(meta.description)},`,
    `    trigger_display: ${JSON.stringify(meta.trigger_display)},`,
    `    purpose: ${JSON.stringify(meta.purpose)},`,
  ];
  return `  ${JSON.stringify(meta.id)}: {\n${lines.join('\n')}\n  },`;
}

/**
 * Build the content for one skill's individual file (src/skills/generated/{id}.ts).
 * @param {{ id: string, prompt: string, meta: { id: string, name: string, description: string, trigger_display: string, purpose: string } }} skill
 * @param {string} nexusCoreVersion
 * @param {string} nexusCoreCommit
 * @returns {string}
 */
export function buildSkillIndividualFile(skill, nexusCoreVersion, nexusCoreCommit) {
  const { prompt, meta } = skill;
  return [
    `// AUTO-GENERATED — do not edit by hand.`,
    `// Source: @moreih29/nexus-core@${nexusCoreVersion} (${nexusCoreCommit})`,
    `// Regenerate: bun run generate:prompts`,
    ``,
    `export const PROMPT = \`${escapeTemplateLiteral(prompt)}\`;`,
    ``,
    `export const META = {`,
    `  id: ${JSON.stringify(meta.id)},`,
    `  name: ${JSON.stringify(meta.name)},`,
    `  description: ${JSON.stringify(meta.description)},`,
    `  trigger_display: ${JSON.stringify(meta.trigger_display)},`,
    `  purpose: ${JSON.stringify(meta.purpose)},`,
    `} as const;`,
    ``,
  ].join('\n');
}

/**
 * Build the index file content for src/skills/generated/index.ts.
 * @param {{ id: string, prompt: string, meta: { id: string, name: string, description: string, trigger_display: string, purpose: string } }[]} skills
 * @param {string} nexusCoreVersion
 * @param {string} nexusCoreCommit
 * @returns {string}
 */
export function buildSkillIndexFile(skills, nexusCoreVersion, nexusCoreCommit) {
  const imports = skills
    .map(({ id }) => {
      const varId = id.replace(/-/g, '_');
      return `import { PROMPT as ${varId}_prompt, META as ${varId}_meta } from './${id}.js';`;
    })
    .join('\n');

  const promptEntries = skills
    .map(({ id }) => {
      const varId = id.replace(/-/g, '_');
      return `  ${JSON.stringify(id)}: ${varId}_prompt,`;
    })
    .join('\n');

  const metaEntries = skills
    .map(({ meta }) => emitSkillMetaEntry(meta))
    .join('\n');

  return [
    `// AUTO-GENERATED — do not edit by hand.`,
    `// Source: @moreih29/nexus-core@${nexusCoreVersion} (${nexusCoreCommit})`,
    `// Aggregates all skill prompts and metadata.`,
    ``,
    imports,
    ``,
    `export const SKILL_PROMPTS: Record<string, string> = {`,
    promptEntries,
    `};`,
    ``,
    `export const SKILL_META: Record<string, {`,
    `  id: string;`,
    `  name: string;`,
    `  description: string;`,
    `  trigger_display: string;`,
    `  purpose: string;`,
    `}> = {`,
    metaEntries,
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
    return `skill({ name: ${JSON.stringify(meta.id)} })`;
  }
  throw new Error(
    `Skill "${meta.id}" has neither triggers nor manual_only — ambiguous invocation`
  );
}

/**
 * Transform one skill's meta + body.
 * Returns a structured object for TypeScript literal emission (commit #2).
 * If meta.harness_docs_refs is a non-empty array, appends each harness doc
 * from harness-content/{ref}.md to the prompt body.
 *
 * Resolution order per ref:
 * 1) {ref}.md (existing behavior)
 * 2) {ref-with-underscores-replaced-by-hyphens}.md (consumer canonical naming fallback)
 *
 * Missing files warn but do not fail.
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

  let prompt = transformBody(body);
  if (Array.isArray(meta.harness_docs_refs) && meta.harness_docs_refs.length > 0) {
    for (const ref of meta.harness_docs_refs) {
      const candidates = [join(OPENCODE_NEXUS_ROOT, 'harness-content', `${ref}.md`)];
      const hyphenRef = ref.replaceAll('_', '-');
      if (hyphenRef !== ref) {
        candidates.push(join(OPENCODE_NEXUS_ROOT, 'harness-content', `${hyphenRef}.md`));
      }

      let content;
      let resolvedPath = null;
      for (const candidate of candidates) {
        try {
          content = readFileSync(candidate, 'utf8');
          resolvedPath = candidate;
          break;
        } catch {
          // Try next candidate.
        }
      }
      if (resolvedPath === null) {
        console.warn(
          `[generate-from-nexus-core] harness_docs_refs: "${ref}" not found. Tried: ${candidates.join(', ')} — skipping`
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
