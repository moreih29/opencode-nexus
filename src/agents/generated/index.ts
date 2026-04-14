// AUTO-GENERATED — do not edit by hand.
// Source: @moreih29/nexus-core@0.7.1 (d2da7dede9540a14bc5925904c2382795f383b1e)
// Aggregates all agent prompts and metadata.

import { PROMPT as architect_prompt, META as architect_meta } from './architect.js';
import { PROMPT as engineer_prompt, META as engineer_meta } from './engineer.js';
import { PROMPT as designer_prompt, META as designer_meta } from './designer.js';
import { PROMPT as strategist_prompt, META as strategist_meta } from './strategist.js';
import { PROMPT as researcher_prompt, META as researcher_meta } from './researcher.js';
import { PROMPT as postdoc_prompt, META as postdoc_meta } from './postdoc.js';
import { PROMPT as reviewer_prompt, META as reviewer_meta } from './reviewer.js';
import { PROMPT as tester_prompt, META as tester_meta } from './tester.js';
import { PROMPT as writer_prompt, META as writer_meta } from './writer.js';

export const AGENT_PROMPTS: Record<string, string> = {
  "architect": architect_prompt,
  "engineer": engineer_prompt,
  "designer": designer_prompt,
  "strategist": strategist_prompt,
  "researcher": researcher_prompt,
  "postdoc": postdoc_prompt,
  "reviewer": reviewer_prompt,
  "tester": tester_prompt,
  "writer": writer_prompt,
};

export const AGENT_META: Record<string, {
  id: string;
  name: string;
  category: string;
  description: string;
  model: string;
  disallowedTools: readonly string[];
  task: string;
  alias_ko: string;
  resume_tier: string;
}> = {
  "architect": architect_meta,
  "engineer": engineer_meta,
  "designer": designer_meta,
  "strategist": strategist_meta,
  "researcher": researcher_meta,
  "postdoc": postdoc_meta,
  "reviewer": reviewer_meta,
  "tester": tester_meta,
  "writer": writer_meta,
};

export const NO_FILE_EDIT_TOOLS: readonly string[] = ["write", "edit", "patch", "multiedit", "notebookedit"] as const;
