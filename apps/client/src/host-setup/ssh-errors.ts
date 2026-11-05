export const stages: Record<string, string> = {
  connect: "Checking the SSH destination",
  download: "The destination machine is downloading iori Host",
  verification: "Verifying iori Host",
  extract: "Extracting iori Host on the destination",
  service: "Setting up iori Host to run after logout",
  start: "Starting iori Host on the destination",
  register: "Registering this device",
  firewall: "Allowing connections from other devices",
};
export const unreachable =
  "SSH connected, but the iori connection could not reach the Host. Check the Host’s listening addresses and network route in Connection settings.";
export function formatError(error: string, t: (key: string) => string) {
  if (error.startsWith("IORI_CONTROL_ERROR: "))
    return t("The Host could not complete the request: {message}").replace(
      "{message}",
      t(error.slice("IORI_CONTROL_ERROR: ".length)),
    );
  const exit = /^SSH_EXIT:(-?\d+)\n([\s\S]*)$/.exec(error);
  if (exit)
    return t("SSH exited with code {code}: {message}")
      .replace("{code}", exit[1]!)
      .replace("{message}", t(exit[2]!));
  const command = /^SSH_COMMAND_FAILED:(\d+):([^\n]*)\n([\s\S]*)$/.exec(error);
  if (command)
    return t(
      "The destination command failed ({stage}, exit code {code}): {message}",
    )
      .replace("{stage}", t(stages[command[2]!] ?? "Command"))
      .replace("{code}", command[1]!)
      .replace("{message}", t(command[3]!));
  if (error.startsWith("SSH_CLOSED\n"))
    return t("SSH closed: {message}").replace(
      "{message}",
      t(error.slice("SSH_CLOSED\n".length)),
    );
  const translated = t(error);
  return translated !== error
    ? translated
    : t("Could not complete SSH setup: {message}").replace("{message}", error);
}
