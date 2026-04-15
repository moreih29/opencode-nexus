import { readJsonFile, writeJsonFile } from "./json-store.js";
import { HARNESS_ID } from "./paths.js";
import { AgentTrackerSchema, type AgentTracker, type Invocation, type InvocationContinuityHandles } from "./schema.js";

// InvocationContinuity is the same shape as InvocationContinuityHandles — alias for clarity in this module.
export type InvocationContinuity = InvocationContinuityHandles;

export interface RegisterInvocationStartInput {
  invocation_id: string;
  agent_type: string;
  coordination_label?: string;
  team_name?: string;
  purpose?: string;
  runtime_metadata?: unknown;
  continuity?: Partial<InvocationContinuity>;
}

export interface RegisterInvocationEndInput {
  invocation_id?: string;
  status?: Exclude<Invocation["status"], "running">;
  last_message?: string;
  runtime_metadata?: unknown;
  continuity?: Partial<InvocationContinuity>;
}

export interface ContinuityQuery {
  agent_type?: string;
  coordination_label?: string;
  prefer_running?: boolean;
}

export interface GroupState {
  coordination_label: string;
  total: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  latest_invocation_id: string;
  latest_agent_type: string;
}

export interface GroupSummary {
  label: string;
  states: string[];
  agentTypes: string[];
  leadAgent: string;
  latestPurpose: string | null;
}

export interface DelegationPlan {
  agent_type: string;
  coordination_label?: string;
  purpose?: string;
  resume_from?: {
    invocation_id: string;
    agent_type: string;
    coordination_label?: string;
    status: Invocation["status"];
    continuity: InvocationContinuity;
  };
  adapter_hints: {
    resume_task_id?: string;
    resume_session_id?: string;
    resume_handles: Record<string, string>;
  };
}

// ---------------------------------------------------------------------------
// Core read/write
// ---------------------------------------------------------------------------

export function createEmptyAgentTracker(now = new Date().toISOString()): AgentTracker {
  return {
    harness_id: HARNESS_ID,
    started_at: now,
    invocations: []
  };
}

export async function readAgentTracker(filePath: string): Promise<AgentTracker> {
  const fallback = createEmptyAgentTracker();
  const raw = await readJsonFile<unknown>(filePath, null);
  if (raw === null) {
    return fallback;
  }
  const parsed = AgentTrackerSchema.safeParse(raw);
  if (!parsed.success) {
    return fallback;
  }
  return parsed.data;
}

export async function writeAgentTracker(filePath: string, tracker: AgentTracker): Promise<void> {
  await writeJsonFile(filePath, tracker);
}

// ---------------------------------------------------------------------------
// Pure state mutations
// ---------------------------------------------------------------------------

export function applyInvocationStart(
  tracker: AgentTracker,
  input: RegisterInvocationStartInput,
  now = new Date().toISOString()
): AgentTracker {
  const continuity = mergeContinuity(
    { resume_handles: {} },
    extractObservedContinuity(input.runtime_metadata),
    input.continuity
  );

  const invocation: Invocation = {
    invocation_id: input.invocation_id,
    agent_type: input.agent_type,
    status: "running",
    coordination_label: normalizeOptional(input.coordination_label),
    purpose: normalizeOptional(input.purpose),
    continuity,
    started_at: now,
    updated_at: now
  };

  const existingIndex = tracker.invocations.findIndex((item) => item.invocation_id === input.invocation_id);
  const nextInvocations = tracker.invocations.slice();
  if (existingIndex >= 0) {
    const existing = tracker.invocations[existingIndex];
    invocation.started_at = existing.started_at;
    invocation.status = existing.status;
    invocation.continuity = mergeContinuity(existing.continuity, continuity);
    invocation.last_message = existing.last_message;
    nextInvocations[existingIndex] = invocation;
  } else {
    nextInvocations.push(invocation);
  }

  return {
    ...tracker,
    invocations: nextInvocations
  };
}

export function applyInvocationEnd(
  tracker: AgentTracker,
  invocation_id: string,
  patch: RegisterInvocationEndInput,
  now = new Date().toISOString()
): AgentTracker {
  const existingIndex = tracker.invocations.findIndex((item) => item.invocation_id === invocation_id);
  if (existingIndex < 0) {
    return tracker;
  }

  const existing = tracker.invocations[existingIndex];
  const mergedContinuity = mergeContinuity(
    existing.continuity,
    extractObservedContinuity(patch.runtime_metadata),
    patch.continuity
  );

  const updated: Invocation = {
    ...existing,
    continuity: mergedContinuity,
    status: patch.status ?? "completed",
    ended_at: now,
    updated_at: now,
    last_message: normalizeOptional(patch.last_message) ?? existing.last_message
  };

  const nextInvocations = tracker.invocations.slice();
  nextInvocations[existingIndex] = updated;

  return {
    ...tracker,
    invocations: nextInvocations
  };
}

// ---------------------------------------------------------------------------
// File-backed mutations
// ---------------------------------------------------------------------------

