import { readJsonFile, writeJsonFile } from "./json-store";
import { AgentTrackerSchema, type AgentTrackerItem } from "./schema";

export async function readAgentTracker(filePath: string): Promise<AgentTrackerItem[]> {
  const raw = await readJsonFile<unknown>(filePath, []);
  const parsed = AgentTrackerSchema.safeParse(raw);
  if (!parsed.success) {
    return [];
  }
  return parsed.data;
}

export async function writeAgentTracker(filePath: string, items: AgentTrackerItem[]): Promise<void> {
  await writeJsonFile(filePath, items);
}

export async function appendAgentTracker(filePath: string, item: AgentTrackerItem): Promise<void> {
  const items = await readAgentTracker(filePath);
  items.push(item);
  await writeAgentTracker(filePath, items);
}

export async function markLatestTeamCompleted(
  filePath: string,
  agentType: string,
  lastMessage: string
): Promise<void> {
  const items = await readAgentTracker(filePath);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.agent_type === agentType && (item.state === "team-spawning" || item.state === "running")) {
      item.state = "completed";
      item.stopped_at = new Date().toISOString();
      item.last_message = lastMessage;
      break;
    }
  }
  await writeAgentTracker(filePath, items);
}

export async function hasRunningTeam(filePath: string): Promise<boolean> {
  const items = await readAgentTracker(filePath);
  return items.some((item) => (item.state === "team-spawning" || item.state === "running") && !!item.team_name);
}

// team_name is a coordination label in OpenCode, not a platform-native team object.

export async function summarizeCoordinationGroups(filePath: string): Promise<
  Array<{ label: string; states: string[]; agentTypes: string[]; leadAgent: string; latestPurpose: string | null }>
> {
  const items = await readAgentTracker(filePath);
  const grouped = new Map<string, { states: Set<string>; agentTypes: Set<string>; leadAgent: string; latestPurpose: string | null }>();

  for (const item of items) {
    const label = item.coordination_label ?? item.team_name;
    if (!label) {
      continue;
    }
    const current = grouped.get(label) ?? {
      states: new Set<string>(),
      agentTypes: new Set<string>(),
      leadAgent: item.lead_agent ?? "lead",
      latestPurpose: null
    };
    current.states.add(item.state);
    current.agentTypes.add(item.agent_type);
    current.leadAgent = item.lead_agent ?? current.leadAgent;
    current.latestPurpose = item.purpose ?? current.latestPurpose;
    grouped.set(label, current);
  }

  return Array.from(grouped.entries()).map(([label, value]) => ({
    label,
    states: Array.from(value.states),
    agentTypes: Array.from(value.agentTypes),
    leadAgent: value.leadAgent,
    latestPurpose: value.latestPurpose
  }));
}
