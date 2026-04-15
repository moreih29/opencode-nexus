// AUTO-GENERATED — do not edit by hand.
// Source: @moreih29/nexus-core@0.8.0 (254efc7d8f4f52e45b548706dd42389fdb9801b2)
// Aggregates all skill prompts and metadata.

import { PROMPT as nx_init_prompt, META as nx_init_meta } from './nx-init.js';
import { PROMPT as nx_sync_prompt, META as nx_sync_meta } from './nx-sync.js';
import { PROMPT as nx_plan_prompt, META as nx_plan_meta } from './nx-plan.js';
import { PROMPT as nx_run_prompt, META as nx_run_meta } from './nx-run.js';
import { PROMPT as nx_setup_prompt, META as nx_setup_meta } from './nx-setup.js';

export const SKILL_PROMPTS: Record<string, string> = {
  "nx-init": nx_init_prompt,
  "nx-sync": nx_sync_prompt,
  "nx-plan": nx_plan_prompt,
  "nx-run": nx_run_prompt,
  "nx-setup": nx_setup_prompt,
};

export const SKILL_META: Record<string, {
  id: string;
  name: string;
  description: string;
  trigger_display: string;
  purpose: string;
}> = {
  "nx-init": {
    id: "nx-init",
    name: "nx-init",
    description: "Project onboarding — scan, mission, essentials, context generation",
    trigger_display: "skill({ name: \"nx-init\" })",
    purpose: "Project onboarding — scan, mission, essentials, context generation",
  },
  "nx-sync": {
    id: "nx-sync",
    name: "nx-sync",
    description: "Context knowledge synchronization — scans project state and updates .nexus/context/ design documents",
    trigger_display: "[sync]",
    purpose: "Context knowledge synchronization",
  },
  "nx-plan": {
    id: "nx-plan",
    name: "nx-plan",
    description: "Structured multi-perspective analysis to decompose issues, align on decisions, and produce an enriched plan before execution. Plan only — does not execute.",
    trigger_display: "[plan]",
    purpose: "Structured planning — subagent-based analysis, deliberate decisions, produce execution plan",
  },
  "nx-run": {
    id: "nx-run",
    name: "nx-run",
    description: "Execution — user-directed agent composition.",
    trigger_display: "[run]",
    purpose: "Execution — user-directed agent composition",
  },
  "nx-setup": {
    id: "nx-setup",
    name: "nx-setup",
    description: "Interactive OpenCode setup wizard for Nexus orchestration. Configures models, permissions, plugins, and project knowledge.",
    trigger_display: "skill({ name: \"nx-setup\" })",
    purpose: "Interactive OpenCode setup wizard for Nexus orchestration. Configures models, permissions, plugins, and project knowledge.",
  },
};
