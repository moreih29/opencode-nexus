import { AGENT_META } from "../agents/generated/index.js";
import type { PlanFile } from "./schema.js";

export function collectHowRolesFromPlan(plan: PlanFile): string[] {
  const roles = new Set<string>();
  for (const issue of plan.issues) {
    if (issue.how_agent_ids) {
      for (const role of Object.keys(issue.how_agent_ids)) {
        if (isHowRole(role)) {
          roles.add(role.toLowerCase());
        }
      }
    }
    if (issue.how_agents) {
      for (const role of issue.how_agents) {
        if (isHowRole(role)) {
          roles.add(role.toLowerCase());
        }
      }
    }
  }
  return Array.from(roles).sort((a, b) => a.localeCompare(b));
}

function isHowRole(role: string): boolean {
  return Object.values(AGENT_META).some((agent) => agent.category === "how" && agent.id === role.toLowerCase());
}
