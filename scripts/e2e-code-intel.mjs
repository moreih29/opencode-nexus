import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  nxLspCodeActions,
  nxLspDocumentSymbols,
  nxLspFindReferences,
  nxLspGotoDefinition,
  nxLspHover,
  nxLspRename,
  nxLspWorkspaceSymbols
} from "../dist/tools/lsp.js";
import { nxAstSearch, nxAstReplace } from "../dist/tools/ast.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-intel-"));
const file = path.join(root, "sample.ts");
await fs.writeFile(file, "function foo() { return 1 }\nconst bar = foo()\nconsole.log(bar)\n", "utf8");

const ctx = { directory: root, worktree: root };
const symbols = JSON.parse(await nxLspDocumentSymbols.execute({ file }, ctx));
assert.equal(symbols.symbols.length > 0, true);

const hover = JSON.parse(await nxLspHover.execute({ file, line: 1, character: 10 }, ctx));
assert.equal(hover.symbol, "foo");

const defs = JSON.parse(await nxLspGotoDefinition.execute({ file, line: 2, character: 13 }, ctx));
assert.equal(defs.definitions.length > 0, true);

const workspace = JSON.parse(await nxLspWorkspaceSymbols.execute({ query: "foo" }, ctx));
assert.equal(workspace.symbols.length > 0, true);

const refs = JSON.parse(await nxLspFindReferences.execute({ file, symbol: "foo" }, ctx));
assert.equal(refs.refs.length >= 1, true);

const previewRename = JSON.parse(await nxLspRename.execute({ file, from: "foo", to: "fooRenamed", apply: false }, ctx));
assert.equal(previewRename.totalOccurrences >= 2, true);

await nxLspRename.execute({ file, from: "foo", to: "fooRenamed", apply: true }, ctx);
const astMatches = JSON.parse(await nxAstSearch.execute({ file, pattern: "fooRenamed" }, ctx));
assert.equal(astMatches.matches.length > 0, true);

const actions = JSON.parse(await nxLspCodeActions.execute({ file }, ctx));
assert.equal(actions.actions.length > 0, true);

const dryRun = JSON.parse(await nxAstReplace.execute({ file, pattern: "bar", replace: "baz", dry_run: true }, ctx));
assert.equal(dryRun.changed, true);

await nxAstReplace.execute({ file, pattern: "bar", replace: "baz", dry_run: false }, ctx);
const final = await fs.readFile(file, "utf8");
assert.match(final, /baz/);

console.log("e2e code intel passed");
