import type { SshFailure, SshStage } from "./ssh-events.ts";

export function message(
  t: (key: string) => string,
  key: string,
  values: Record<string, string> = {},
) {
  return t(key).replace(
    /\{([^}]+)\}/g,
    (placeholder, name: string) => values[name] ?? placeholder,
  );
}

export function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./@%+=:-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

/** OpenSSH の [user@]host / ssh://[user@]host[:port]。config の別名もそのまま渡す。 */
export function parseDestination(input: string): string | undefined {
  const value = input.trim();
  if (!value || value.startsWith("-") || /[\s\x00-\x1f\x7f]/.test(value))
    return;
  const uri = value.startsWith("ssh://");
  const target = uri ? value.slice(6) : value;
  const at = target.lastIndexOf("@");
  if (at === 0) return;
  const host = target.slice(at + 1);
  if (!host || /[/?#]/.test(host)) return;
  if (uri && !/^(?:\[[^\]]+\]|[^:\[\]]+)(?::\d+)?$/.test(host)) return;
  return value;
}

/** スクリプトの細かい段を、利用者に示す段へ畳む。 */
export function setupStep(
  stage: SshStage,
  windows: boolean,
  update: boolean | "register" = false,
): number {
  if (update === "register") return 0;
  if (update) return stage === "register" ? 1 : 0;
  if (stage === "register") return windows ? 4 : 3;
  if (stage === "service" || stage === "start") return windows ? 3 : 2;
  if (stage === "firewall") return 2;
  if (stage === "extract") return 1;
  return 0;
}
export function setupLabels(
  host: string,
  windows: boolean,
  update: boolean | "register",
  t: (key: string) => string,
): string[] {
  if (update === "register") return [t("Register this device")];
  if (update) return [t("Update iori Host"), t("Register this device")];
  return [
    message(t, "Download on {host}", { host }),
    t("Extract files"),
    ...(windows ? [t("Add firewall permission")] : []),
    t("Start iori Host"),
    t("Register this device"),
  ];
}

export function failureMessage(
  failure: SshFailure,
  host: string,
  t: (key: string) => string,
  update = false,
  identity?: { user?: string; host?: string },
): string {
  const values = {
    host: failure.kind === "authFailed" ? (identity?.host ?? host) : host,
    address: failure.address ?? "",
    user: identity?.user ?? "",
  };
  const keys: Partial<Record<SshFailure["kind"], string>> = {
    refused: failure.address
      ? "Could not connect to {host} ({address}) over SSH. Check that an SSH server is running on {host}, then retry."
      : "Could not connect to {host} over SSH. Check that an SSH server is running on {host}, then retry.",
    unresolved:
      "Could not find the address of {host}. Check the destination name, then retry.",
    timeout: failure.address
      ? "{host} ({address}) did not respond. Check the network, then retry."
      : "{host} did not respond. Check the network, then retry.",
    hostKeyChanged:
      "The host key for {host} has changed since the last connection, so the connection was refused. Check why it changed, then remove the old host key with this command and retry.",
    authFailed: identity?.user
      ? "Could not sign in to {user}@{host}. Retry."
      : "Could not sign in to {host}. Retry.",
    probe: "Invalid SSH destination information",
    disconnected:
      "The SSH connection to {host} was lost during installation. Retry.",
    downloadTools:
      "Neither curl nor wget is installed on {host}. Install one of them, then retry.",
  };
  const key =
    failure.kind === "install" && failure.stage === "extract"
      ? update
        ? "Could not extract iori Host on {host}. Check the state of iori Host on {host}, then retry."
        : "Could not extract iori Host on {host}. Retry."
      : keys[failure.kind];
  return key
    ? message(t, key, values)
    : t(
        failure.kind === "install"
          ? failure.stage === "download"
            ? "Could not download iori Host. Check the connection and retry."
            : failure.stage === "verification"
              ? "Could not verify iori Host. Retry downloading."
              : "Could not install or start iori Host. Retry the installation."
          : "Could not complete registration. Retry registration.",
      );
}
