const ERROR_CONTEXT = /(error|bug|exception|stack trace|traceback|fix\s+.*(meet|run|rule|\[d\]))/i;
const QUESTION_CONTEXT = /(what\s+is|what\s+does|explain|define)\s+(meet|run|rule|\[d\])/i;
const QUOTE_CONTEXT = /`[^`]*(meet|run|rule|\[d\])[^`]*`/i;

export type NexusTagMode = "meet" | "run" | "decide" | "rule" | null;

export function detectNexusTag(prompt: string): NexusTagMode {
  if (isFalsePositiveContext(prompt)) {
    return null;
  }

  if (/\[d\]/i.test(prompt)) {
    return "decide";
  }
  if (/\[meet\]/i.test(prompt)) {
    return "meet";
  }
  if (/\[run\]/i.test(prompt)) {
    return "run";
  }
  if (/\[rule(?::[^\]]+)?\]/i.test(prompt)) {
    return "rule";
  }

  return null;
}

export function buildTagNotice(mode: NexusTagMode): string | null {
  if (!mode) {
    return null;
  }

  if (mode === "meet") {
    return "[nexus] Meet mode detected. Use nx_meet_start / nx_meet_discuss / nx_meet_decide.";
  }
  if (mode === "run") {
    return "[nexus] Run mode detected. Use nx_task_add / nx_task_update / nx_task_close.";
  }
  if (mode === "decide") {
    return "[nexus] Decision tag detected. Record decision with nx_meet_decide.";
  }
  if (mode === "rule") {
    return "[nexus] Rule mode detected. Persist rules in .nexus/rules via dedicated tools.";
  }
  return null;
}

function isFalsePositiveContext(prompt: string): boolean {
  return ERROR_CONTEXT.test(prompt) || QUESTION_CONTEXT.test(prompt) || QUOTE_CONTEXT.test(prompt);
}
