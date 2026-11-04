import { teamCommandForms } from "@iori/protocol";

export function teamCommandPermissions(
  directory: string,
  windows: boolean,
): string[] {
  const forms = teamCommandForms(directory, windows);
  return [
    "Bash(iori *)",
    ...forms.bash.map((command) => `Bash(${command} *)`),
    ...(forms.powershell
      ? [
          "PowerShell(iori *)",
          ...forms.powershell.map((command) => `PowerShell(${command} *)`),
        ]
      : []),
  ];
}
