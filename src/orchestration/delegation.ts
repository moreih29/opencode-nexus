export interface DelegationInput {
  task: string;
  currentState: string;
  dependencies?: string[];
  priorDecisions?: string[];
  targetFiles?: string[];
  constraints?: string[];
  acceptance?: string[];
}

export function buildDelegationTemplate(input: DelegationInput): string {
  const deps = (input.dependencies ?? []).map((v) => `- ${v}`).join("\n") || "- none";
  const decisions = (input.priorDecisions ?? []).map((v) => `- ${v}`).join("\n") || "- none";
  const files = (input.targetFiles ?? []).map((v) => `- ${v}`).join("\n") || "- none";
  const constraints = (input.constraints ?? []).map((v) => `- ${v}`).join("\n") || "- none";
  const acceptance = (input.acceptance ?? []).map((v) => `- ${v}`).join("\n") || "- none";

  return [
    `TASK: ${input.task}`,
    "",
    "CONTEXT:",
    `- Current state: ${input.currentState}`,
    `- Dependencies:\n${deps}`,
    `- Prior decisions:\n${decisions}`,
    `- Target files:\n${files}`,
    "",
    "CONSTRAINTS:",
    constraints,
    "",
    "ACCEPTANCE:",
    acceptance
  ].join("\n");
}
