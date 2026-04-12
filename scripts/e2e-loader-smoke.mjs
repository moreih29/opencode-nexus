import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// §8.7 e2e #3: prove that dist/ (the published bundle) loads without requiring
// `@moreih29/nexus-core` at runtime. nexus-core is a devDependency and its
// contents are baked into prompts.generated.ts at build time (§8.3).
// End users of the opencode-nexus npm package must not need nexus-core
// installed — any runtime reference to the package name would violate that
// contract and §9.2 (no runtime code sharing).

const __dirname = dirname(fileURLToPath(import.meta.url));
const distRoot = join(__dirname, "..", "dist");
const distIndex = join(distRoot, "index.js");
const distAgentsBarrel = join(distRoot, "agents", "prompts.js");
const distAgentsGenerated = join(distRoot, "agents", "generated", "index.js");
const distSkillsBarrel = join(distRoot, "skills", "prompts.js");
const distSkillsGenerated = join(distRoot, "skills", "generated", "index.js");

// (1) dist/index.js imports successfully
const plugin = await import(distIndex);
assert.ok(plugin, "dist/index.js failed to import");

// (2) dist compiled files do not reference @moreih29/nexus-core at runtime.
// The string may appear only inside a single-line comment (e.g., the
// AUTO-GENERATED header in prompts.generated.js that cites the source version).
const filesToScan = [distIndex, distAgentsBarrel, distAgentsGenerated, distSkillsBarrel, distSkillsGenerated];

for (const file of filesToScan) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idx = line.indexOf("@moreih29/nexus-core");
    if (idx === -1) continue;
    // Allow the reference only if the line is a // comment before the reference
    const commentIdx = line.indexOf("//");
    if (commentIdx !== -1 && commentIdx <= idx) continue;
    throw new Error(
      `devDependency contract violation: runtime reference to @moreih29/nexus-core ` +
        `found in ${file}:${i + 1}\n  ${line.trim()}`
    );
  }
}

// (3) AGENT_PROMPTS is accessible at runtime via the compiled barrel
const { AGENT_PROMPTS, AGENT_META } = await import(distAgentsBarrel);
assert.equal(typeof AGENT_PROMPTS.architect, "string", "AGENT_PROMPTS.architect not accessible via dist barrel");
assert.ok(AGENT_PROMPTS.architect.length > 100, "AGENT_PROMPTS.architect body empty via dist barrel");
assert.equal(AGENT_META.architect.id, "architect", "AGENT_META.architect.id mismatch via dist barrel");

// (4) SKILL_PROMPTS is accessible via the compiled skills barrel
const { SKILL_PROMPTS } = await import(distSkillsBarrel);
assert.equal(typeof SKILL_PROMPTS["nx-plan"], "string", 'SKILL_PROMPTS["nx-plan"] not accessible via dist barrel');
assert.ok(SKILL_PROMPTS["nx-plan"].length > 100, 'SKILL_PROMPTS["nx-plan"] body empty via dist barrel');

console.log(
  `e2e loader-smoke passed (dist bundle loads without @moreih29/nexus-core runtime reference)`
);
