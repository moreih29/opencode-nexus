// Ported from: claude-nexus/generate-from-nexus-core.mjs @ commit 94997d1 — sync with upstream when Gap fixes merge.
// Entry point: reads @moreih29/nexus-core assets and writes opencode-nexus
// src/agents/generated/{id}.ts + index.ts, src/skills/generated/{id}.ts + index.ts.

import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  OPENCODE_NEXUS_ROOT,
  NEXUS_CORE_ROOT,
  loadManifest,
  verifyManifestVersion,
  indexCapabilities,
  loadTagsVocab,
  verifyTagDrift,
  verifyBodyHash,
  verifyCatalogConsistency,
  transformAgent,
  transformSkill,
  buildAgentIndividualFile,
  buildAgentIndexFile,
  buildSkillIndividualFile,
  buildSkillIndexFile,
  loadPluginName,
  writeGenerated,
} from './generate-from-nexus-core.lib.mjs';

/**
 * Remove all *.ts files from a directory if it exists.
 * @param {string} dir
 */
function cleanGeneratedDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    // Directory doesn't exist yet — nothing to clean.
    return;
  }
  for (const entry of entries) {
    if (entry.endsWith('.ts')) {
      rmSync(join(dir, entry), { force: true });
    }
  }
}

async function main() {
  const manifest = loadManifest();
  verifyManifestVersion(manifest);

  // tag-parser.ts path in opencode-nexus (HANDLED_TAG_IDS lives here, not gate.ts)
  const gateSrcPath = join(OPENCODE_NEXUS_ROOT, 'src/shared/tag-parser.ts');
  const tagsVocab = loadTagsVocab();
  // verifyTagDrift is optional in scaffold mode — warns only if HANDLED_TAG_IDS absent
  verifyTagDrift(tagsVocab, gateSrcPath);

  const capsMap = indexCapabilities();
  const pluginName = loadPluginName();

  const agentEntries = [];
  for (const agentEntry of manifest.agents) {
    const metaPath = join(NEXUS_CORE_ROOT, 'agents', agentEntry.id, 'meta.yml');
    const bodyPath = join(NEXUS_CORE_ROOT, 'agents', agentEntry.id, 'body.md');
    const meta = parseYaml(readFileSync(metaPath, 'utf8'));
    const body = readFileSync(bodyPath, 'utf8');
    verifyBodyHash(body, agentEntry.body_hash, `agents/${agentEntry.id}/body.md`);
    const out = transformAgent(meta, body, capsMap, `agents/${agentEntry.id}`);
    agentEntries.push({ id: agentEntry.id, prompt: out.prompt, meta: out.meta });
  }

  const skillEntries = [];
  for (const skillEntry of manifest.skills) {
    const metaPath = join(NEXUS_CORE_ROOT, 'skills', skillEntry.id, 'meta.yml');
    const bodyPath = join(NEXUS_CORE_ROOT, 'skills', skillEntry.id, 'body.md');
    const meta = parseYaml(readFileSync(metaPath, 'utf8'));
    const body = readFileSync(bodyPath, 'utf8');
    verifyBodyHash(body, skillEntry.body_hash, `skills/${skillEntry.id}/body.md`);
    const out = transformSkill(meta, body, pluginName, `skills/${skillEntry.id}`);
    skillEntries.push({ id: skillEntry.id, prompt: out.prompt });
  }

  // Consistency check: NEXUS_AGENT_CATALOG[id].disallowedTools must match
  // AGENT_META[id].disallowedTools (resolved from capabilities). Throws
  // ERR_CATALOG_MISMATCH on drift (exempt agents like postdoc are skipped).
  const catalogPath = join(OPENCODE_NEXUS_ROOT, 'src/agents/catalog.ts');
  verifyCatalogConsistency(agentEntries, catalogPath);

  const agentsGeneratedDir = join(OPENCODE_NEXUS_ROOT, 'src/agents/generated');
  const skillsGeneratedDir = join(OPENCODE_NEXUS_ROOT, 'src/skills/generated');

  cleanGeneratedDir(agentsGeneratedDir);
  cleanGeneratedDir(skillsGeneratedDir);

  // Write individual agent files
  for (const agent of agentEntries) {
    writeGenerated(
      join(agentsGeneratedDir, `${agent.id}.ts`),
      buildAgentIndividualFile(agent, manifest.nexus_core_version, manifest.nexus_core_commit)
    );
  }

  // Write agent index
  writeGenerated(
    join(agentsGeneratedDir, 'index.ts'),
    buildAgentIndexFile(agentEntries, capsMap, manifest.nexus_core_version, manifest.nexus_core_commit)
  );

  // Write individual skill files
  for (const skill of skillEntries) {
    writeGenerated(
      join(skillsGeneratedDir, `${skill.id}.ts`),
      buildSkillIndividualFile(skill, manifest.nexus_core_version, manifest.nexus_core_commit)
    );
  }

  // Write skill index
  writeGenerated(
    join(skillsGeneratedDir, 'index.ts'),
    buildSkillIndexFile(skillEntries, manifest.nexus_core_version, manifest.nexus_core_commit)
  );

  console.log(
    `[generate-from-nexus-core] @moreih29/nexus-core@${manifest.nexus_core_version}: ` +
    `${agentEntries.length} agents, ${skillEntries.length} skills written to generated/`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
