#!/usr/bin/env node

// Re-export the nexus-mcp entrypoint from @moreih29/nexus-core so that
// `opencode-nexus` exposes `nexus-mcp` as a first-class bin in the host's
// $PATH on global install. Without this shim, `nexus-mcp` only lives under
// `node_modules/.bin/` of the installed opencode-nexus package and is not
// symlinked into the global bin directory (npm and bun do not hoist
// transitive-dependency bins to the global bin). OpenCode then fails to
// spawn the server referenced by `opencode.json` as
// `mcp.nx.command: ["nexus-mcp"]` with "Executable not found in $PATH".
//
// The shim is a thin dynamic-import wrapper so that the actual server
// implementation remains owned by @moreih29/nexus-core and we do not have
// to maintain a second copy in this package. The server (`./mcp` subpath
// export) starts a StdioServerTransport on import; keeping the Node event
// loop open is handled by the underlying transport.

await import("@moreih29/nexus-core/mcp");
