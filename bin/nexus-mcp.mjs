#!/usr/bin/env node

// Expose `nexus-mcp` as a first-class bin of opencode-nexus so global installs
// symlink it into the host's $PATH. OpenCode spawns the MCP server referenced
// in `opencode.json` as `mcp.nx.command: ["nexus-mcp"]`; without this shim the
// binary only lives under the wrapper's nested `node_modules/.bin/` and both
// npm and bun refuse to hoist transitive-dependency bins to the global bin
// directory, so OpenCode fails with
// `✗ nx failed. Executable not found in $PATH: "nexus-mcp"`.
//
// IMPORTANT: importing `@moreih29/nexus-core/mcp` alone is NOT enough. The
// upstream `dist/mcp/server.js` guards `main()` with `isDirectRun` that
// compares `import.meta.url` to `file://${process.argv[1]}`. When this shim
// imports the module, `process.argv[1]` is the shim path while
// `import.meta.url` points at `server.js`, so the guard evaluates false and
// `main()` never runs. The server never opens its StdioServerTransport, the
// Node event loop drains, and OpenCode reports
// `MCP error -32000: Connection closed` — the same symptom v0.13.4 tried to
// fix but couldn't because of this second layer. Explicitly awaiting the
// exported `main()` is the supported path.

import { main } from "@moreih29/nexus-core/mcp";

try {
  await main();
} catch (err) {
  console.error("[nexus-mcp] fatal:", err);
  process.exit(1);
}
