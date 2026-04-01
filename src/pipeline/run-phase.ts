import type { RunPhase } from "../shared/schema";

export function nextRunPhase(current: RunPhase, signal: "plan_ready" | "implementation_done" | "verify_failed" | "verify_passed"): RunPhase {
  if (current === "intake" && signal === "plan_ready") {
    return "design";
  }
  if (current === "design" && signal === "plan_ready") {
    return "execute";
  }
  if (current === "execute" && signal === "implementation_done") {
    return "verify";
  }
  if (current === "verify" && signal === "verify_failed") {
    return "execute";
  }
  if (current === "verify" && signal === "verify_passed") {
    return "complete";
  }
  return current;
}
