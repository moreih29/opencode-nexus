import { tool } from "@opencode-ai/plugin";
import { createNexusPaths } from "../shared/paths.js";
import { readJsonFile } from "../shared/json-store.js";
import { type HistoryCycle } from "../shared/history.js";

const z = tool.schema;

interface HistoryFile {
  cycles: HistoryCycle[];
}

export const nxHistorySearch = tool({
  description: "Search past work cycles in history.json by keyword or return recent N cycles",
  args: {
    query: z.string().optional(),
    last_n: z.number().optional()
  },
  async execute(args, context) {
    const paths = createNexusPaths(context.worktree ?? context.directory);
    const history = await readJsonFile<HistoryFile>(paths.HISTORY_FILE, { cycles: [] });
    const allCycles: HistoryCycle[] = Array.isArray(history.cycles) ? history.cycles : [];

    let matched: HistoryCycle[];
    if (args.query !== undefined && args.query !== "") {
      const lower = args.query.toLowerCase();
      matched = allCycles.filter((cycle) => JSON.stringify(cycle).toLowerCase().includes(lower));
    } else {
      matched = allCycles;
    }

    const total = matched.length;
    const sliced = args.last_n !== undefined ? matched.slice(-args.last_n) : matched;
    const showing = sliced.length;

    return JSON.stringify({ total, showing, cycles: sliced }, null, 2);
  }
});
