import { tool } from "@opencode-ai/plugin";
import { buildDelegationTemplate } from "../orchestration/delegation";

const z = tool.schema;

export const nxDelegateTemplate = tool({
  description: "Build structured delegation template",
  args: {
    task: z.string(),
    current_state: z.string(),
    dependencies: z.array(z.string()).optional(),
    prior_decisions: z.array(z.string()).optional(),
    target_files: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
    acceptance: z.array(z.string()).optional()
  },
  async execute(args) {
    return buildDelegationTemplate({
      task: args.task,
      currentState: args.current_state,
      dependencies: args.dependencies,
      priorDecisions: args.prior_decisions,
      targetFiles: args.target_files,
      constraints: args.constraints,
      acceptance: args.acceptance
    });
  }
});
