import { NEXUS_AGENT_CATALOG } from "../agents/catalog";

export function isKnownNexusAgent(agentType: string): boolean {
  return NEXUS_AGENT_CATALOG.some((a) => a.id === agentType.toLowerCase());
}

export function requiresTeamInRunMode(agentType: string): boolean {
  const agent = NEXUS_AGENT_CATALOG.find((a) => a.id === agentType.toLowerCase());
  if (!agent) {
    return false;
  }
  return agent.category === "do" || agent.category === "check";
}

export function canJoinMeetWithoutTeam(role: string): boolean {
  return role.toLowerCase() === "lead";
}
