import { confirm, isCancel, select } from "@clack/prompts";

export async function selectInstallScopeInteractive() {
  const value = await select({
    message: "Choose where to install Nexus for OpenCode",
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

  if (isCancel(value)) return null;
  return value;
}

export async function selectConfigureModelsNowInteractive() {
  const value = await confirm({
    message: "Configure agent models now?",
    initialValue: false,
  });

  if (isCancel(value)) return null;
  return value ? "yes" : "no";
}
