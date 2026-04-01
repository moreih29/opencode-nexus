import fs from "node:fs/promises";
import path from "node:path";

import { NEXUS_AGENT_CATALOG } from "../dist/agents/catalog.js";
import { NEXUS_SKILL_CATALOG } from "../dist/skills/catalog.js";

const root = process.cwd();
const outDir = path.join(root, "templates");
const outFile = path.join(outDir, "nexus-section.md");

await fs.mkdir(outDir, { recursive: true });

const agents = NEXUS_AGENT_CATALOG.map((a) => `| ${a.name} | ${a.category} | ${a.model} |`).join("\n");
const skills = NEXUS_SKILL_CATALOG.map((s) => `| ${s.id} | ${s.trigger} | ${s.purpose} |`).join("\n");

const content = [
  "## Nexus Agent Catalog",
  "",
  "| Name | Category | Model |",
  "|---|---|---|",
  agents,
  "",
  "## Nexus Skill Catalog",
  "",
  "| Skill | Trigger | Purpose |",
  "|---|---|---|",
  skills,
  ""
].join("\n");

await fs.writeFile(outFile, content, "utf8");
console.log(`generated ${path.relative(root, outFile)}`);
