import {
  type InvocationContinuityHandles,
  type InvocationLifecycleStatus,
  type OrchestrationCoreState,
  type OrchestrationInvocation
} from "../shared/schema.js";
import { createEmptyOrchestrationCoreState, readOrchestrationCoreState, writeOrchestrationCoreState } from "./core-store.js";

const DEFAULT_END_STATUS: InvocationLifecycleStatus = "completed";

export interface RegisterStartInput {
  invocation_id: string;
  agent_type: string;
  coordination_label?: string;
  team_name?: string;
  purpose?: string;
  runtime_metadata?: unknown;
  continuity?: Partial<InvocationContinuityHandles>;
}

export interface RegisterEndInput {
  invocation_id: string;
  status?: Exclude<InvocationLifecycleStatus, "running">;
  last_message?: string;
  runtime_metadata?: unknown;
  continuity?: Partial<InvocationContinuityHandles>;
}

export interface ContinuityQuery {
  agent_type?: string;
  coordination_label?: string;
  prefer_running?: boolean;
}

export interface ContinuitySelection {
  invocation_id: string;
  agent_type: string;
  coordination_label?: string;
  status: InvocationLifecycleStatus;
  continuity: InvocationContinuityHandles;
}

export interface GroupStateSummary {
  coordination_label: string;
  total: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  latest_invocation_id: string;
  latest_agent_type: string;
}

export interface DelegationPlan {
  agent_type: string;
  coordination_label?: string;
  purpose?: string;
  resume_from?: ContinuitySelection;
  adapter_hints: {
    resume_task_id?: string;
    resume_session_id?: string;
    resume_handles: Record<string, string>;
  };
}

export async function registerStart(filePath: string, input: RegisterStartInput): Promise<OrchestrationInvocation> {
  const state = await readOrchestrationCoreState(filePath);
  const { nextState, invocation } = applyRegisterStart(state, input);
  await writeOrchestrationCoreState(filePath, nextState);
  return invocation;
}

export async function registerEnd(filePath: string, input: RegisterEndInput): Promise<OrchestrationInvocation | null> {
  const state = await readOrchestrationCoreState(filePath);
  const { nextState, invocation } = applyRegisterEnd(state, input);
  if (!invocation) {
    return null;
  }
  await writeOrchestrationCoreState(filePath, nextState);
  return invocation;
}

export async function getInvocation(filePath: string, invocationID: string): Promise<OrchestrationInvocation | null> {
  const state = await readOrchestrationCoreState(filePath);
  return getInvocationFromState(state, invocationID);
}

export async function listGroupState(filePath: string): Promise<GroupStateSummary[]> {
  const state = await readOrchestrationCoreState(filePath);
  return listGroupStateFromState(state);
}

export async function pickContinuity(filePath: string, query: ContinuityQuery): Promise<ContinuitySelection | null> {
  const state = await readOrchestrationCoreState(filePath);
  return pickContinuityFromState(state, query);
}

export async function buildDelegationPlan(
  filePath: string,
  input: { agent_type: string; coordination_label?: string; purpose?: string }
): Promise<DelegationPlan> {
  const state = await readOrchestrationCoreState(filePath);
  return buildDelegationPlanFromState(state, input);
}

export function applyRegisterStart(
  state: OrchestrationCoreState,
  input: RegisterStartInput,
  now = new Date().toISOString()
): { nextState: OrchestrationCoreState; invocation: OrchestrationInvocation } {
  const continuity = mergeContinuity(
    { resume_handles: {} },
    extractObservedContinuity(input.runtime_metadata),
    input.continuity
  );

  const invocation: OrchestrationInvocation = {
    invocation_id: input.invocation_id,
    agent_type: input.agent_type,
    status: "running",
    coordination_label: normalizeOptional(input.coordination_label),
    team_name: normalizeOptional(input.team_name),
    purpose: normalizeOptional(input.purpose),
    continuity,
    started_at: now,
    updated_at: now
  };

  const existingIndex = state.invocations.findIndex((item) => item.invocation_id === input.invocation_id);
  const nextInvocations = state.invocations.slice();
  if (existingIndex >= 0) {
    const existing = state.invocations[existingIndex];
    invocation.started_at = existing.started_at;
    invocation.status = existing.status === "running" ? "running" : existing.status;
    invocation.continuity = mergeContinuity(existing.continuity, continuity);
    invocation.last_message = existing.last_message;
    nextInvocations[existingIndex] = invocation;
  } else {
    nextInvocations.push(invocation);
  }

  return {
    nextState: {
      schema_version: state.schema_version,
      updated_at: now,
      invocations: nextInvocations
    },
    invocation
  };
}

