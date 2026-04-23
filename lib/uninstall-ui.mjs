import { promptSelectInteractive } from "./ink-select.mjs";

export async function selectUninstallScopeInteractive() {
  return promptSelectInteractive({
    title: "Choose where to uninstall Nexus for OpenCode",
    subtitle: "Project scope edits ./opencode.json. User scope edits ~/.config/opencode/opencode.json.",
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
}

export async function confirmUninstallInteractive({ scope }) {
  return promptSelectInteractive({
    title: scope === "both" ? "Remove opencode-nexus config from project AND user?" : `Remove opencode-nexus config from ${scope}?`,
    subtitle: "This will revert config keys we wrote and remove our skill directories. Your other settings are preserved.",
    options: [
      {
        value: "yes",
        label: "Remove",
      },
      {
        value: "no",
        label: "Cancel",
      },
    ],
    initialValue: "no",
  });
}
