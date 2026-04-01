import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { nxLspSymbols, nxLspFindReferences, nxLspRename } from "../dist/tools/lsp.js";
import { nxAstSearch, nxAstReplace } from "../dist/tools/ast.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-nexus-intel-"));
const file = path.join(root, "sample.ts");
await fs.writeFile(file, "function foo() { return 1 }\nconst bar = foo()\n", "utf8");

const ctx = { directory: root, worktree: root };
const symbols = JSON.parse(await nxLspSymbols.execute({ file }, ctx));
assert.equal(symbols.symbols.length > 0, true);

const refs = JSON.parse(await nxLspFindReferences.execute({ file, symbol: "foo" }, ctx));
assert.equal(refs.refs.length >= 2, true);

await nxLspRename.execute({ file, from: "foo", to: "fooRenamed" }, ctx);
const astMatches = JSON.parse(await nxAstSearch.execute({ file, pattern: "fooRenamed" }, ctx));
assert.equal(astMatches.matches.length > 0, true);

await nxAstReplace.execute({ file, pattern: "bar", replace: "baz" }, ctx);
const final = await fs.readFile(file, "utf8");
assert.match(final, /baz/);

console.log("e2e code intel passed");
