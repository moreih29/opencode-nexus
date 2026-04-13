import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { installSkillFiles } from "../dist/create-config.js";

const SKILL_IDS = ["nx-plan", "nx-run", "nx-init", "nx-sync", "nx-setup"];

function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

// no-op logger matching the expected signature
async function noop(_args) {}

let passed = 0;

// Setup: create temp project directory
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-e2e-"));

try {
  // Case 1-2: Install skill files — all 5 SKILL.md files created
  await installSkillFiles(tmpDir, noop);

  for (const skillId of SKILL_IDS) {
    const destFile = path.join(tmpDir, ".opencode", "skills", skillId, "SKILL.md");
    let stat;
    try {
      stat = await fs.stat(destFile);
    } catch {
      assert.fail(`[1] Expected ${destFile} to exist after installSkillFiles`);
    }
    assert.ok(stat.isFile(), `[1] ${destFile} should be a file`);
  }
  passed++;
  console.log("PASS [1] all 5 SKILL.md files exist after first installSkillFiles call");

  // Case 2: Verify file contents match templates (non-frontmatter body substring check)
  // The template files live under templates/skills/<id>/SKILL.md relative to project root
  const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const templatesRoot = path.join(projectRoot, "templates", "skills");

  for (const skillId of SKILL_IDS) {
    const templateFile = path.join(templatesRoot, skillId, "SKILL.md");
    const destFile = path.join(tmpDir, ".opencode", "skills", skillId, "SKILL.md");

    const templateContent = await fs.readFile(templateFile, "utf8");
    const destContent = await fs.readFile(destFile, "utf8");

    // Strip YAML frontmatter (--- ... ---) for body comparison
    const stripFrontmatter = (s) => {
      if (s.startsWith("---")) {
        const end = s.indexOf("---", 3);
        if (end !== -1) return s.slice(end + 3).trimStart();
      }
      return s;
    };

    const templateBody = stripFrontmatter(templateContent);
    const destBody = stripFrontmatter(destContent);

    // Full content should match (installSkillFiles copies verbatim)
    assert.equal(
      destContent,
      templateContent,
      `[2] ${skillId}/SKILL.md content does not match template (full content differs)`
    );

    // Body substring: at least first 50 chars of body should match
    if (templateBody.length > 0) {
      assert.ok(
        destBody.includes(templateBody.slice(0, 50)),
        `[2] ${skillId}/SKILL.md body does not contain expected template body prefix`
      );
    }
  }
  passed++;
  console.log("PASS [2] all 5 SKILL.md contents match template files verbatim");

  // Case 3: Idempotency — second call should not create .bak files
  await installSkillFiles(tmpDir, noop);

  for (const skillId of SKILL_IDS) {
    const bakFile = path.join(tmpDir, ".opencode", "skills", skillId, "SKILL.md.bak");
    let bakExists = false;
    try {
      await fs.stat(bakFile);
      bakExists = true;
    } catch {
      // expected — bak should not exist
    }
    assert.ok(!bakExists, `[3] Unexpected .bak file created for ${skillId} on identical content reinstall`);
  }
  passed++;
  console.log("PASS [3] second installSkillFiles call is idempotent — no .bak files created");

  // Case 4: User edit simulation — edited file gets backed up, template restored
  const testSkillId = "nx-plan";
  const testFile = path.join(tmpDir, ".opencode", "skills", testSkillId, "SKILL.md");
  const userEditedContent = "user edited content — should be backed up";
  await fs.writeFile(testFile, userEditedContent, "utf8");

  await installSkillFiles(tmpDir, noop);

  // .bak should exist and contain the user-edited content
  const bakFile = path.join(tmpDir, ".opencode", "skills", testSkillId, "SKILL.md.bak");
  let bakContent;
  try {
    bakContent = await fs.readFile(bakFile, "utf8");
  } catch {
    assert.fail(`[4] Expected .bak file at ${bakFile} after user-edit + reinstall`);
  }
  assert.equal(
    bakContent,
    userEditedContent,
    `[4] .bak file should contain original user-edited content`
  );

  // SKILL.md should now be restored to template
  const templateFile = path.join(templatesRoot, testSkillId, "SKILL.md");
  const templateContent = await fs.readFile(templateFile, "utf8");
  const restoredContent = await fs.readFile(testFile, "utf8");
  assert.equal(
    restoredContent,
    templateContent,
    `[4] SKILL.md should be restored to template content after user-edit backup`
  );
  passed++;
  console.log("PASS [4] user-edited file backed up to .bak + template restored on reinstall");

} finally {
  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
}

console.log(`\n✓ e2e-entrypoint-skills.mjs: ${passed} cases passed`);
