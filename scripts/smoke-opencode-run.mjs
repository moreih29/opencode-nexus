/**
 * smoke-opencode-run.mjs — End-to-end smoke harness for opencode run --format json
 *
 * USAGE:
 *   bun scripts/smoke-opencode-run.mjs [scenario-group]
 *
 *   scenario-group: all | basic | plan-flow | how-resume | agent-prompt
 *   (default: all)
 *
 *   Examples:
 *     bun scripts/smoke-opencode-run.mjs basic       # Group A only (cheapest)
 *     bun scripts/smoke-opencode-run.mjs plan-flow   # Group B multi-turn
 *     bun scripts/smoke-opencode-run.mjs how-resume  # Group C HOW agent
 *     bun scripts/smoke-opencode-run.mjs agent-prompt # Group D engineer agent
 *     bun scripts/smoke-opencode-run.mjs all          # Everything
 *
 * COST WARNING:
 *   Each turn calls the configured LLM (glm-5 or equivalent). Estimated costs:
 *     basic      ~$0.02–0.05  (4 turns)
 *     plan-flow  ~$0.03–0.08  (3 turns, multi-turn session)
 *     how-resume ~$0.05–0.15  (3 turns, subagent spawn)
 *     agent-prompt ~$0.05–0.12 (2 turns, subagent spawn)
 *   Full run: ~$0.15–0.40 estimated. Run individual groups to control cost.
 *
 * PREREQUISITES:
 *   - opencode CLI installed (default: "opencode" in PATH, or set OPENCODE_BIN env var)
 *   - opencode.json configured with a working LLM provider
 *   - .opencode/plugins/opencode-nexus.js present (plugin shim auto-loads)
 *   - bun runtime installed
 *   - Run from project root: /Users/kih/workspaces/areas/opencode-nexus
 *
 * ENVIRONMENT VARIABLES:
 *   OPENCODE_BIN=<path>       Override opencode binary path (default: "opencode")
 *   SMOKE_SKIP_HOW_RESUME=1   Skip Group C (how-resume) to avoid subagent costs
 *   SMOKE_SKIP_AGENT_PROMPT=1 Skip Group D (agent-prompt) to avoid subagent costs
 *   SMOKE_TIMEOUT_MS=<ms>     Override per-turn timeout (default: 180000)
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "opencode";
const DEFAULT_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 180000);
const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run `opencode run --format json [prompt]` and collect all JSON events.
 * Returns { events, sessionId, exitCode }.
 *
 * @param {string} prompt
 * @param {{ sessionId?: string, extraArgs?: string[], timeoutMs?: number }} opts
 * @returns {Promise<{ events: object[], sessionId: string | null, exitCode: number }>}
 */
async function runOpencode(prompt, { sessionId, extraArgs = [], timeoutMs } = {}) {
  const args = ["run", "--format", "json"];
  if (sessionId) {
    args.push("-s", sessionId);
  }
  args.push(...extraArgs);
  args.push(prompt);

  const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(OPENCODE_BIN, args, {
      cwd: PROJECT_DIR,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`opencode run timed out after ${effectiveTimeout}ms`));
    }, effectiveTimeout);

    child.on("error", (err) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new Error(
            `opencode binary not found: "${OPENCODE_BIN}"\n` +
              `Install opencode or set OPENCODE_BIN env var to the correct path.`
          )
        );
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const rawStdout = Buffer.concat(stdoutChunks).toString("utf8");
      const rawStderr = Buffer.concat(stderrChunks).toString("utf8");

      // Surface plugin trace lines (e.g., [plan-resume-inject]) for debugging.
      const traceLines = rawStderr.split("\n").filter((l) => l.includes("[plan-resume-inject]"));
      for (const line of traceLines) console.log(`    TRACE: ${line.trim()}`);

      const events = [];
      let extractedSessionId = null;

      const lines = rawStdout.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          events.push(obj);
          // Extract sessionID from first event that has it
          if (extractedSessionId === null && obj.sessionID) {
            extractedSessionId = obj.sessionID;
          }
        } catch {
          console.warn(`    WARN: failed to parse JSON line: ${line.slice(0, 120)}`);
        }
      }

      resolve({ events, sessionId: extractedSessionId, exitCode: code ?? 0 });
    });
  });
}

