import type { ClientOs, HostInfo } from "../native.ts";

export function isSameMachineHost({
  clientOs,
  localHostKey,
  host,
  path,
}: {
  clientOs?: ClientOs;
  localHostKey?: string;
  host: Pick<HostInfo, "publicKey" | "connectionScope">;
  path: string;
}) {
  if (!clientOs) return false;
  const compatiblePath =
    clientOs === "windows"
      ? /^[A-Za-z]:[/\\]/u.test(path)
      : path.startsWith("/") && !path.startsWith("//");
  return (
    compatiblePath &&
    ((localHostKey !== undefined && localHostKey === host.publicKey) ||
      host.connectionScope === "loopback")
  );
}

export function revealInFileManagerLabelKey(clientOs: ClientOs) {
  return {
    windows: "Reveal in File Explorer",
    macos: "Reveal in Finder",
    linux: "Open Containing Folder",
  }[clientOs];
}

export function joinHostPath(root: string, relativePath: string) {
  if (root.includes("\\") || /^[A-Za-z]:/u.test(root)) {
    return `${root.replaceAll("/", "\\").replace(/\\+$/u, "")}\\${relativePath.replaceAll("/", "\\")}`;
  }
  return `${root.replace(/\/+$/u, "")}/${relativePath}`;
}

export type RevealInFileManager = {
  labelKey: string;
  open: (path: string, openDirectory?: boolean) => Promise<void>;
};