export async function registerInvocationStart(
  filePath: string,
  invocation: RegisterInvocationStartInput
): Promise<void> {
  const tracker = await readAgentTracker(filePath);
  const next = applyInvocationStart(tracker, invocation);
  await writeAgentTracker(filePath, next);
}

export async function registerInvocationEnd(
  filePath: string,
  invocation_id: string,
  patch: RegisterInvocationEndInput
): Promise<void> {
  const tracker = await readAgentTracker(filePath);
  const next = applyInvocationEnd(tracker, invocation_id, patch);
  await writeAgentTracker(filePath, next);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getInvocation(tracker: AgentTracker, invocation_id: string): Invocation | undefined {
  return tracker.invocations.find((item) => item.invocation_id === invocation_id);
}

export function listGroupState(tracker: AgentTracker, coordination_label: string): GroupState {
  const matching = tracker.invocations.filter((inv) => inv.coordination_label === coordination_label);

  const latest = matching.reduce<Invocation | null>((best, inv) => {
    if (!best) {
      return inv;
    }
    return getInvocationTimestamp(inv) >= getInvocationTimestamp(best) ? inv : best;
  }, null);

  const state: GroupState = {
    coordination_label,
    total: matching.length,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    latest_invocation_id: latest?.invocation_id ?? "",
    latest_agent_type: latest?.agent_type ?? ""
  };

  for (const inv of matching) {
    state[inv.status] += 1;
  }

  return state;
}

// ---------------------------------------------------------------------------
// Continuity
// ---------------------------------------------------------------------------

export function pickContinuityFromTrackerState(
  tracker: AgentTracker,
  query: ContinuityQuery
): InvocationContinuity | null {
  const normalizedAgentType = normalizeOptional(query.agent_type)?.toLowerCase();
  const normalizedLabel = normalizeOptional(query.coordination_label);
  const preferRunning = query.prefer_running ?? true;

  const candidates = tracker.invocations.filter((item) => {
    if (normalizedAgentType && item.agent_type.toLowerCase() !== normalizedAgentType) {
      return false;
    }
    if (normalizedLabel && item.coordination_label !== normalizedLabel) {
      return false;
    }
    return hasContinuity(item.continuity);
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftActive = isInvocationActive(left.status) ? 1 : 0;
    const rightActive = isInvocationActive(right.status) ? 1 : 0;
    if (preferRunning && leftActive !== rightActive) {
      return rightActive - leftActive;
    }
    return getInvocationTimestamp(right) - getInvocationTimestamp(left);
  });

  const selected = candidates[0];
  return selected.continuity ?? null;
}

export async function pickContinuityFromTracker(
  filePath: string,
  query: ContinuityQuery
): Promise<InvocationContinuity | null> {
  const tracker = await readAgentTracker(filePath);
  return pickContinuityFromTrackerState(tracker, query);
}

export function buildDelegationPlanFromTracker(
  tracker: AgentTracker,
  query: { agent_type: string; coordination_label?: string; purpose?: string }
): DelegationPlan {
  const normalizedAgentType = normalizeOptional(query.agent_type)?.toLowerCase();
  const normalizedLabel = normalizeOptional(query.coordination_label);
  const preferRunning = true;

  const candidates = tracker.invocations.filter((item) => {
    if (normalizedAgentType && item.agent_type.toLowerCase() !== normalizedAgentType) {
      return false;
    }
    if (normalizedLabel && item.coordination_label !== normalizedLabel) {
      return false;
    }
    return hasContinuity(item.continuity);
  });

  candidates.sort((left, right) => {
    const leftActive = isInvocationActive(left.status) ? 1 : 0;
    const rightActive = isInvocationActive(right.status) ? 1 : 0;
    if (preferRunning && leftActive !== rightActive) {
      return rightActive - leftActive;
    }
    return getInvocationTimestamp(right) - getInvocationTimestamp(left);
  });

  const selected = candidates[0] ?? null;
  const resumeFrom = selected
    ? {
        invocation_id: selected.invocation_id,
        agent_type: selected.agent_type,
        coordination_label: selected.coordination_label,
        status: selected.status,
        continuity: selected.continuity ?? { resume_handles: {} }
      }
    : undefined;

  const continuity = resumeFrom?.continuity;
  return {
    agent_type: query.agent_type,
    coordination_label: normalizeOptional(query.coordination_label),
    purpose: normalizeOptional(query.purpose),
    resume_from: resumeFrom,
    adapter_hints: {
      resume_task_id: continuity?.child_task_id ?? continuity?.resume_task_id,
      resume_session_id: continuity?.child_session_id ?? continuity?.resume_session_id,
      resume_handles: { ...(continuity?.resume_handles ?? {}) }
    }
  };
}

// ---------------------------------------------------------------------------
// Continuity helpers
// ---------------------------------------------------------------------------

export function extractObservedContinuity(metadata: unknown): Partial<InvocationContinuity> {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }

  const source = metadata as Record<string, unknown>;
  const resumeHandles = pickStringRecord(source, ["resume_handles", "resumeHandles", "resume"]);

  return {
    child_task_id: pickNestedString(source, ["task_id", "taskID", "taskId", "id"]),
    child_session_id: pickNestedString(source, ["session_id", "sessionID", "sessionId"]),
    resume_task_id: pickNestedString(source, ["resume_task_id", "resumeTaskID", "resumeTaskId"]),
    resume_session_id: pickNestedString(source, ["resume_session_id", "resumeSessionID", "resumeSessionId"]),
    resume_handles: resumeHandles
  };
}