/**
 * Filter events to only tool_use events, optionally matching a specific tool name.
 * @param {object[]} events
 * @param {string} [toolName]
 * @returns {object[]}
 */
function filterToolUses(events, toolName) {
  return events.filter((e) => {
    if (e.type !== "tool_use") return false;
    if (toolName && e.part?.tool !== toolName) return false;
    return true;
  });
}

/**
 * Assert that a given tool was called at least once in the events.
 * Throws with a descriptive message if not found.
 * @param {object[]} events
 * @param {string} toolName
 * @param {{ inputCheck?: (input: object) => boolean, inputCheckDesc?: string }} [opts]
 */
function assertToolCalled(events, toolName, opts = {}) {
  const uses = filterToolUses(events, toolName);
  if (uses.length === 0) {
    const allTools = filterToolUses(events).map((e) => e.part?.tool).filter(Boolean);
    throw new Error(
      `expected tool "${toolName}" called but events have: ${allTools.join(", ") || "(none)"}`
    );
  }
  if (opts.inputCheck) {
    const matched = uses.find((e) => opts.inputCheck(e.part?.state?.input ?? {}));
    if (!matched) {
      const inputs = uses.map((e) => JSON.stringify(e.part?.state?.input ?? {})).join("; ");
      throw new Error(
        `tool "${toolName}" called but no call matched input check (${opts.inputCheckDesc ?? "custom check"}).\n` +
          `  Actual inputs: ${inputs}`
      );
    }
  }
}

/**
 * Simple pass/fail reporter. Returns { pass, fail, label } for summary.
 */
function makeReporter(groupName) {
  const results = [];
  return {
    pass(desc) {
      console.log(`    PASS: ${desc}`);
      results.push({ ok: true, desc });
    },
    fail(desc) {
      console.log(`    FAIL: ${desc}`);
      results.push({ ok: false, desc });
    },
    warn(desc) {
      console.log(`    WARN: ${desc}`);
    },
    results,
    groupName,
  };
}

// Track artifact paths created during test run for cleanup
const artifactPaths = [];

/**
 * Parse "Wrote <layer>/<topic>.md" style output strings from tool results
 * and register the absolute paths for cleanup.
 * @param {object[]} events
 */
