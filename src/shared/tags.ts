export interface NexusTagDefinition {
  tag: string;
  purpose: string;
}

export const NEXUS_TAGS: NexusTagDefinition[] = [
  { tag: "[plan]", purpose: "리서치, 다관점 분석, 결정, 계획서 생성" },
  { tag: "[d]", purpose: "Record a plan decision with nx_plan_decide" },
  { tag: "[run]", purpose: "Execute the task pipeline" },
  { tag: "[rule]", purpose: "Persist a stable team convention" }
];
