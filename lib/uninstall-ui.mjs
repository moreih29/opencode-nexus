import { confirm, isCancel, select } from "@clack/prompts";

export async function selectUninstallScopeInteractive() {
  const value = await select({
    message: "Choose where to uninstall Nexus for OpenCode",
    options: [
      {
        value: "project",
        label: "project",
        hint: "Remove Nexus setup from this repository",
      },
      {
        value: "user",
        label: "user",
        hint: "Remove Nexus setup for this user",
      },
    ],
    initialValue: "project",
  });

  if (isCancel(value)) return null;
  return value;
}

export async function confirmUninstallInteractive({ scope }) {
  const value = await confirm({
    message: scope === "both" ? "Remove opencode-nexus config from project AND user?" : `Remove opencode-nexus config from ${scope}?`,
    initialValue: false,
  });

  if (isCancel(value)) return null;
  return value ? "yes" : "no";
}
