import assert from "node:assert/strict";

import { nxDelegateTemplate } from "../dist/tools/delegation.js";

const output = await nxDelegateTemplate.execute({
  task: "Implement API endpoint",
  current_state: "run phase execute",
  target_files: ["src/api.ts"],
  constraints: ["No schema break"],
  acceptance: ["All tests pass"]
});

assert.match(output, /^TASK:/m);
assert.match(output, /^CONTEXT:/m);
assert.match(output, /^CONSTRAINTS:/m);
assert.match(output, /^ACCEPTANCE:/m);

console.log("e2e delegation passed");