export function applyRegisterEnd(
  state: OrchestrationCoreState,
  input: RegisterEndInput,
  now = new Date().toISOString()
): { nextState: OrchestrationCoreState; invocation: OrchestrationInvocation | null } {
  const existingIndex = state.invocations.findIndex((item) => item.invocation_id === input.invocation_id);
  if (existingIndex < 0) {
    return { nextState: state, invocation: null };
  }

  const existing = state.invocations[existingIndex];
  const mergedContinuity = mergeContinuity(
    existing.continuity,
    extractObservedContinuity(input.runtime_metadata),
    input.continuity
  );
  const invocation: OrchestrationInvocation = {
    ...existing,
    continuity: mergedContinuity,
    status: input.status ?? DEFAULT_END_STATUS,
    ended_at: now,
    updated_at: now,
    last_message: normalizeOptional(input.last_message) ?? existing.last_message
  };

  const nextInvocations = state.invocations.slice();
  nextInvocations[existingIndex] = invocation;
  return {
    nextState: {
      schema_version: state.schema_version,
      updated_at: now,
      invocations: nextInvocations
    },
    invocation
  };
}

export function getInvocationFromState(state: OrchestrationCoreState, invocationID: string): OrchestrationInvocation | null {
  return state.invocations.find((item) => item.invocation_id === invocationID) ?? null;
}

export function listGroupStateFromState(state: OrchestrationCoreState): GroupStateSummary[] {
  const grouped = new Map<string, GroupStateSummary>();
  for (const invocation of state.invocations) {
    const label = normalizeOptional(invocation.coordination_label);
    if (!label) {
      continue;
    }

    const current = grouped.get(label) ?? {
      coordination_label: label,
      total: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      latest_invocation_id: invocation.invocation_id,
      latest_agent_type: invocation.agent_type
    };

    current.total += 1;
    current[invocation.status] += 1;

    const latest = getInvocationTimestamp(getInvocationFromState(state, current.latest_invocation_id));
    const candidate = getInvocationTimestamp(invocation);
    if (candidate >= latest) {
      current.latest_invocation_id = invocation.invocation_id;
      current.latest_agent_type = invocation.agent_type;
    }

    grouped.set(label, current);
  }

  return Array.from(grouped.values()).sort((a, b) => a.coordination_label.localeCompare(b.coordination_label));
}

export function pickContinuityFromState(state: OrchestrationCoreState, query: ContinuityQuery): ContinuitySelection | null {
  const normalizedAgentType = normalizeOptional(query.agent_type)?.toLowerCase();
  const normalizedLabel = normalizeOptional(query.coordination_label);
  const preferRunning = query.prefer_running ?? true;

  const candidates = state.invocations.filter((item) => {
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
    const leftRunning = left.status === "running" ? 1 : 0;
    const rightRunning = right.status === "running" ? 1 : 0;
    if (preferRunning && leftRunning !== rightRunning) {
      return rightRunning - leftRunning;
    }
    return getInvocationTimestamp(right) - getInvocationTimestamp(left);
  });

  const selected = candidates[0];
  return {
    invocation_id: selected.invocation_id,
    agent_type: selected.agent_type,
    coordination_label: selected.coordination_label,
    status: selected.status,
    continuity: selected.continuity
  };
}

export function buildDelegationPlanFromState(
  state: OrchestrationCoreState,
  input: { agent_type: string; coordination_label?: string; purpose?: string }
): DelegationPlan {
  const resumeFrom = pickContinuityFromState(state, {
    agent_type: input.agent_type,
    coordination_label: input.coordination_label,
    prefer_running: true
  });

  const continuity = resumeFrom?.continuity;
  return {
    agent_type: input.agent_type,
    coordination_label: normalizeOptional(input.coordination_label),
    purpose: normalizeOptional(input.purpose),
    resume_from: resumeFrom ?? undefined,
    adapter_hints: {
      resume_task_id: continuity?.child_task_id ?? continuity?.resume_task_id,
      resume_session_id: continuity?.child_session_id ?? continuity?.resume_session_id,
      resume_handles: { ...(continuity?.resume_handles ?? {}) }
    }
  };
}

export function extractObservedContinuity(metadata: unknown): Partial<InvocationContinuityHandles> {
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
  ...chunks: Array<Partial<InvocationContinuityHandles> | undefined>
): InvocationContinuityHandles {
  const merged: InvocationContinuityHandles = { resume_handles: {} };
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

export function hasContinuity(continuity: Partial<InvocationContinuityHandles> | undefined): boolean {
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

export async function readOrchestrationState(filePath: string): Promise<OrchestrationCoreState> {
  return readOrchestrationCoreState(filePath);
}

export async function writeOrchestrationState(filePath: string, state: OrchestrationCoreState): Promise<void> {
  await writeOrchestrationCoreState(filePath, state);
}

export { createEmptyOrchestrationCoreState };

function getInvocationTimestamp(invocation: OrchestrationInvocation | null): number {
  if (!invocation) {
    return -1;
  }
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
