import {
  clearConnectedHostUpdate,
  connectedHostsToUpdate,
  saveConnectedHostUpdate,
} from "./connected-hosts.ts";
import { useSyncExternalStore } from "react";
import { native } from "../native.ts";

export type UpdateOptions = {
  version: string;
  backgroundDownload: boolean;
  foregroundOnly: boolean;
  administratorApproval?: boolean;
};
export type Available = { version: string; notesUrl: string };
type State = {
  options?: UpdateOptions;
  available?: Available;
  checking: boolean;
  updateConnectedHosts: boolean;
  confirmationAvailable?: boolean;
  phase: "idle" | "downloading" | "ready" | "installing" | "permission";
  latest?: boolean;
  error?:
    | "source"
    | "verification"
    | "download"
    | "install"
    | "cancelled"
    | "appimagelocation";
  progress?: { received: number; total: number };
};
let state: State = {
  checking: false,
  phase: "idle",
  updateConnectedHosts: true,
};
export function selectConnectedHostUpdate(selected: boolean) {
  change({ updateConnectedHosts: selected });
}
const listeners = new Set<() => void>();
function change(next: Partial<State>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const useClientUpdate = () =>
  useSyncExternalStore(subscribe, () => state);
let checking: Promise<void> | undefined;
let explicitCheck = false;
let downloading: Promise<void> | undefined;
let receiveDevelopmentVersions = false;

function failure(error: unknown, fallback: State["error"]): State["error"] {
  return error === "source" ||
    error === "verification" ||
    error === "download" ||
    error === "install" ||
    error === "appimagelocation"
    ? error
    : fallback;
}

export function checkUpdate(explicit = false): Promise<void> {
  // The downloaded Android package remains the active update until the
  // installer permission flow finishes, even if the channel changes.
  if (state.phase === "permission") return Promise.resolve();
  explicitCheck ||= explicit;
  if (checking) return checking;
  change({
    checking: true,
    ...(explicit ? { error: undefined } : {}),
  });
  const development = receiveDevelopmentVersions;
  checking = (async () => {
    try {
      const available = await native.updateCheck(development);
      if (
        development !== receiveDevelopmentVersions ||
        state.phase === "permission"
      )
        return;
      if (
        available &&
        available.version !== state.available?.version &&
        !downloading
      )
        change({ phase: "idle", updateConnectedHosts: true });
      change({
        available: available ?? undefined,
        latest: !available,
        error: undefined,
      });
      if (available && state.options?.backgroundDownload) void downloadUpdate();
    } catch (error) {
      if (explicitCheck && development === receiveDevelopmentVersions)
        change({ error: failure(error, "source"), latest: false });
    } finally {
      explicitCheck = false;
      checking = undefined;
      change({ checking: false });
      if (development !== receiveDevelopmentVersions) void checkUpdate(true);
    }
  })();
  return checking;
}
export function downloadUpdate(): Promise<void> {
  if (downloading) return downloading;
  if (state.phase === "ready") return Promise.resolve();
  change({
    phase: "downloading",
    progress: undefined,
    error: undefined,
  });
  const version = state.available?.version;
  const development = receiveDevelopmentVersions;
  downloading = native
    .updateDownload()
    .then(() => {
      if (development === receiveDevelopmentVersions)
        change({
          phase: state.available?.version === version ? "ready" : "idle",
        });
    })
    .catch((error: unknown) => {
      if (development === receiveDevelopmentVersions)
        change({ phase: "idle", error: failure(error, "download") });
    })
    .finally(() => {
      downloading = undefined;
      if (
        state.available &&
        (state.available.version !== version ||
          development !== receiveDevelopmentVersions) &&
        state.options?.backgroundDownload &&
        state.phase === "idle"
      )
        void downloadUpdate();
    });
  return downloading;
}
export async function installUpdate(resume = false) {
  if (["installing", "downloading"].includes(state.phase)) return;
  const updateVersion = state.available?.version;
  const hostKeys =
    updateVersion && state.updateConnectedHosts
      ? connectedHostsToUpdate(updateVersion).map((host) => host.publicKey)
      : [];
  change({ error: undefined });
  if (state.phase !== "ready" && state.phase !== "permission")
    await downloadUpdate();
  if (state.error || !["ready", "permission"].includes(state.phase)) return;
  change({
    phase: "installing",
    error: undefined,
    confirmationAvailable: false,
  });
  try {
    if (!resume && updateVersion)
      await saveConnectedHostUpdate(updateVersion, hostKeys).catch(() => {});
    const result = await native.updateInstall(resume);
    if (result !== "installing" && result !== "permission")
      await clearConnectedHostUpdate().catch(() => {});
    if (result === "permission") change({ phase: "permission" });
    else if (result === "cancelled")
      change({ phase: "ready", error: "cancelled" });
    else if (result !== "installing")
      change({ phase: "ready", error: "install" });
  } catch (error) {
    await clearConnectedHostUpdate().catch(() => {});
    change({ phase: "ready", error: failure(error, "install") });
  } finally {
    change({ confirmationAvailable: false });
  }
}

export async function resumeInstallation() {
  try {
    change({ error: undefined });
    await native.updateResumeInstallation();
  } catch (error) {
    change({ error: failure(error, "install") });
  }
}

// VS Code's ordinary update schedule checks hourly. No persisted check history.
const interval = 60 * 60 * 1000;
export function startUpdateChecks(development = false) {
  if (receiveDevelopmentVersions !== development) {
    receiveDevelopmentVersions = development;
    if (state.phase !== "permission")
      change({
        available: undefined,
        latest: undefined,
        phase: "idle",
        error: undefined,
        progress: undefined,
      });
  }
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopForeground: (() => void) | undefined;
  let stopConfirmation: (() => void) | undefined;
  let stopProgress: (() => void) | undefined;
  let foreground = true;
  void (async () => {
    const options = await native.updateOptions();
    if (disposed || !options) return;
    change({ options });
    stopProgress = await native.onUpdateProgress((progress) =>
      change({ progress }),
    );
    stopConfirmation = await native.onUpdateConfirmation((available) =>
      change({ confirmationAvailable: available }),
    );
    stopForeground = await native.onForeground((value) => {
      foreground = value;
      if (value && state.phase === "permission") void installUpdate(true);
    });
    if (disposed) {
      stopForeground();
      stopProgress();
      stopConfirmation();
      return;
    }
    void checkUpdate();
    timer = setInterval(() => {
      if (!options.foregroundOnly || foreground) void checkUpdate();
    }, interval);
  })().catch(() => {
    /* Unsupported development environments have no updater. */
  });
  return () => {
    disposed = true;
    clearInterval(timer);
    stopForeground?.();
    stopProgress?.();
    stopConfirmation?.();
  };
}
