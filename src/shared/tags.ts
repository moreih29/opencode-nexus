export interface NexusTagDefinition {
  tag: string;
  purpose: string;
}

export const NEXUS_TAGS: NexusTagDefinition[] = [
  { tag: "[meet]", purpose: "Team discussion before implementation" },
  { tag: "[d]", purpose: "Record a meet decision with nx_meet_decide" },
  { tag: "[run]", purpose: "Execute the task pipeline" },
  { tag: "[rule]", purpose: "Persist a stable team convention" }
];
