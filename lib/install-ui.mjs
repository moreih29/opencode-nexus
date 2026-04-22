import { promptSelectInteractive } from "./ink-select.mjs";

export async function selectInstallScopeInteractive() {
  return promptSelectInteractive({
    title: "Choose where to install Nexus for OpenCode",
    subtitle: "Project scope writes ./opencode.json. User scope writes ~/.config/opencode/opencode.json.",
    options: [
      {
        value: "project",
        label: "project",
        hint: "Recommended for one repository",
      },
      {
        value: "user",
        label: "user",
        hint: "Apply to all OpenCode projects for this user",
      },
    ],
    initialValue: "project",
  });
}

export async function selectConfigureModelsNowInteractive() {
  return promptSelectInteractive({
    title: "Configure agent models now?",
    subtitle: "You can skip this and run opencode-nexus models later.",
    options: [
      {
        value: "yes",
        label: "Configure models now",
        hint: "Open the agent model picker immediately",
      },
      {
        value: "no",
        label: "Skip for now",
        hint: "Leave model selection for later",
      },
    ],
    initialValue: "yes",
  });
}
