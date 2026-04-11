// Ported from: claude-nexus/generate-from-nexus-core.mjs @ commit 94997d1 — sync with upstream when Gap fixes merge.
// Entry point: reads @moreih29/nexus-core assets and writes opencode-nexus
// src/agents/prompts.generated.ts, src/skills/prompts.generated.ts.

import { readFileSync } from 'node:fs';
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
  transformAgent,
  transformSkill,
  buildAgentPromptsFile,
  buildSkillPromptsFile,
  loadPluginName,
  writeGenerated,
} from './generate-from-nexus-core.lib.mjs';

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
    agentEntries.push({ id: agentEntry.id, prompt: out.prompt });
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

  const agentFileContent = buildAgentPromptsFile(
    agentEntries,
    manifest.nexus_core_version,
    manifest.nexus_core_commit
  );
  writeGenerated(
    join(OPENCODE_NEXUS_ROOT, 'src/agents/prompts.generated.ts'),
    agentFileContent
  );

  const skillFileContent = buildSkillPromptsFile(
    skillEntries,
    manifest.nexus_core_version,
    manifest.nexus_core_commit
  );
  writeGenerated(
    join(OPENCODE_NEXUS_ROOT, 'src/skills/prompts.generated.ts'),
    skillFileContent
  );

  console.log(
    `[generate-from-nexus-core] @moreih29/nexus-core@${manifest.nexus_core_version}: ` +
    `${agentEntries.length} agents, ${skillEntries.length} skills written`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
