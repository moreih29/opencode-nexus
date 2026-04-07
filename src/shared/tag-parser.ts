const ERROR_CONTEXT = /(error|bug|exception|stack trace|traceback|fix\s+.*(plan|run|rule|\[d\])|에러|버그|오류|이슈)/i;
const QUESTION_CONTEXT = /(what\s+is|what\s+does|explain|define|뭐야|뭔가요|설명해)\s*(plan|run|rule|\[d\])?/i;
const QUOTE_CONTEXT = /[`"'](?:[^`"']*)(plan|run|rule|\[d\])(?:[^`"']*)[`"']/i;
const NATURAL_PLAN_PATTERNS = [
  /\bplan\b/i,
  /계획/,
  /설계/,
  /분석해/,
  /분석하자/,
  /어떻게\s*접근/,
  /뭐가\s*좋을까/,
  /방법을?\s*찾아/,
  /검토해/
];
const NATURAL_RUN_PATTERNS = [/\[run\]/i, /실행해/, /구현해/, /개발해/, /진행해/];
const ATTENDEE_VERB = /(참석|불러|소환|join|invite|bring in)/i;

const AGENT_ALIASES: Record<string, string[]> = {
  architect: ["architect", "아키텍트"],
  designer: ["designer", "디자이너"],
  postdoc: ["postdoc", "포닥"],
  strategist: ["strategist", "전략가"],
  engineer: ["engineer", "엔지니어"],
  researcher: ["researcher", "리서처"],
  writer: ["writer", "라이터"],
  tester: ["tester", "테스터"],
  reviewer: ["reviewer", "리뷰어"]
};

export type NexusTagMode = "plan" | "run" | "decide" | "rule" | null;

export function detectNexusTag(prompt: string): NexusTagMode {
  if (isFalsePositiveContext(prompt)) {
    return null;
  }

  if (/\[d\]/i.test(prompt)) {
    return "decide";
  }
  if (/\[plan\]/i.test(prompt)) {
    return "plan";
  }
  if (/\[run\]/i.test(prompt)) {
    return "run";
  }
  if (/\[rule(?::[^\]]+)?\]/i.test(prompt)) {
    return "rule";
  }
  if (NATURAL_PLAN_PATTERNS.some((pattern) => pattern.test(prompt))) {
    return "plan";
  }
  if (NATURAL_RUN_PATTERNS.some((pattern) => pattern.test(prompt)) && /task|tasks|phase|pipeline|구현|실행/.test(prompt)) {
    return "run";
  }

  return null;
}

export function hasExplicitNexusTag(prompt: string): boolean {
  return /\[(plan|run|d|rule(?::[^\]]+)?)\]/i.test(prompt);
}

export function detectRuleTags(prompt: string): string[] | null {
  const match = prompt.match(/\[rule:([^\]]+)\]/i);
  if (!match) {
    return /\[rule\]/i.test(prompt) ? [] : null;
  }

  const tags = match[1]
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  return Array.from(new Set(tags));
}

export function detectAttendeeMentions(prompt: string): string[] {
  if (!ATTENDEE_VERB.test(prompt)) {
    return [];
  }

  const found: string[] = [];
  for (const [agent, aliases] of Object.entries(AGENT_ALIASES)) {
    if (aliases.some((alias) => prompt.toLowerCase().includes(alias.toLowerCase()))) {
      found.push(agent);
    }
  }
  return found;
}

export function buildTagNotice(mode: NexusTagMode): string | null {
  if (!mode) {
    return null;
  }

  if (mode === "plan") {
    return "[nexus] Plan mode detected. Research first, then use nx_plan_start / nx_plan_discuss / nx_plan_decide.";
  }
  if (mode === "run") {
    return "[nexus] Run mode detected. Follow nx_task_add -> nx_task_update -> nx_task_close around all file edits.";
  }
  if (mode === "decide") {
    return "[nexus] Decision tag detected. Record decision with nx_plan_decide.";
  }
  if (mode === "rule") {
    return "[nexus] Rule mode detected. Persist durable conventions in .nexus/rules via nx_rules_write.";
  }
  return null;
}

function isFalsePositiveContext(prompt: string): boolean {
  return ERROR_CONTEXT.test(prompt) || QUESTION_CONTEXT.test(prompt) || QUOTE_CONTEXT.test(prompt);
}
