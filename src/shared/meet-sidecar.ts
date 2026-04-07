import { NEXUS_AGENT_CATALOG } from "../agents/catalog.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { PlanFileSchema, PlanSidecarSchema, type PlanFile, type PlanSidecar } from "./schema.js";

export async function readPlanSidecar(filePath: string): Promise<PlanSidecar | null> {
  const raw = await readJsonFile<PlanSidecar | null>(filePath, null);
  if (!raw) {
    return null;
  }
  return PlanSidecarSchema.parse(raw);
}

export async function syncPlanSidecar(
  filePath: string,
  plan: PlanFile,
  update?: { speaker?: string; message?: string; taskID?: string; sessionID?: string; teamName?: string }
): Promise<void> {
  const existing = await readPlanSidecar(filePath);
  const now = new Date().toISOString();
  const participants = mergeHowParticipants(existing, plan, now, update);
  const sidecar: PlanSidecar = {
    schema_version: 1,
    canonical_file: "plan.json",
    platform: "opencode",
    handoff: {
      policy: "canonical-first",
      canonical_ready: true,
      updated_at: now
    },
    panel: {
      strategy: "how-fixed-panel",
      participants
    }
  };
  await writeJsonFile(filePath, sidecar);
}

export async function loadCanonicalPlan(filePath: string): Promise<PlanFile | null> {
  const raw = await readJsonFile<unknown | null>(filePath, null);
  if (!raw) {
    return null;
  }
  return PlanFileSchema.parse(raw);
}

export function summarizePlanSidecar(sidecar: PlanSidecar | null) {
  if (!sidecar) {
    return { handoff: "canonical-only", how_panel_size: 0 };
  }

  return {
    handoff: sidecar.handoff.policy,
    canonical_ready: sidecar.handoff.canonical_ready,
    how_panel_size: sidecar.panel.participants.length,
    participants: sidecar.panel.participants.map((item) => ({
      role: item.role,
      task_id: item.task_id ?? null,
      session_id: item.session_id ?? null,
      has_continuity: Boolean(item.session_id || item.task_id || item.last_summary)
    }))
  };
}

function mergeHowParticipants(
  existing: PlanSidecar | null,
  plan: PlanFile,
  now: string,
  update?: { speaker?: string; message?: string; taskID?: string; sessionID?: string; teamName?: string }
) {
  const participantMap = new Map((existing?.panel.participants ?? []).map((item) => [item.role.toLowerCase(), item]));
  for (const attendee of plan.attendees) {
    if (!isHowRole(attendee.role)) {
      continue;
    }
    const key = attendee.role.toLowerCase();
    const previous = participantMap.get(key);
    const isUpdateTarget = update?.speaker?.toLowerCase() === key;
    participantMap.set(key, {
      role: attendee.role,
      session_id: isUpdateTarget ? update?.sessionID ?? previous?.session_id : previous?.session_id,
      task_id: isUpdateTarget ? update?.taskID ?? previous?.task_id : previous?.task_id,
      last_summary: isUpdateTarget ? update?.message ?? previous?.last_summary : previous?.last_summary,
      updated_at: isUpdateTarget ? now : previous?.updated_at ?? now
    });
  }

  return Array.from(participantMap.values()).sort((a, b) => a.role.localeCompare(b.role));
}

function isHowRole(role: string): boolean {
  return NEXUS_AGENT_CATALOG.some((agent) => agent.category === "how" && agent.id === role.toLowerCase());
}
