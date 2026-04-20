// Path-scoped opencode.json patch engine.
// Design reference: plan #58 issue #2 — generic deep merge is forbidden; consumer-owned fields must never be touched.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import {
  DEFAULT_AGENT,
  MCP_SERVER_CONFIG,
  MCP_SERVER_NAME,
  PACKAGE_NAME,
  SCHEMA_URL,
  isNexusPluginEntry,
} from "./install-spec.mjs";

function lineAt(text, index) {
  return text.slice(0, Math.max(0, index)).split("\n").length;
}

function detectJsonc(raw) {
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1] ?? "";

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "/" && next === "/") {
      return { kind: "comment", line: lineAt(raw, i) };
    }

    if (ch === "/" && next === "*") {
      return { kind: "comment", line: lineAt(raw, i) };
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j += 1;
      const token = raw[j] ?? "";
      if (token === "]" || token === "}") {
        return { kind: "trailing-comma", line: lineAt(raw, i) };
      }
    }
  }

  return null;
}

function detectIndent(raw) {
  const lines = raw.split("\n");
  for (const line of lines) {
    const match = line.match(/^(\s+)\S/);
    if (!match) continue;
    const leading = match[1];
    if (/^ +$/.test(leading) && leading.length === 4) return 4;
    return 2;
  }
  return 2;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object") {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function setByPath(obj, path, value) {
  const parts = path.split(".");
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (typeof cursor[part] !== "object" || cursor[part] === null || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function deleteByPath(obj, path) {
  const parts = path.split(".");
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (typeof cursor !== "object" || cursor === null || !Object.prototype.hasOwnProperty.call(cursor, part)) {
      return;
    }
    cursor = cursor[part];
  }
  if (typeof cursor === "object" && cursor !== null) {
    delete cursor[parts[parts.length - 1]];
  }
}

function makePatchResult(changes) {
  return {
    changes,
    hasChanges: changes.some((change) => change.op !== "warn"),
  };
}

function tsForBackup(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function rotateBackups(configPath, keep = 5) {
  const dir = dirname(configPath);
  const base = basename(configPath);
  const prefix = `${base}.backup-`;
  const backups = readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({
      name,
      full: join(dir, name),
      mtimeMs: statSync(join(dir, name)).mtimeMs,
    }))
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  if (backups.length <= keep) return;
  for (const old of backups.slice(0, backups.length - keep)) {
    unlinkSync(old.full);
  }
}

function summarizeChange(scope, change) {
  if (change.op === "warn") return `[${scope}] ${change.note}`;
  if (change.op === "delete") return `[${scope}] remove ${change.path}`;
  if (change.op === "insert") return `[${scope}] add ${change.path} ${JSON.stringify(change.after)}`;
  return `[${scope}] set ${change.path} ${JSON.stringify(change.after)}`;
}

/**
 * Read and parse opencode.json. Returns { config, raw, indent, trailingNewline }.
 * Throws clear error on JSONC (comments / trailing commas).
 */
export function readConfig(path) {
  if (!existsSync(path)) {
    return {
      config: {},
      raw: "",
      indent: 2,
      trailingNewline: true,
    };
  }

  const raw = readFileSync(path, "utf8");
  const foundJsonc = detectJsonc(raw);
  if (foundJsonc) {
    throw new Error(
      `opencode.json contains JSONC syntax (comments/trailing commas) at line ${foundJsonc.line}. CLI requires strict JSON. Remove unsupported syntax or file an issue.`,
    );
  }

  let config;
  try {
    config = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    throw new Error(`Failed to parse opencode.json as strict JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("opencode.json must contain a top-level JSON object.");
  }

  return {
    config,
    raw,
    indent: detectIndent(raw),
    trailingNewline: raw.endsWith("\n"),
  };
}

/**
 * Compute path-scoped patch for install/uninstall.
 * Returns { changes: [...], hasChanges: bool }.
 */
export function computePatch(config, scope, mode, opts = {}) {
  const pluginSpec = typeof opts.pluginSpec === "string" && opts.pluginSpec.length > 0 ? opts.pluginSpec : PACKAGE_NAME;
  const ownsPlugin = opts.ownsPlugin ?? true;
  const ownsDefaultAgent = opts.ownsDefaultAgent ?? (scope === "project");
  const ownsMcp = opts.ownsMcp ?? true;
  const force = opts.force === true;
  const normalize = opts.normalize === true;

  const next = clone(config) ?? {};
  const changes = [];

  if (ownsPlugin) {
    const pluginBefore = next.plugin;
    const pluginIsArray = Array.isArray(pluginBefore);
    const pluginList = pluginIsArray ? [...pluginBefore] : [];
    const nexusIndexes = pluginList
      .map((entry, index) => (isNexusPluginEntry(entry) ? index : -1))
      .filter((index) => index >= 0);

    if (mode === "install") {
      if (!pluginIsArray || pluginList.length === 0) {
        next.plugin = [pluginSpec];
        changes.push({ op: "set", path: "plugin", before: clone(pluginBefore), after: clone(next.plugin) });
      } else {
        if (nexusIndexes.length === 0) {
          const after = [...pluginList, pluginSpec];
          next.plugin = after;
          changes.push({ op: "insert", path: "plugin", before: clone(pluginList), after: clone(after), note: "append Nexus plugin" });
        } else if (nexusIndexes.length > 1) {
          changes.push({
            op: "warn",
            path: "plugin",
            before: clone(pluginList),
            after: clone(pluginList),
            note: `multiple ${PACKAGE_NAME} entries detected; preserve-first mode keeps as-is (use --normalize to collapse)`,
          });

          if (normalize) {
            const collapsed = [];
            let inserted = false;
            for (const entry of pluginList) {
              if (isNexusPluginEntry(entry)) {
                if (!inserted) {
                  collapsed.push(pluginSpec);
                  inserted = true;
                }
                continue;
              }
              collapsed.push(entry);
            }
            next.plugin = collapsed;
            changes.push({ op: "set", path: "plugin", before: clone(pluginList), after: clone(collapsed), note: "normalize Nexus plugin duplicates" });
          }
        }
      }
    } else if (mode === "uninstall") {
      if (pluginIsArray && pluginList.length > 0) {
        const filtered = pluginList.filter((entry) => !isNexusPluginEntry(entry));
        if (filtered.length !== pluginList.length) {
          if (filtered.length === 0) {
            delete next.plugin;
            changes.push({ op: "delete", path: "plugin", before: clone(pluginList), after: undefined });
          } else {
            next.plugin = filtered;
            changes.push({ op: "set", path: "plugin", before: clone(pluginList), after: clone(filtered) });
          }
        }
      }
    }
  }

  if (ownsMcp) {
    const mcpBefore = typeof next.mcp === "object" && next.mcp !== null && !Array.isArray(next.mcp) ? next.mcp : undefined;
    const nxBefore = mcpBefore?.[MCP_SERVER_NAME];

    if (mode === "install") {
      if (!deepEqual(nxBefore, MCP_SERVER_CONFIG)) {
        const afterMcp = {
          ...(mcpBefore ?? {}),
          [MCP_SERVER_NAME]: clone(MCP_SERVER_CONFIG),
        };
        next.mcp = afterMcp;
        changes.push({ op: "set", path: `mcp.${MCP_SERVER_NAME}`, before: clone(nxBefore), after: clone(MCP_SERVER_CONFIG) });
      }
    } else if (mode === "uninstall") {
      if (mcpBefore && Object.prototype.hasOwnProperty.call(mcpBefore, MCP_SERVER_NAME)) {
        const afterMcp = { ...mcpBefore };
        delete afterMcp[MCP_SERVER_NAME];
        if (Object.keys(afterMcp).length === 0) {
          delete next.mcp;
          changes.push({ op: "delete", path: "mcp", before: clone(mcpBefore), after: undefined, note: "cleanup empty mcp container" });
        } else {
          next.mcp = afterMcp;
          changes.push({ op: "delete", path: `mcp.${MCP_SERVER_NAME}`, before: clone(nxBefore), after: undefined });
        }
      }
    }
  }

  if (ownsDefaultAgent) {
    const defaultBefore = next.default_agent;
    if (mode === "install") {
      if (defaultBefore === undefined) {
        next.default_agent = DEFAULT_AGENT;
        changes.push({ op: "set", path: "default_agent", before: undefined, after: DEFAULT_AGENT });
      } else if (defaultBefore === DEFAULT_AGENT) {
        // no-op
      } else if (force) {
        next.default_agent = DEFAULT_AGENT;
        changes.push({ op: "set", path: "default_agent", before: defaultBefore, after: DEFAULT_AGENT, note: "forced overwrite" });
      } else {
        changes.push({
          op: "warn",
          path: "default_agent",
          before: defaultBefore,
          after: defaultBefore,
          note: `preserve existing default_agent=${JSON.stringify(defaultBefore)} (use --force to overwrite)`,
        });
      }
    } else if (mode === "uninstall") {
      if (defaultBefore === DEFAULT_AGENT) {
        delete next.default_agent;
        changes.push({ op: "delete", path: "default_agent", before: DEFAULT_AGENT, after: undefined });
      }
    }
  }

  if (mode === "install" && next.$schema === undefined) {
    next.$schema = SCHEMA_URL;
    changes.push({ op: "set", path: "$schema", before: undefined, after: SCHEMA_URL });
  }

  const result = makePatchResult(changes);
  result.nextConfig = next;
  return result;
}

/**
 * Apply patch atomically. Creates sibling backup (.backup-TIMESTAMP), writes temp file, atomic rename.
 * Keeps last 5 backups, oldest removed.
 */
export function applyPatch(path, patch, opts = {}) {
  if (!patch || !patch.hasChanges) {
    return { written: false, appliedChanges: [] };
  }

  const current = readConfig(path);
  const newConfig = clone(current.config);

  for (const change of patch.changes) {
    if (change.op === "warn") continue;
    if (change.op === "delete") {
      deleteByPath(newConfig, change.path);
      continue;
    }
    setByPath(newConfig, change.path, clone(change.after));
  }

  const serialized = `${JSON.stringify(newConfig, null, current.indent)}${current.trailingNewline ? "\n" : ""}`;

  mkdirSync(dirname(path), { recursive: true });

  const backupPath = existsSync(path) ? `${path}.backup-${tsForBackup()}` : undefined;
  if (backupPath) {
    copyFileSync(path, backupPath);
  }

  const tempPath = `${path}.tmp-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(tempPath, serialized, "utf8");
    renameSync(tempPath, path);
  } catch (error) {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
    throw error;
  }

  rotateBackups(path, opts.keepBackups ?? 5);
  return {
    written: true,
    backupPath,
    appliedChanges: patch.changes,
  };
}

/**
 * Render human-readable summary + semantic JSON diff for --dry-run.
 */
export function renderPatch(patch, path, scope) {
  const summary = patch.changes.map((change) => summarizeChange(scope, change)).join("\n");
  return {
    summary: summary || `[${scope}] no changes for ${path}`,
    diff: {
      path,
      scope,
      changes: patch.changes.map((change) => ({
        op: change.op,
        path: change.path,
        before: change.before,
        after: change.after,
        note: change.note,
      })),
    },
  };
}

/**
 * For doctor: check if current config satisfies managed spec.
 */
export function inspectConfig(config, scope, opts = {}) {
  const ownsPlugin = opts.ownsPlugin ?? true;
  const ownsDefaultAgent = opts.ownsDefaultAgent ?? (scope === "project");
  const ownsMcp = opts.ownsMcp ?? true;

  const plugin = Array.isArray(config?.plugin) ? config.plugin : [];
  const pluginPresent = ownsPlugin ? plugin.some((entry) => isNexusPluginEntry(entry)) : true;

  const mcp = typeof config?.mcp === "object" && config.mcp !== null && !Array.isArray(config.mcp) ? config.mcp : undefined;
  const mcpNxCorrect = ownsMcp ? deepEqual(mcp?.[MCP_SERVER_NAME], MCP_SERVER_CONFIG) : true;

  const defaultAgentIsLead = ownsDefaultAgent ? config?.default_agent === DEFAULT_AGENT : null;

  const partial = [];
  const missing = [];

  if (ownsPlugin) {
    if (pluginPresent) partial.push("plugin");
    else missing.push("plugin");
  }

  if (ownsMcp) {
    if (mcpNxCorrect) partial.push(`mcp.${MCP_SERVER_NAME}`);
    else missing.push(`mcp.${MCP_SERVER_NAME}`);
  }

  if (ownsDefaultAgent) {
    if (defaultAgentIsLead) partial.push("default_agent");
    else missing.push("default_agent");
  }

  const orphan_signals = [];
  if (ownsMcp && pluginPresent && !mcpNxCorrect) orphan_signals.push("plugin-present-without-mcp.nx");
  if (ownsMcp && !pluginPresent && mcpNxCorrect) orphan_signals.push("mcp.nx-present-without-plugin");
  if (ownsDefaultAgent && defaultAgentIsLead && !pluginPresent) orphan_signals.push("default_agent=lead-without-plugin");

  return {
    installed: missing.length === 0,
    partial,
    missing,
    plugin_present: pluginPresent,
    mcp_nx_correct: mcpNxCorrect,
    default_agent_is_lead: defaultAgentIsLead,
    orphan_signals,
  };
}
