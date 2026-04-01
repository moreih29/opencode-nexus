export interface NexusSkillProfile {
  id: "nx-meet" | "nx-run" | "nx-init" | "nx-sync" | "nx-setup";
  trigger: string;
  purpose: string;
  summary: string;
}

export const NEXUS_SKILL_CATALOG: NexusSkillProfile[] = [
  {
    id: "nx-meet",
    trigger: "[meet]",
    purpose: "Team discussion and decision recording",
    summary: "Use meet tools to open agenda, discuss issues, and record decisions before execution."
  },
  {
    id: "nx-run",
    trigger: "[run]",
    purpose: "Execution pipeline",
    summary: "Run intake -> design -> execute -> verify -> complete with task pipeline controls."
  },
  {
    id: "nx-init",
    trigger: "nx-init",
    purpose: "Onboarding",
    summary: "Initialize Nexus core structure and baseline knowledge for a repository."
  },
  {
    id: "nx-sync",
    trigger: "nx-sync",
    purpose: "Core sync",
    summary: "Sync core knowledge and operational memory after task cycle completion."
  },
  {
    id: "nx-setup",
    trigger: "nx-setup",
    purpose: "Setup wizard",
    summary: "Configure permissions and orchestration defaults for the project."
  }
];
