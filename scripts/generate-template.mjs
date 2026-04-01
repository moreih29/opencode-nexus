import fs from "node:fs/promises";
import path from "node:path";

import { NEXUS_AGENT_CATALOG } from "../dist/agents/catalog.js";
import { NEXUS_SKILL_CATALOG } from "../dist/skills/catalog.js";
import { NEXUS_TAGS } from "../dist/shared/tags.js";

const root = process.cwd();
const outDir = path.join(root, "templates");
const outFile = path.join(outDir, "nexus-section.md");

await fs.mkdir(outDir, { recursive: true });

const agents = NEXUS_AGENT_CATALOG.map((a) => `| ${a.name} | ${a.category.toUpperCase()} | ${a.description} | ${a.id} |`).join("\n");
const skills = NEXUS_SKILL_CATALOG.map((s) => `| ${s.id} | ${s.trigger} | ${s.purpose} |`).join("\n");
const tags = NEXUS_TAGS.map((t) => `| ${t.tag} | ${t.purpose} |`).join("\n");

const content = [
  "## Nexus Agent Orchestration",
  "",
  "**Default: DELEGATE** - route code work, analysis, and multi-file changes to agents.",
  "",
  "### Agent Routing",
  "",
  "Use agents when parallel work or a second specialized perspective is helpful.",
  "",
  "| Name | Category | Task | Agent |",
  "|---|---|---|---|",
  agents,
  "",
  "Small single-file tasks can stay with the lead agent.",
  "",
  "### Skills",
  "",
  "| Skill | Trigger | Purpose |",
  "|---|---|---|",
  skills,
  "",
  "### Tags",
  "",
  "| Tag | Purpose |",
  "|---|---|",
  tags,
  ""
].join("\n");

await fs.writeFile(outFile, content, "utf8");
console.log(`generated ${path.relative(root, outFile)}`);
