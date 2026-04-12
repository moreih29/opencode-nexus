export interface NexusSkillProfile {
  id: "nx-plan" | "nx-run" | "nx-init" | "nx-sync" | "nx-setup";
  trigger: string;
  purpose: string;
  summary: string;
}

export const NEXUS_SKILL_CATALOG: NexusSkillProfile[] = [
  {
    id: "nx-plan",
    trigger: "[plan]",
    purpose: "Structured planning — subagent-based analysis, deliberate decisions, produce execution plan",
    summary: "Use plan tools to open agenda, discuss issues, and record decisions before execution."
  },
  {
    id: "nx-run",
    trigger: "[run]",
    purpose: "Execution — user-directed agent composition",
    summary: "Run intake -> design -> execute -> verify -> complete with task pipeline controls."
  },
  {
    id: "nx-init",
    trigger: "nx-init",
    purpose: "Project onboarding — scan, mission, essentials, context generation",
    summary: "Initialize Nexus core structure and baseline knowledge for a repository."
  },
  {
    id: "nx-sync",
    trigger: "nx-sync",
    purpose: "Context knowledge synchronization",
    summary: "Sync core knowledge and operational memory after task cycle completion."
  },
  {
    id: "nx-setup",
    trigger: "nx-setup",
    purpose: "Interactive Nexus configuration wizard",
    summary: "Configure permissions and orchestration defaults for the project."
  }
];
