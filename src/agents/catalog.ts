export type NexusAgentCategory = "how" | "do" | "check";

export interface NexusAgentProfile {
  id: string;
  name: string;
  category: NexusAgentCategory;
  description: string;
  model: string;
  disallowedTools: string[];
}

export const NEXUS_AGENT_CATALOG: NexusAgentProfile[] = [
  {
    id: "architect",
    name: "Architect",
    category: "how",
    description: "Architecture and technical design review",
    model: "openai/gpt-5.3-codex",
    disallowedTools: ["edit", "write", "patch", "multiedit", "nx_task_add", "nx_task_update"]
  },
  {
    id: "designer",
    name: "Designer",
    category: "how",
    description: "UI/UX and interaction design decisions",
    model: "openai/gpt-5.3-codex",
    disallowedTools: ["edit", "write", "patch", "multiedit", "nx_task_add", "nx_task_update"]
  },
  {
    id: "postdoc",
    name: "Postdoc",
    category: "how",
    description: "Research methodology and evidence synthesis",
    model: "openai/gpt-5.3-codex",
    disallowedTools: ["edit", "write", "patch", "multiedit", "bash", "nx_task_add", "nx_task_update"]
  },
  {
    id: "strategist",
    name: "Strategist",
    category: "how",
    description: "Business and product strategy review",
    model: "openai/gpt-5.3-codex",
    disallowedTools: ["edit", "write", "patch", "multiedit", "nx_task_add", "nx_task_update"]
  },
  {
    id: "engineer",
    name: "Engineer",
    category: "do",
    description: "Implementation and debugging",
    model: "openai/gpt-5.3-codex-spark",
    disallowedTools: ["nx_task_add"]
  },
  {
    id: "researcher",
    name: "Researcher",
    category: "do",
    description: "Independent web and document research",
    model: "openai/gpt-5.3-codex-spark",
    disallowedTools: ["nx_task_add"]
  },
  {
    id: "writer",
    name: "Writer",
    category: "do",
    description: "Technical writing and documentation",
    model: "openai/gpt-5.3-codex-spark",
    disallowedTools: ["nx_task_add"]
  },
  {
    id: "qa",
    name: "QA",
    category: "check",
    description: "Verification, testing, and quality checks",
    model: "openai/gpt-5.3-codex-spark",
    disallowedTools: ["nx_task_add"]
  },
  {
    id: "reviewer",
    name: "Reviewer",
    category: "check",
    description: "Fact-checking and content validation",
    model: "openai/gpt-5.3-codex-spark",
    disallowedTools: ["nx_task_add"]
  }
];
