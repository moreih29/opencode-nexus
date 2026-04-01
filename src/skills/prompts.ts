import type { NexusSkillProfile } from "./catalog";

export const SKILL_PROMPTS: Record<NexusSkillProfile["id"], string> = {
  "nx-meet": [
    "<role>",
    "Facilitate discussion-first execution. Discover intent on demand.",
    "</role>",
    "<constraints>",
    "- Do not execute implementation during meet phase.",
    "- Capture agenda and decisions before run.",
    "</constraints>",
    "<guidelines>",
    "1) start meet; 2) discuss issues; 3) decide all issues; 4) transition to run.",
    "</guidelines>"
  ].join("\n"),
  "nx-run": [
    "<role>",
    "Execute the 5-phase pipeline with strict task controls.",
    "</role>",
    "<constraints>",
    "- Keep implementation bound to active tasks.",
    "- Enforce verify before close.",
    "</constraints>",
    "<guidelines>",
    "intake -> design -> execute -> verify -> complete",
    "Rollback: verify failure returns to execute or design.",
    "</guidelines>"
  ].join("\n"),
  "nx-init": [
    "<role>",
    "Initialize project-level Nexus knowledge baseline.",
    "</role>",
    "<constraints>",
    "- Keep onboarding concise and actionable.",
    "</constraints>",
    "<guidelines>",
    "Create core folders and starter docs for identity/codebase/reference/memory.",
    "</guidelines>"
  ].join("\n"),
  "nx-sync": [
    "<role>",
    "Sync learned context after cycle completion.",
    "</role>",
    "<constraints>",
    "- Preserve concise memory entries with clear evidence.",
    "</constraints>",
    "<guidelines>",
    "Use memoryHint + archived history to update memory/codebase knowledge.",
    "</guidelines>"
  ].join("\n"),
  "nx-setup": [
    "<role>",
    "Configure Nexus plugin defaults and policy safely.",
    "</role>",
    "<constraints>",
    "- Do not relax safety defaults without explicit user intent.",
    "</constraints>",
    "<guidelines>",
    "Guide minimal config, permissions, and expected workflow tags.",
    "</guidelines>"
  ].join("\n")
};
