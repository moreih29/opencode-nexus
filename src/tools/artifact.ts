import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { createNexusPaths } from "../shared/paths.js";

const z = tool.schema;

export const nxArtifactWrite = tool({
  description: "Write artifact file under .nexus/state/artifacts",
  args: {
    file: z.string(),
    content: z.string()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const safeName = sanitizeName(args.file);
    const out = path.join(paths.ARTIFACTS_ROOT, safeName);

    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, args.content, "utf8");
    return `Artifact saved: ${path.relative(paths.PROJECT_ROOT, out)}`;
  }
});

function sanitizeName(input: string): string {
  return input
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/");
}
