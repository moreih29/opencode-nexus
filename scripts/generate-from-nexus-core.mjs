// Ported from: claude-nexus/generate-from-nexus-core.mjs @ commit 94997d1 — sync with upstream when Gap fixes merge.
// Entry point: reads @moreih29/nexus-core assets and writes opencode-nexus
// src/agents/prompts.generated.ts, src/skills/prompts.generated.ts.
// Not yet wired into the build chain (commit #2 activates this).

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
  transformTags,
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

  let agentCount = 0;
  for (const agentEntry of manifest.agents) {
    const metaPath = join(NEXUS_CORE_ROOT, 'agents', agentEntry.id, 'meta.yml');
    const bodyPath = join(NEXUS_CORE_ROOT, 'agents', agentEntry.id, 'body.md');
    const meta = parseYaml(readFileSync(metaPath, 'utf8'));
    const body = readFileSync(bodyPath, 'utf8');
    verifyBodyHash(body, agentEntry.body_hash, `agents/${agentEntry.id}/body.md`);
    const out = transformAgent(meta, body, capsMap, `agents/${agentEntry.id}`);
    // TODO (commit #2): write TypeScript literal to src/agents/prompts.generated.ts
    // writeGenerated(join(OPENCODE_NEXUS_ROOT, 'src/agents/prompts.generated.ts'), out);
    void out;
    agentCount++;
  }

  let skillCount = 0;
  for (const skillEntry of manifest.skills) {
    const metaPath = join(NEXUS_CORE_ROOT, 'skills', skillEntry.id, 'meta.yml');
    const bodyPath = join(NEXUS_CORE_ROOT, 'skills', skillEntry.id, 'body.md');
    const meta = parseYaml(readFileSync(metaPath, 'utf8'));
    const body = readFileSync(bodyPath, 'utf8');
    verifyBodyHash(body, skillEntry.body_hash, `skills/${skillEntry.id}/body.md`);
    const out = transformSkill(meta, body, pluginName, `skills/${skillEntry.id}`);
    // TODO (commit #2): write TypeScript literal to src/skills/prompts.generated.ts
    // writeGenerated(join(OPENCODE_NEXUS_ROOT, 'src/skills/prompts.generated.ts'), out);
    void out;
    skillCount++;
  }

  const tags = transformTags(tagsVocab);
  // TODO (commit #2): decide output path for tags in opencode-nexus (src/data/tags.json or inline)
  void tags;

  console.log(
    `[generate-from-nexus-core] Scaffold dry-run — @moreih29/nexus-core@${manifest.nexus_core_version}: ` +
    `${agentCount} agents, ${skillCount} skills, ${tags.length} tags (no files written yet)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