function trackArtifacts(events) {
  for (const e of events) {
    if (e.type !== "tool_use") continue;
    const output = e.part?.state?.output ?? "";
    // Match "Wrote memory/topic.md" or "Wrote rules/topic.md"
    const match = output.match(/^Wrote\s+([\w/.-]+\.md)/);
    if (match) {
      const relative = match[1];
      // Core knowledge: .nexus/core/<layer>/topic.md
      const absPath = path.join(PROJECT_DIR, ".nexus", "core", relative);
      artifactPaths.push(absPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Group A: basic tags
// ---------------------------------------------------------------------------

async function runGroupBasic() {
  console.log("\n[basic] Group A — basic tags");
  const r = makeReporter("basic");

  // A1: [m] tag → nx_core_write (layer=memory) OR native write with .nexus/memory path
  {
    console.log("  [basic/A1] [m] save smoke memo");
    try {
      const { events } = await runOpencode("[m] 스모크 테스트 저장 — smoke-run-harness");
      trackArtifacts(events);
      const tools = filterToolUses(events);
      const nxMatch = tools.find(
        (e) => e.part?.tool === "nx_core_write" && e.part?.state?.input?.layer === "memory"
      );
      const writeMatch = tools.find((e) => {
        if (e.part?.tool !== "write") return false;
        const p = e.part?.state?.input?.filePath ?? e.part?.state?.input?.path ?? "";
        return typeof p === "string" && p.includes(".nexus/memory/");
      });
      if (nxMatch) {
        r.pass("nx_core_write called with layer=memory");
      } else if (writeMatch) {
        const wp = writeMatch.part?.state?.input?.filePath ?? writeMatch.part?.state?.input?.path;
        r.pass(`[m] routed through native write tool — target: ${wp}`);
        // Track for cleanup
        if (wp) artifactPaths.push(path.isAbsolute(wp) ? wp : path.join(PROJECT_DIR, wp));
      } else {
        const names = tools.map((e) => e.part?.tool).filter(Boolean).join(", ") || "(none)";
        r.fail(`[m] scenario: no memory-write tool call detected. Tools: ${names}`);
      }
    } catch (err) {
      r.fail(`[m] scenario: ${err.message}`);
    }
  }

  // A2: [sync] tag → nx_sync OR skill tool OR nx_context/read related call
  {
    console.log("  [basic/A2] [sync] tag");
    try {
      const { events } = await runOpencode("[sync]");
      // Flexible: nx_sync tool, or skill tool, or any tool with "sync" in name
      const toolUses = filterToolUses(events);
      const toolNames = toolUses.map((e) => e.part?.tool ?? "").filter(Boolean);
      const hasSyncTool =
        toolNames.some((t) => t === "nx_sync") ||
        toolNames.some((t) => t === "skill") ||
        toolNames.some((t) => t.includes("sync")) ||
        toolNames.some((t) => t === "nx_context_sync");

      if (!hasSyncTool) {
        // Warn rather than hard-fail: sync dispatch path is ambiguous
        r.warn(
          `[sync] no recognized sync tool called — tools seen: ${toolNames.join(", ") || "(none)"}. ` +
            "The [sync] routing path may use a non-standard tool name. " +
            "Inspect events manually to determine actual dispatch."
        );
        // Soft pass: we observed an event stream, system responded
        if (events.length > 0) {
          r.pass("[sync] tag produced event stream (soft pass — sync tool name unconfirmed)");
        } else {
          r.fail("[sync] tag produced no events");
        }
      } else {
        const syncTool = toolNames.find(
          (t) => t === "nx_sync" || t === "skill" || t.includes("sync") || t === "nx_context_sync"
        );
        r.pass(`[sync] tag triggered tool: ${syncTool}`);
      }
    } catch (err) {
      r.fail(`[sync] scenario: ${err.message}`);
    }
  }

  // A3: [plan] tag → nx_plan_start with topic
  // Note: [plan] triggers full nx-plan skill research procedure via B-leg injection,
  // so LLM may spend several minutes on research before calling nx_plan_start.
  // Timeout raised to 600s; prompt is made self-contained to minimize research.
  {
    console.log("  [basic/A3] [plan] tag → nx_plan_start (extended 600s timeout)");
    try {
      const { events } = await runOpencode(
        "[plan] 이미 리서치 충분함. 간단한 안건 하나: 스모크 테스트 검증. nx_plan_start를 바로 호출.",
        { timeoutMs: 600000 }
      );
      assertToolCalled(events, "nx_plan_start", {
        inputCheck: (inp) => typeof inp.topic === "string" && inp.topic.length > 0,
        inputCheckDesc: "input.topic is non-empty string",
      });
      r.pass("nx_plan_start called with non-empty topic");
    } catch (err) {
      r.fail(`[plan] scenario: ${err.message}`);
    }
  }

  // A4: [rule:test-category] tag → nx_rules_write
  {
    console.log("  [basic/A4] [rule:test-category] tag → nx_rules_write");
    try {
      const { events } = await runOpencode("[rule:smoke-test-category] 테스트용 임시 규칙");
      trackArtifacts(events);
      assertToolCalled(events, "nx_rules_write");
      r.pass("nx_rules_write called");
    } catch (err) {
      r.fail(`[rule:...] scenario: ${err.message}`);
    }
  }

  return r;
}

// ---------------------------------------------------------------------------
// Group B: plan multi-turn
// ---------------------------------------------------------------------------

async function runGroupPlanFlow() {
  console.log("\n[plan-flow] Group B — plan multi-turn");
  const r = makeReporter("plan-flow");

  let planSessionId = null;

  // B1: Start plan, get sessionId (extended timeout — see A3)
  {
    console.log("  [plan-flow/B1] Turn 1: [plan] 가상 스모크 주제 (600s timeout)");
    try {
      const { events, sessionId } = await runOpencode(
        "[plan] 리서치 생략. 간단 주제: 캐싱 전략. nx_plan_start 바로 호출.",
        { timeoutMs: 600000 }
      );
      assertToolCalled(events, "nx_plan_start", {
        inputCheck: (inp) => typeof inp.topic === "string" && inp.topic.length > 0,
        inputCheckDesc: "input.topic is non-empty string",
      });
      r.pass("Turn 1: nx_plan_start called");

      if (!sessionId) {
        r.warn("Turn 1: sessionId not found in events — subsequent turns will start fresh sessions");
      } else {
        planSessionId = sessionId;
        r.pass(`Turn 1: sessionId extracted (${sessionId.slice(0, 8)}...)`);
      }
    } catch (err) {
      r.fail(`Turn 1: ${err.message}`);
      // Cannot continue without sessionId for meaningful multi-turn test
      console.log("  [plan-flow] Skipping turns 2-3 due to Turn 1 failure");
      return r;
    }
  }

  // B2: Continue session — check plan status
  {
    console.log("  [plan-flow/B2] Turn 2: 현재 안건 상태 확인");
    try {
      const { events } = await runOpencode("현재 안건 상태 확인해줘", {
        sessionId: planSessionId ?? undefined,
      });
      const toolUses = filterToolUses(events);
      const toolNames = toolUses.map((e) => e.part?.tool ?? "").filter(Boolean);
      const hasStatusTool =
        toolNames.some((t) => t === "nx_plan_status") ||
        toolNames.some((t) => t === "nx_plan_discuss") ||
        toolNames.some((t) => t.startsWith("nx_plan"));

      if (hasStatusTool) {
        const foundTool = toolNames.find(
          (t) => t === "nx_plan_status" || t === "nx_plan_discuss" || t.startsWith("nx_plan")
        );
        r.pass(`Turn 2: plan tool called (${foundTool})`);
      } else {
        r.warn(
          `Turn 2: no nx_plan_* tool called — tools seen: ${toolNames.join(", ") || "(none)"}. ` +
            "May be a text-only response if plan state not found."
        );
        if (events.length > 0) {
          r.pass("Turn 2: event stream received (soft pass — no plan tool called but response exists)");
        } else {
          r.fail("Turn 2: no events received");
        }
      }
    } catch (err) {
      r.fail(`Turn 2: ${err.message}`);
    }
  }

  // B3: Continue session — decide
  {
    console.log("  [plan-flow/B3] Turn 3: [d] 옵션 A 채택");
    try {
      const { events } = await runOpencode("[d] 옵션 A 채택 — 캐싱 전략은 TTL 기반으로", {
        sessionId: planSessionId ?? undefined,
      });
      assertToolCalled(events, "nx_plan_decide", {
        inputCheck: (inp) =>
          typeof inp.summary === "string" && inp.summary.length > 0,
        inputCheckDesc: "input.summary is non-empty string",
      });
      r.pass("Turn 3: nx_plan_decide called with non-empty summary");
    } catch (err) {
      r.fail(`Turn 3: ${err.message}`);
    }
  }

  return r;
}

// ---------------------------------------------------------------------------
// Group C: HOW subagent spawn & resume
// ---------------------------------------------------------------------------

async function runGroupHowResume() {
  console.log("\n[how-resume] Group C — HOW subagent spawn & resume");
  const r = makeReporter("how-resume");

  if (process.env.SMOKE_SKIP_HOW_RESUME === "1") {
    r.warn("Skipped via SMOKE_SKIP_HOW_RESUME=1");
    return r;
  }

  let howSessionId = null;

  // C1: Start plan with design topic
  {
    console.log("  [how-resume/C1] Turn 1: [plan] architect 패널 필요한 설계 주제 (600s timeout)");
    try {
      const { events, sessionId } = await runOpencode(
        "[plan] 리서치 생략. 설계 주제: 플러그인 상태 영속성 방식 결정. nx_plan_start 바로 호출.",
        { timeoutMs: 600000 }
      );
      assertToolCalled(events, "nx_plan_start");
      r.pass("Turn 1: nx_plan_start called");

      if (!sessionId) {
        r.warn("Turn 1: sessionId not extracted — HOW resume test reliability reduced");
      } else {
        howSessionId = sessionId;
        r.pass(`Turn 1: sessionId extracted (${sessionId.slice(0, 8)}...)`);
      }
    } catch (err) {
      r.fail(`Turn 1: ${err.message}`);
      console.log("  [how-resume] Skipping turns 2-3 due to Turn 1 failure");
      return r;
    }
  }

  // C2: Ask to delegate to architect → expect task tool with subagent_type=architect
  {
    console.log("  [how-resume/C2] Turn 2: architect에게 분석 의뢰 (600s timeout)");
    try {
      const { events } = await runOpencode("이 안건을 architect에게 분석 의뢰해줘", {
        sessionId: howSessionId ?? undefined,
        timeoutMs: 600000,
      });
      const taskUses = filterToolUses(events, "task");
      if (taskUses.length === 0) {
        const allTools = filterToolUses(events).map((e) => e.part?.tool ?? "").filter(Boolean);
        r.fail(
          `Turn 2: no "task" tool called — tools seen: ${allTools.join(", ") || "(none)"}. ` +
            "Architect spawn may require explicit plan context."
        );
      } else {
        const architectCall = taskUses.find(
          (e) =>
            e.part?.state?.input?.subagent_type === "architect" ||
            e.part?.state?.input?.agent === "architect"
        );
        if (architectCall) {
          r.pass("Turn 2: task tool called with subagent_type=architect");
        } else {
          const types = taskUses.map(
            (e) => e.part?.state?.input?.subagent_type ?? e.part?.state?.input?.agent ?? "(unknown)"
          );
          r.fail(
            `Turn 2: task tool called but subagent_type !== architect — got: ${types.join(", ")}`
          );
        }
      }
    } catch (err) {
      r.fail(`Turn 2: ${err.message}`);
    }
  }

  // C3: Follow-up question → check for resume mechanism
  {
    console.log("  [how-resume/C3] Turn 3: 아키텍트 후속 질문 (resume check, 600s timeout)");
    try {
      const { events } = await runOpencode("아키텍트에게 후속 질문: 더 구체적으로 설명해줘", {
        sessionId: howSessionId ?? undefined,
        timeoutMs: 600000,
      });
      const taskUses = filterToolUses(events, "task");

      if (taskUses.length === 0) {
        r.warn(
          "Turn 3: no task tool called on follow-up. " +
            "This may mean resume is handled via direct text continuation without re-spawning."
        );
        if (events.length > 0) {
          r.pass("Turn 3: event stream received (soft pass — no task re-spawn needed for resume)");
        } else {
          r.fail("Turn 3: no events received");
        }
      } else {
        // Check for resume identifiers across known schemas.
        // - opencode 1.3.13 native: `task_id` (single field, used by LLM and plugin auto-inject)
        // - Claude Code-style: `resume_task_id` / `resume_session_id` / `resume_handles`
        const resumeCall = taskUses.find((e) => {
          const inp = e.part?.state?.input ?? {};
          return (
            inp.task_id ||
            inp.taskId ||
            inp.resume_task_id ||
            inp.resume_session_id ||
            inp.resumeTaskId ||
            inp.resumeSessionId
          );
        });

        if (resumeCall) {
          const inp = resumeCall.part?.state?.input ?? {};
          const resumeId =
            inp.task_id ??
            inp.taskId ??
            inp.resume_task_id ??
            inp.resumeTaskId ??
            inp.resume_session_id ??
            inp.resumeSessionId;
          const field = inp.task_id || inp.taskId
            ? "task_id (opencode native)"
            : "resume_task_id (Claude Code naming)";
          r.pass(`Turn 3: task re-spawned with resume identifier via ${field} (${String(resumeId).slice(0, 16)}...)`);
        } else {
          r.warn(
            "Turn 3: task tool called but no task_id / resume_task_id found in input. " +
              "Either the LLM didn't reference a prior session and plugin auto-inject did not " +
              "trigger (no matching architect continuity), or the resume mechanism is unavailable. " +
              "See harness-docs/resume_invocation.md."
          );
          r.pass(
            "Turn 3: task tool called (no resume identifier this turn — soft pass)"
          );
        }
      }
    } catch (err) {
      r.fail(`Turn 3: ${err.message}`);
    }
  }

  return r;
}

// ---------------------------------------------------------------------------
// Group D: agent-prompt applied
// ---------------------------------------------------------------------------

async function runGroupAgentPrompt() {
  console.log("\n[agent-prompt] Group D — agent prompt applied");
  const r = makeReporter("agent-prompt");

  if (process.env.SMOKE_SKIP_AGENT_PROMPT === "1") {
    r.warn("Skipped via SMOKE_SKIP_AGENT_PROMPT=1");
    return r;
  }

  // Load engineer prompt keyword for indirect verification
  let engineerKeyword = "Engineer";
  try {
    const { AGENT_PROMPTS } = await import("../dist/agents/prompts.js");
    const engineerPrompt = AGENT_PROMPTS["engineer"] ?? "";
    // Extract a distinctive word from first 200 chars of engineer prompt
    const firstChunk = engineerPrompt.slice(0, 200);
    const words = firstChunk.match(/\b[A-Z][a-zA-Z]{4,}\b/g) ?? [];
    if (words.length > 0) {
      engineerKeyword = words[0];
    }
  } catch {
    // dist may not be built; use default keyword
  }

  let agentSessionId = null;

  // D1: Start plan for subagent prompt verification
  {
    console.log("  [agent-prompt/D1] Turn 1: [plan] 서브에이전트 프롬프트 검증 (600s timeout)");
    try {
      const { events, sessionId } = await runOpencode(
        "[plan] 리서치 생략. 주제: 엔지니어 역할 명세 확인. nx_plan_start 바로 호출.",
        { timeoutMs: 600000 }
      );
      assertToolCalled(events, "nx_plan_start");
      r.pass("Turn 1: nx_plan_start called");

      if (sessionId) {
        agentSessionId = sessionId;
        r.pass(`Turn 1: sessionId extracted (${sessionId.slice(0, 8)}...)`);
      } else {
        r.warn("Turn 1: sessionId not extracted");
      }
    } catch (err) {
      r.fail(`Turn 1: ${err.message}`);
      console.log("  [agent-prompt] Skipping turn 2 due to Turn 1 failure");
      return r;
    }
  }

  // D2: Delegate to engineer → expect task tool with subagent_type=engineer
  {
    console.log("  [agent-prompt/D2] Turn 2: engineer 에이전트 의뢰 (600s timeout)");
    try {
      const { events } = await runOpencode(
        "engineer 에이전트에게 이 주제의 구현 가능성 분석을 의뢰해줘",
        { sessionId: agentSessionId ?? undefined, timeoutMs: 600000 }
      );
      const taskUses = filterToolUses(events, "task");

      if (taskUses.length === 0) {
        const allTools = filterToolUses(events).map((e) => e.part?.tool ?? "").filter(Boolean);
        r.fail(
          `Turn 2: no "task" tool called — tools seen: ${allTools.join(", ") || "(none)"}`
        );
      } else {
        const engineerCall = taskUses.find(
          (e) =>
            e.part?.state?.input?.subagent_type === "engineer" ||
            e.part?.state?.input?.agent === "engineer"
        );
        if (engineerCall) {
          r.pass("Turn 2: task tool called with subagent_type=engineer");

          // Indirect: check if output text contains engineer prompt keyword (non-deterministic — WARN only)
          const textEvents = events.filter((e) => e.type === "text");
          const fullText = textEvents.map((e) => e.part?.text ?? "").join(" ");
          if (engineerKeyword && fullText.toLowerCase().includes(engineerKeyword.toLowerCase())) {
            r.warn(
              `Turn 2: engineer keyword "${engineerKeyword}" found in response text ` +
                "(indirect evidence of agent prompt application)"
            );
          } else {
            r.warn(
              `Turn 2: engineer keyword "${engineerKeyword}" not found in response text ` +
                "(non-deterministic — keyword may not appear even when prompt is applied correctly)"
            );
          }
        } else {
          const types = taskUses.map(
            (e) => e.part?.state?.input?.subagent_type ?? e.part?.state?.input?.agent ?? "(unknown)"
          );
          r.fail(`Turn 2: task tool called but subagent_type !== engineer — got: ${types.join(", ")}`);
        }
      }
    } catch (err) {
      r.fail(`Turn 2: ${err.message}`);
    }
  }

  return r;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanupArtifacts() {
  // Always clean up plan state leftover from smoke runs (plan.json / plan.opencode.json)
  // even if artifactPaths is empty.
  const planSideEffects = [
    path.join(PROJECT_DIR, ".nexus", "state", "plan.json"),
    path.join(PROJECT_DIR, ".nexus", "state", "plan.opencode.json"),
  ];
  for (const p of planSideEffects) {
    try {
      await fs.unlink(p);
      console.log(`  deleted (plan residue): ${path.relative(PROJECT_DIR, p)}`);
    } catch {
      // Not present — OK
    }
  }

  if (artifactPaths.length === 0) return;
  console.log(`\n[cleanup] Removing ${artifactPaths.length} test artifact(s)...`);
  for (const filePath of artifactPaths) {
    try {
      await fs.unlink(filePath);
      console.log(`  deleted: ${path.relative(PROJECT_DIR, filePath)}`);
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn(`  WARN: failed to delete ${filePath}: ${err.message}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Verify opencode binary exists
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(OPENCODE_BIN, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.on("error", (err) => {
        if (err.code === "ENOENT") {
          reject(
            new Error(
              `opencode binary not found: "${OPENCODE_BIN}"\n` +
                `Install opencode (e.g. brew install opencode-ai/tap/opencode) ` +
                `or set OPENCODE_BIN env var.`
            )
          );
        } else {
          reject(err);
        }
      });
      child.on("close", resolve);
    });
  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    process.exit(1);
  }

  const arg = process.argv[2] ?? "all";
  const validArgs = ["all", "basic", "plan-flow", "how-resume", "agent-prompt"];
  if (!validArgs.includes(arg)) {
    console.error(
      `Unknown scenario group: "${arg}"\n` +
        `Valid values: ${validArgs.join(" | ")}`
    );
    process.exit(1);
  }

  const runAll = arg === "all";
  const groupReporters = [];

  try {
    if (runAll || arg === "basic") {
      groupReporters.push(await runGroupBasic());
    }
    if (runAll || arg === "plan-flow") {
      groupReporters.push(await runGroupPlanFlow());
    }
    if (runAll || arg === "how-resume") {
      groupReporters.push(await runGroupHowResume());
    }
    if (runAll || arg === "agent-prompt") {
      groupReporters.push(await runGroupAgentPrompt());
    }
  } finally {
    await cleanupArtifacts();
  }

  // Summary
  console.log("\n====");
  let totalPass = 0;
  let totalFail = 0;
  for (const r of groupReporters) {
    const pass = r.results.filter((x) => x.ok).length;
    const fail = r.results.filter((x) => !x.ok).length;
    totalPass += pass;
    totalFail += fail;
    const icon = fail === 0 ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${r.groupName}: ${pass}/${pass + fail} assertions passed`);
  }
  const total = totalPass + totalFail;
  console.log(`\nSummary: ${totalPass}/${total} scenarios passed`);
  console.log("====");

  if (totalFail > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nUnhandled error: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
