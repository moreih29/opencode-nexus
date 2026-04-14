import { AGENT_META } from "../agents/generated/index.js";

export function isKnownNexusAgent(agentType: string): boolean {
  return Object.values(AGENT_META).some((a) => a.id === agentType.toLowerCase());
}

export function requiresTeamInRunMode(agentType: string): boolean {
  const agent = Object.values(AGENT_META).find((a) => a.id === agentType.toLowerCase());
  if (!agent) {
    return false;
  }
  return agent.category === "do" || agent.category === "check";
}

export function canJoinPlanWithoutTeam(role: string): boolean {
  return role.toLowerCase() === "lead";
}