export function mergeContinuity(
  ...chunks: Array<Partial<InvocationContinuity> | undefined>
): InvocationContinuity {
  const merged: InvocationContinuity = { resume_handles: {} };
  for (const chunk of chunks) {
    if (!chunk) {
      continue;
    }
    if (typeof chunk.child_session_id === "string" && chunk.child_session_id.trim().length > 0) {
      merged.child_session_id = chunk.child_session_id;
    }
    if (typeof chunk.child_task_id === "string" && chunk.child_task_id.trim().length > 0) {
      merged.child_task_id = chunk.child_task_id;
    }
    if (typeof chunk.resume_session_id === "string" && chunk.resume_session_id.trim().length > 0) {
      merged.resume_session_id = chunk.resume_session_id;
    }
    if (typeof chunk.resume_task_id === "string" && chunk.resume_task_id.trim().length > 0) {
      merged.resume_task_id = chunk.resume_task_id;
    }
    if (chunk.resume_handles) {
      merged.resume_handles = {
        ...merged.resume_handles,
        ...chunk.resume_handles
      };
    }
  }
  return merged;
}

export function hasContinuity(continuity: Partial<InvocationContinuity> | undefined): boolean {
  if (!continuity) {
    return false;
  }
  return Boolean(
    continuity.child_session_id ||
      continuity.child_task_id ||
      continuity.resume_session_id ||
      continuity.resume_task_id ||
      (continuity.resume_handles && Object.keys(continuity.resume_handles).length > 0)
  );
}

export function extractObservedContinuityFromInvocation(invocation: Invocation): InvocationContinuity | null {
  if (!invocation.continuity) {
    return null;
  }
  if (!hasContinuity(invocation.continuity)) {
    return null;
  }
  return invocation.continuity;
}

// ---------------------------------------------------------------------------
// Coordination group summaries
// ---------------------------------------------------------------------------

export async function summarizeCoordinationGroups(filePath: string): Promise<GroupSummary[]> {
  const tracker = await readAgentTracker(filePath);
  const grouped = new Map<
    string,
    { states: Set<string>; agentTypes: Set<string>; leadAgent: string; latestPurpose: string | null }
  >();

  for (const inv of tracker.invocations) {
    const label = inv.coordination_label;
    if (!label) {
      continue;
    }
    const current = grouped.get(label) ?? {
      states: new Set<string>(),
      agentTypes: new Set<string>(),
      leadAgent: "lead",
      latestPurpose: null
    };
    current.states.add(inv.status);
    current.agentTypes.add(inv.agent_type);
    current.latestPurpose = inv.purpose ?? current.latestPurpose;
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

export async function hasRunningTeam(filePath: string, team_name: string): Promise<boolean> {
  const tracker = await readAgentTracker(filePath);
  return tracker.invocations.some(
    (inv) => isInvocationActive(inv.status) && inv.coordination_label === team_name
  );
}

export function isInvocationActive(status: Invocation["status"]): boolean {
  return status === "running";
}

// ---------------------------------------------------------------------------
// Resume detection fingerprint
// ---------------------------------------------------------------------------

export function buildSubagentFingerprint(invocation: Invocation): string {
  const signature = {
    agentType: invocation.agent_type,
    teamName: invocation.coordination_label ?? null,
    description: invocation.purpose ?? null,
    resumeTaskID: invocation.continuity?.resume_task_id ?? null,
    resumeSessionID: invocation.continuity?.resume_session_id ?? null
  };
  return JSON.stringify(signature);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function getInvocationTimestamp(invocation: Invocation): number {
  const candidate = invocation.ended_at ?? invocation.updated_at ?? invocation.started_at;
  const value = Date.parse(candidate);
  return Number.isFinite(value) ? value : -1;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pickNestedString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = source[key];
    if (typeof direct === "string" && direct.trim().length > 0) {
      return direct;
    }
  }

  for (const value of Object.values(source)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const nested = pickNestedString(value as Record<string, unknown>, keys);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function pickStringRecord(source: Record<string, unknown>, keys: string[]): Record<string, string> {
  for (const key of keys) {
    const direct = source[key];
    if (!direct || typeof direct !== "object" || Array.isArray(direct)) {
      continue;
    }

    const next: Record<string, string> = {};
    for (const [innerKey, innerValue] of Object.entries(direct as Record<string, unknown>)) {
      if (typeof innerValue === "string" && innerValue.trim().length > 0) {
        next[innerKey] = innerValue;
      }
    }
    if (Object.keys(next).length > 0) {
      return next;
    }
  }
  return {};
}
