import { ConnectedHostUpdates } from "./updates/ConnectedHostUpdates.tsx";
import { MaintenanceClisContext } from "./updates/HostMaintenanceDetails.tsx";
import type { CliSummary } from "@iori/protocol";
import { NoticeStack } from "./components/flow/Toast.tsx";
import {
  HostUninstallDialog,
  showUninstallNotice,
  type UninstallActions,
} from "./updates/HostUninstallDialog.tsx";
import {
  startUninstallFlows,
  uninstallFlow,
  useUninstallFlows,
} from "./updates/uninstall-flow.ts";
import type { UninstallFlow } from "./updates/uninstall-flow-types.ts";
import {
  HostSetupDialog,
  HostSetupChoices,
} from "./host-setup/HostSetupDialog.tsx";
import {
  hostNeedsUpdate,
  startHostMaintenance,
} from "./updates/host-controller.ts";
import { startUpdateChecks, useClientUpdate } from "./updates/controller.ts";
import { UpdateMark } from "./updates/UpdateSettings.tsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { inviteFromText, type Invite } from "@iori/protocol";
import { connection } from "./connection.ts";
import { WindowChrome } from "./WindowChrome.tsx";
import { native, hasWindowChrome } from "./native.ts";
import { translator } from "./i18n.ts";
import { WorkspaceFrame, type LastWorkspaceTarget } from "./WorkspaceFrame.tsx";
import { ReadingPanel } from "./reading/ReadingPanel.tsx";
import {
  ErrorMessage,
  SettingsDialog,
  DEFAULT_SIDEBAR_WIDTH,
  type Preferences,
  type SettingsSection,
} from "./Settings.tsx";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { Textarea } from "./components/ui/textarea.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.tsx";
import { normalizeTerminalAccessoryLayout } from "./terminal/terminal-accessory-layout.ts";
import "./app.css";

const defaultPreferences: Preferences = {
  notifyWaiting: true,
  notifyDone: true,
  backgroundConnection: false,
  notificationPrompted: false,
  closeToExit: false,
  receiveDevelopmentVersions: false,
  language: "system",
  theme: "system",
  fontSize: 16,
  terminalFontSize: 14,
  terminalRightClick: "menu",
  terminalLinkOpen: "click",
  showForgeStatus: true,
  doubleClickMaximize: true,
  panelWidths: {},
  panelFullWidth: {},
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function entries<T>(value: unknown, keep: (item: unknown) => item is T) {
  return isObject(value)
    ? Object.fromEntries(Object.entries(value).filter(([, item]) => keep(item)))
    : {};
}

// Saved settings are read leniently: a value of an unknown shape falls back to
// its default instead of reaching the screen.
function readPreferences(value: unknown): Preferences {
  if (!isObject(value)) return defaultPreferences;
  const isNumber = (item: unknown): item is number =>
    typeof item === "number" && Number.isFinite(item);
  const isBoolean = (item: unknown): item is boolean =>
    typeof item === "boolean";
  const target = value.lastWorkspaceTarget;
  const input = value.terminalInput;
  return {
    ...(Object.fromEntries(
      (
        [
          "notifyWaiting",
          "notifyDone",
          "backgroundConnection",
          "notificationPrompted",
          "closeToExit",
          "receiveDevelopmentVersions",
        ] as const
      ).map((key) => [
        key,
        isBoolean(value[key]) ? value[key] : defaultPreferences[key],
      ]),
    ) as Pick<
      Preferences,
      | "notifyWaiting"
      | "notifyDone"
      | "backgroundConnection"
      | "notificationPrompted"
      | "closeToExit"
      | "receiveDevelopmentVersions"
    >),
    language: ["system", "en", "ja"].includes(value.language as string)
      ? (value.language as Preferences["language"])
      : defaultPreferences.language,
    theme: ["system", "light", "dark"].includes(value.theme as string)
      ? (value.theme as Preferences["theme"])
      : defaultPreferences.theme,
    fontSize: isNumber(value.fontSize)
      ? value.fontSize
      : defaultPreferences.fontSize,
    terminalFontSize: isNumber(value.terminalFontSize)
      ? value.terminalFontSize
      : defaultPreferences.terminalFontSize,
    terminalRightClick:
      value.terminalRightClick === "copyPaste" ? "copyPaste" : "menu",
    terminalLinkOpen:
      value.terminalLinkOpen === "ctrlClick" ? "ctrlClick" : "click",
    showForgeStatus: isBoolean(value.showForgeStatus)
      ? value.showForgeStatus
      : true,
    doubleClickMaximize: isBoolean(value.doubleClickMaximize)
      ? value.doubleClickMaximize
      : defaultPreferences.doubleClickMaximize,
    hostOrder: value.hostOrder as string[] | undefined,
    sidebarCollapsed:
      Array.isArray(value.sidebarCollapsed) &&
      value.sidebarCollapsed.every((item) => typeof item === "string")
        ? value.sidebarCollapsed
        : undefined,
    sidebarWidth: isNumber(value.sidebarWidth)
      ? value.sidebarWidth
      : DEFAULT_SIDEBAR_WIDTH,
    panelWidths: entries(value.panelWidths, isNumber),
    panelFullWidth: entries(value.panelFullWidth, isBoolean),
    ...(isObject(target) &&
    ["hostKey", "workspacePath", "folderPath", "worktreePath"].every(
      (key) => typeof target[key] === "string",
    )
      ? { lastWorkspaceTarget: target as Preferences["lastWorkspaceTarget"] }
      : {}),
    ...(value.keyboard === undefined ? {} : { keyboard: value.keyboard }),
    ...(isObject(input) && isBoolean(input.desktopWidth)
      ? {
          terminalInput: {
            desktopWidth: input.desktopWidth,
            terminals: input.terminals as NonNullable<
              Preferences["terminalInput"]
            >["terminals"],
          },
        }
      : {}),
  };
}

export default function App() {
  const maintenanceClis = useRef<
    () => Record<string, Record<string, CliSummary>>
  >(() => ({}));
  const onMaintenanceClisReader = useCallback(
    (read: () => Record<string, Record<string, CliSummary>>) => {
      maintenanceClis.current = read;
    },
    [],
  );
  const readMaintenanceClis = useCallback(() => maintenanceClis.current(), []);
  return (
    <MaintenanceClisContext.Provider value={readMaintenanceClis}>
      <AppContent onMaintenanceClisReader={onMaintenanceClisReader} />
    </MaintenanceClisContext.Provider>
  );
}

function AppContent({
  onMaintenanceClisReader,
}: {
  onMaintenanceClisReader: (
    read: () => Record<string, Record<string, CliSummary>>,
  ) => void;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const uninstallFlows = useUninstallFlows();
  const [uninstallDetail, setUninstallDetail] = useState<UninstallFlow>();
  const notifiedUninstalls = useRef(new Map<string, string>());
  const [setupOpen, setSetupOpen] = useState(false);
  const [addHostChoiceOpen, setAddHostChoiceOpen] = useState(false);
  const [setupStarted, setSetupStarted] = useState(false);
  const openSetup = () => {
    setAddHostChoiceOpen(false);
    setSetupStarted(true);
    setSetupOpen(true);
  };
  const [invitationEntry, setInvitationEntry] = useState(false);
  const [input, setInput] = useState("");
  const [invite, setInvite] = useState<Invite>();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [discardAddHost, setDiscardAddHost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inputError, setInputError] = useState<string>();
  useEffect(startHostMaintenance, []);
  useEffect(startUninstallFlows, []);
  const clientUpdate = useClientUpdate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialDetail, setSettingsInitialDetail] = useState(false);
  const [settingsRepository, setSettingsRepository] = useState<string>();
  const [terminalToOpen, setTerminalToOpen] = useState<{
    hostKey: string;
    terminalId: string;
    nonce: number;
  }>();
  const [clisRevision, setClisRevision] = useState(0);
  const [defaultShellChange, setDefaultShellChange] = useState<{
    hostKey: string;
    revision: number;
  }>();
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("general");
  const [preferences, setPreferences] =
    useState<Preferences>(defaultPreferences);
  const savedPreferences = useRef(preferences);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const preferencesReady = useRef(false);
  const preferencesDirty = useRef(false);
  const pendingPreferences = useRef<Preferences | undefined>(undefined);
  const preferencesQueue = useRef<Promise<void>>(Promise.resolve());
  const [preferencesError, setPreferencesError] = useState<"load" | "save">();
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  useEffect(() => {
    if (preferencesLoaded)
      return startUpdateChecks(preferences.receiveDevelopmentVersions ?? false);
  }, [preferencesLoaded, preferences.receiveDevelopmentVersions]);
  const accessoryLayout = useMemo(
    () => normalizeTerminalAccessoryLayout(preferences.keyboard),
    [preferences.keyboard],
  );
  const terminalInput = preferences.terminalInput ?? {
    desktopWidth: false,
  };
  const [now, setNow] = useState(Date.now());
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const workspaceBackRef = useRef<() => boolean>(() => false);
  const nestedBackRef = useRef<(() => void) | undefined>(undefined);
  const settingsCloseRef = useRef<(() => void) | undefined>(undefined);
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  const inviteRef = useRef(invite);
  inviteRef.current = invite;
  const addingRef = useRef(adding);
  addingRef.current = adding;
  const stateRef = useRef(state);
  stateRef.current = state;
  const backHandlerRef = useRef<() => boolean>(() => false);
  const clearAddHost = () => {
    setAdding(false);
    setDiscardAddHost(false);
    setInvite(undefined);
    setInput("");
    setName("");
    setInputError(undefined);
    connection.clearError();
  };
  const requestCloseAddHost = () => {
    if (busy) return;
    if (input.trim() || invite) {
      setDiscardAddHost(true);
      return;
    }
    clearAddHost();
  };
  const languagePreference = preferences.language;
  const language =
    languagePreference === "system"
      ? (state.initial?.language ?? navigator.language)
      : languagePreference;
  const t = useMemo(() => translator(language), [language]);
  const notifyUninstall = (flow: UninstallFlow) => {
    const signature = JSON.stringify([flow.operationId, flow.phase]);
    if (notifiedUninstalls.current.get(flow.hostKey) === signature) return;
    notifiedUninstalls.current.set(flow.hostKey, signature);
    showUninstallNotice(flow, t, (result) => {
      const live = uninstallFlow.getSnapshot()[result.hostKey];
      if (live) void uninstallFlow.open(result.hostKey);
      else setUninstallDetail(result);
    });
  };
  const uninstallActions: UninstallActions = {
    ...uninstallFlow,
    close: (key) => {
      const flow = uninstallFlow.getSnapshot()[key] ?? uninstallDetail;
      if (flow && ["done", "failed", "sshLost"].includes(flow.phase.type)) {
        if (flow.phase.type === "done") setSettingsOpen(false);
        uninstallFlow.dismiss(key);
      } else uninstallFlow.close(key);
      setUninstallDetail(undefined);
    },
    retry: async (key) => {
      setUninstallDetail(undefined);
      if (uninstallFlow.getSnapshot()[key]) await uninstallFlow.retry(key);
      else await uninstallFlow.open(key);
    },
  };
  useEffect(() => {
    for (const flow of uninstallFlows) {
      const phase = flow.phase;
      if (!["done", "failed", "sshLost"].includes(phase.type))
        notifiedUninstalls.current.delete(flow.hostKey);
      const normal =
        phase.type === "done" &&
        !["tokensRemaining", "filesRemaining"].includes(phase.outcome.type);
      if (
        normal ||
        (flow.closed && ["done", "failed", "sshLost"].includes(phase.type))
      ) {
        notifyUninstall(flow);
        if (phase.type === "done") setSettingsOpen(false);
        if (normal) uninstallFlow.close(flow.hostKey);
      }
    }
  }, [uninstallFlows, t]);
  const detailFlow = uninstallDetail
    ? (uninstallFlows.find(
        (flow) => flow.hostKey === uninstallDetail.hostKey,
      ) ?? uninstallDetail)
    : undefined;
  const standaloneUninstalls = uninstallFlows.filter(
    (flow) =>
      !flow.closed &&
      !(
        settingsOpen &&
        settingsSection === "version" &&
        state.host?.publicKey === flow.hostKey
      ),
  );
  if (
    detailFlow &&
    !standaloneUninstalls.some((flow) => flow.hostKey === detailFlow.hostKey)
  )
    standaloneUninstalls.push(detailFlow);
  const resolvedTheme =
    preferences.theme === "system"
      ? systemDark
        ? "dark"
        : "light"
      : preferences.theme;

  const savePreferences = useCallback((value: Preferences) => {
    pendingPreferences.current = value;
    if (!preferencesReady.current) return;
    preferencesQueue.current = preferencesQueue.current
      .catch(() => undefined)
      .then(async () => {
        const snapshot = pendingPreferences.current;
        if (!snapshot) return;
        await native.saveClientPreferences(snapshot);
        savedPreferences.current = snapshot;
        if (pendingPreferences.current === snapshot)
          pendingPreferences.current = undefined;
        setPreferencesError(undefined);
      })
      .catch(() => {
        pendingPreferences.current = undefined;
        preferencesRef.current = savedPreferences.current;
        setPreferences(savedPreferences.current);
        setPreferencesError("save");
      });
  }, []);

  const changePreferences = useCallback(
    (change: Partial<Preferences>) => {
      preferencesDirty.current = true;
      const next = { ...preferencesRef.current, ...change };
      preferencesRef.current = next;
      setPreferences(next);
      savePreferences(next);
    },
    [savePreferences],
  );

  // Removing the last Host also unmounts the sidebar, so discard its keys here.
  useEffect(() => {
    if (
      !preferencesLoaded ||
      !state.initial ||
      !preferences.sidebarCollapsed?.length
    )
      return;
    const hosts = state.initial.hosts;
    const sidebarCollapsed = preferences.sidebarCollapsed.filter((id) =>
      hosts.some(
        ({ publicKey }) =>
          id === `host:${publicKey}` ||
          id.startsWith(`repo:${publicKey}:`) ||
          id.startsWith(`worktree:${publicKey}:`),
      ),
    );
    if (sidebarCollapsed.length !== preferences.sidebarCollapsed.length)
      changePreferences({ sidebarCollapsed });
  }, [
    preferencesLoaded,
    state.initial,
    preferences.sidebarCollapsed,
    changePreferences,
  ]);

  const changeTerminalFontSize = useCallback(
    (size: number, save: boolean) => {
      const next = { ...preferencesRef.current, terminalFontSize: size };
      preferencesRef.current = next;
      setPreferences(next);
      if (save) {
        preferencesDirty.current = true;
        savePreferences(next);
      }
    },
    [savePreferences],
  );

  const loadPreferences = useCallback(async () => {
    try {
      const stored = await native.loadClientPreferences<unknown>();
      if (stored) savedPreferences.current = readPreferences(stored);
      if (!preferencesDirty.current && stored) {
        const next = readPreferences(stored);
        preferencesRef.current = next;
        setPreferences(next);
      }
      preferencesReady.current = true;
      setPreferencesError(undefined);
      if (preferencesDirty.current) savePreferences(preferencesRef.current);
    } catch {
      setPreferencesError("load");
    } finally {
      // Terminals start with the defaults when the settings cannot be read.
      setPreferencesLoaded(true);
    }
  }, [savePreferences]);

  useEffect(() => {
    void connection.initialize();
    const visible = () =>
      connection.setForeground(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", visible);
    const focused = () => connection.setForeground(true);
    window.addEventListener("focus", focused);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", focused);
    };
  }, []);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  const systemLanguage = state.initial?.language ?? navigator.language;
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    document.documentElement.lang = (preferences.language === "system"
      ? systemLanguage
      : preferences.language
    )
      .toLowerCase()
      .startsWith("ja")
      ? "ja"
      : "en";
    document.documentElement.style.fontSize = `${preferences.fontSize}px`;
  }, [
    resolvedTheme,
    preferences.language,
    preferences.fontSize,
    systemLanguage,
  ]);

  useEffect(() => {
    if (!state.disconnectedAt || state.connected || state.revoked) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state.disconnectedAt, state.connected, state.revoked]);

  const disconnectedSeconds = state.disconnectedAt
    ? Math.max(0, (now - state.disconnectedAt) / 1000)
    : 0;
  const disconnectedMinutes = Math.floor(disconnectedSeconds / 60);
  const staleNote =
    !state.connected && !state.revoked && disconnectedSeconds >= 60
      ? language.toLowerCase().startsWith("ja")
        ? `表示は${disconnectedMinutes}分前の内容です`
        : `Showing content from ${disconnectedMinutes} ${disconnectedMinutes === 1 ? "minute" : "minutes"} ago`
      : undefined;

  const setWorkspaceBack = useCallback((handler: () => boolean) => {
    workspaceBackRef.current = handler;
  }, []);
  const setNestedBack = useCallback((close?: () => void) => {
    nestedBackRef.current = close;
  }, []);
  const setSettingsClose = useCallback((close?: () => void) => {
    settingsCloseRef.current = close;
  }, []);
  backHandlerRef.current = () => {
    if (nestedBackRef.current) {
      nestedBackRef.current();
      return true;
    }
    if (discardAddHost) {
      setDiscardAddHost(false);
      return true;
    }
    if (settingsOpenRef.current) {
      settingsCloseRef.current?.();
      return true;
    }
    if (addingRef.current && stateRef.current.host) {
      requestCloseAddHost();
      return true;
    }
    if (inviteRef.current) {
      setInvite(undefined);
      connection.clearError();
      return true;
    }
    return workspaceBackRef.current();
  };
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    void native
      .onBack(() => backHandlerRef.current())
      .then((stop) => {
        if (active) dispose = stop;
        else stop();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      dispose?.();
    };
  }, []);

  const parse = (value: string) => {
    try {
      setInvite(inviteFromText(value));
      setName(state.initial?.deviceName ?? "");
      setInputError(undefined);
      connection.clearError();
    } catch {
      setInputError(t("Check the invitation and paste it again."));
    }
  };

  const retryPreferences = () => {
    if (preferencesError === "save") {
      savePreferences(pendingPreferences.current ?? preferencesRef.current);
      return;
    }
    void loadPreferences();
  };

  const [notificationDialog, setNotificationDialog] = useState(false);
  const [notificationError, setNotificationError] = useState(false);
  const requestNotificationPermission = async () => {
    try {
      const permission = await native.notificationPermission();
      if (permission === "granted") return;
      if (state.initial?.mobile) setNotificationDialog(true);
      else await native.requestNotificationPermission();
    } catch {
      setNotificationError(true);
    }
  };
  useEffect(() => {
    if (
      preferencesLoaded &&
      state.initial?.mobile &&
      state.connected &&
      !settingsOpen &&
      !adding &&
      !preferences.notificationPrompted &&
      (preferences.notifyWaiting || preferences.notifyDone)
    )
      void native
        .notificationPermission()
        .then((permission) => {
          if (permission === "granted")
            changePreferences({ notificationPrompted: true });
          else setNotificationDialog(true);
        })
        .catch(() => setNotificationError(true));
  }, [
    preferencesLoaded,
    state.initial?.mobile,
    state.connected,
    settingsOpen,
    adding,
    preferences.notificationPrompted,
    preferences.notifyWaiting,
    preferences.notifyDone,
  ]);
  useEffect(() => {
    if (!preferencesLoaded || !state.initial) return;
    if (!state.initial.mobile) {
      connection.setBackgroundConnection(true);
      return;
    }
    let active = true;
    void native
      .notificationPermission()
      .then((permission) => {
        if (!active) return;
        const enabled =
          preferences.backgroundConnection && permission === "granted";
        connection.setBackgroundConnection(enabled);
        return native.backgroundConnection(
          enabled,
          t("Connected in the background"),
          t("iori receives notifications from connected Hosts."),
        );
      })
      .catch(() => {
        if (active) setNotificationError(true);
      });
    return () => {
      active = false;
    };
  }, [
    preferencesLoaded,
    preferences.backgroundConnection,
    state.initial?.mobile,
    t,
  ]);
  useEffect(() => {
    if (preferencesLoaded)
      void native.clientOptions(preferences.closeToExit, t("Open"), t("Exit"));
  }, [preferencesLoaded, preferences.closeToExit, t]);
  const allowNotifications = async (background: boolean) => {
    try {
      const permission = await native.requestNotificationPermission();
      changePreferences({
        notificationPrompted: true,
        backgroundConnection: permission === "granted" && background,
      });
      setNotificationDialog(false);
      setNotificationError(false);
    } catch {
      setNotificationError(true);
    }
  };

  const onSettings = (requested?: SettingsSection) => {
    const section =
      requested ??
      (clientUpdate.available
        ? "general"
        : Object.values(state.observedHosts).some(hostNeedsUpdate)
          ? "version"
          : "general");
    setSettingsInitialDetail(requested !== undefined);
    setSettingsSection(section);
    setSettingsOpen(true);
  };
  const saveLastWorkspaceTarget = useCallback(
    (lastWorkspaceTarget: LastWorkspaceTarget) => {
      changePreferences({ lastWorkspaceTarget });
    },
    [changePreferences],
  );
  const firstRun = !state.host || (state.revoked && adding);
  const canSetupHost = state.initial?.canSetupHost === true;

  return (
    <div className={`app-root${hasWindowChrome ? " has-window-chrome" : ""}`}>
      <WindowChrome t={t} />
      <NoticeStack t={t} />
      {standaloneUninstalls.map((flow) => (
        <HostUninstallDialog
          key={flow.hostKey}
          flow={flow}
          actions={uninstallActions}
          connected={state.connectedHosts.includes(flow.hostKey)}
          t={t}
          onClose={() => setUninstallDetail(undefined)}
          onOpenTerminal={(hostKey, terminalId) => {
            setSettingsOpen(false);
            setTerminalToOpen({ hostKey, terminalId, nonce: Date.now() });
          }}
        />
      ))}
      {!state.initial ? (
        <main className="onboarding-screen" data-iori-view="initializing">
          <section className="onboarding-panel">
            <span className="app-wordmark">iori</span>
            <ErrorMessage message={state.error ? t(state.error) : undefined} />
            {state.error && (
              <Button
                onClick={() => void connection.initialize()}
                data-iori-action="retry-initial"
              >
                {t("Retry")}
              </Button>
            )}
          </section>
        </main>
      ) : firstRun ? (
        <main className="onboarding-screen">
          <section
            className="onboarding-panel"
            data-iori-view={invite ? "confirm-registration" : "first-run"}
          >
            <span className="app-wordmark">iori</span>
            <h1>{t(invite ? "Confirm registration" : "Connect to a Host")}</h1>
            {canSetupHost && !invitationEntry && !invite ? (
              <HostSetupChoices
                t={t}
                onLocal={openSetup}
                onInvitation={() => setInvitationEntry(true)}
              />
            ) : !invite ? (
              <>
                <p className="onboarding-guidance">
                  {t(
                    "Use an invitation from iori-host invite on the Host or Devices → Invite a new device on a registered device.",
                  )}
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    parse(input);
                  }}
                >
                  <label className="connection-field">
                    <span>{t("Invitation")}</span>
                    <Textarea
                      data-iori-field="invitation"
                      required
                      rows={4}
                      autoCapitalize="none"
                      spellCheck={false}
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                    />
                  </label>
                  <ErrorMessage message={inputError} />
                  <ErrorMessage
                    message={state.error ? t(state.error) : undefined}
                  />
                  <div className="connection-actions">
                    {state.initial.canScanQr && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        data-iori-action="scan-qr"
                        onClick={() => {
                          setBusy(true);
                          void native
                            .scan()
                            .then((value) => {
                              setInput(value);
                              parse(value);
                            })
                            .catch(() =>
                              setInputError(
                                t(
                                  "Could not read the QR code. Paste the invitation instead.",
                                ),
                              ),
                            )
                            .finally(() => setBusy(false));
                        }}
                      >
                        {t("Scan QR code")}
                      </Button>
                    )}
                    {canSetupHost && (
                      <Button
                        type="button"
                        variant="outline"
                        data-iori-action="back"
                        disabled={busy}
                        onClick={() => {
                          setInvitationEntry(false);
                          connection.clearError();
                        }}
                      >
                        {t("Back")}
                      </Button>
                    )}
                    <Button
                      className={state.initial.canScanQr ? "" : ""}
                      data-iori-action="continue"
                    >
                      {t("Continue")}
                    </Button>
                    {adding && state.host && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setAdding(false);
                          setInvite(undefined);
                          connection.clearError();
                        }}
                      >
                        {t("Cancel")}
                      </Button>
                    )}
                  </div>
                </form>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setBusy(true);
                  void connection
                    .pair(invite, name)
                    .then((ok) => {
                      if (ok) {
                        setAdding(false);
                        setInvite(undefined);
                        setInput("");
                        setSettingsOpen(false);
                      }
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <dl className="host-confirmation">
                  <div>
                    <dt>{t("Host")}</dt>
                    <dd data-iori-value="host-name">{invite.hostName}</dd>
                  </div>
                  <div>
                    <dt>{t("Address")}</dt>
                    <dd>
                      {invite.addresses.map((address) => (
                        <span className="address-line" key={address}>
                          {address}
                        </span>
                      ))}
                    </dd>
                  </div>
                </dl>
                <label className="connection-field">
                  <span>{t("This device’s name")}</span>
                  <Input
                    data-iori-field="device-name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <ErrorMessage
                  message={state.error ? t(state.error) : undefined}
                />
                <div className="connection-actions">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    data-iori-action="back"
                    onClick={() => {
                      setInvite(undefined);
                      connection.clearError();
                    }}
                  >
                    {t("Back")}
                  </Button>
                  {adding && state.host && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setAdding(false);
                        setInvite(undefined);
                        connection.clearError();
                      }}
                    >
                      {t("Cancel")}
                    </Button>
                  )}
                  <Button pending={busy} data-iori-action="register">
                    {t("Register")}
                  </Button>
                </div>
              </form>
            )}
          </section>
        </main>
      ) : state.revoked ? (
        <main className="onboarding-screen" data-iori-view="revoked">
          <section className="onboarding-panel">
            <span className="app-wordmark">iori</span>
            <h1>{t("This device’s registration was revoked.")}</h1>
            <p className="onboarding-guidance">
              {t("Get a new invitation and register again.")}
            </p>
            <Button
              data-iori-action="register-again"
              onClick={() => {
                setAdding(true);
                setInvite(undefined);
              }}
            >
              {t("Register again")}
            </Button>
          </section>
        </main>
      ) : (
        <WorkspaceFrame
          onMaintenanceClisReader={onMaintenanceClisReader}
          onOpenIntegrations={(hostKey) => {
            void connection.selectHost(hostKey);
            onSettings("integrations");
          }}
          onOpenWorkspaceSettings={(hostKey, workspacePath) => {
            void connection.selectHost(hostKey);
            setSettingsRepository(workspacePath);
            onSettings("git");
          }}
          terminalToOpen={terminalToOpen}
          state={state}
          t={t}
          showConnection={!adding}
          disconnectedSeconds={disconnectedSeconds}
          staleNote={staleNote}
          onSettings={(hostKey, repositoryPath) => {
            if (hostKey && repositoryPath) {
              void connection.selectHost(hostKey);
              setSettingsRepository(repositoryPath);
              onSettings("git");
            } else if (hostKey) {
              void connection.selectHost(hostKey);
              onSettings(
                hostNeedsUpdate(state.observedHosts[hostKey])
                  ? "version"
                  : "connection",
              );
            } else onSettings();
          }}
          language={language}
          onClisChanged={() => setClisRevision((value) => value + 1)}
          clisRevision={clisRevision}
          onBackHandler={setWorkspaceBack}
          renderPanel={(props) => (
            <ReadingPanel
              {...props}
              locale={language}
              onOpenIntegrations={(hostKey) => {
                void connection.selectHost(hostKey);
                onSettings("integrations");
              }}
              onOpenWorkspaceSettings={(hostKey, workspacePath) => {
                void connection.selectHost(hostKey);
                setSettingsRepository(workspacePath);
                onSettings("git");
              }}
            />
          )}
          notificationPreferences={preferencesLoaded ? preferences : undefined}
          showForgeStatus={preferences.showForgeStatus !== false}
          doubleClickMaximize={preferences.doubleClickMaximize}
          panelWidths={preferences.panelWidths}
          panelFullWidth={preferences.panelFullWidth}
          onPanelWidthsChange={(panelWidths) =>
            changePreferences({ panelWidths })
          }
          onPanelFullWidthChange={(panelFullWidth) =>
            changePreferences({ panelFullWidth })
          }
          hostOrder={preferences.hostOrder}
          onReorderHosts={(hostOrder) => changePreferences({ hostOrder })}
          sidebarWidth={preferences.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH}
          onSidebarWidthChange={(sidebarWidth) =>
            changePreferences({ sidebarWidth })
          }
          sidebarCollapsed={preferences.sidebarCollapsed}
          onSidebarCollapsedChange={(sidebarCollapsed) =>
            changePreferences({ sidebarCollapsed })
          }
          lastWorkspaceTarget={preferences.lastWorkspaceTarget}
          onLastWorkspaceTargetChange={saveLastWorkspaceTarget}
          terminalFontSize={preferences.terminalFontSize}
          onTerminalFontSize={changeTerminalFontSize}
          terminalRightClick={preferences.terminalRightClick}
          terminalLinkOpen={preferences.terminalLinkOpen}
          accessoryLayout={accessoryLayout}
          defaultShellChange={defaultShellChange}
          inputPreferences={preferencesLoaded ? terminalInput : undefined}
          onInputPreferences={(update) => {
            const current = preferencesRef.current.terminalInput ?? {
              desktopWidth: false,
            };
            const next = update(current);
            if (next !== current) changePreferences({ terminalInput: next });
          }}
        />
      )}
      {state.host && adding && !state.revoked && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) requestCloseAddHost();
          }}
        >
          <DialogContent
            className="add-host-dialog"
            data-iori-view={invite ? "confirm-registration" : "first-run"}
            showCloseButton={false}
          >
            <DialogHeader>
              <DialogTitle>
                {t(invite ? "Confirm registration" : "Connect to a Host")}
              </DialogTitle>
              <DialogDescription>
                {t(
                  "Use an invitation from iori-host invite on the Host or Devices → Invite a new device on a registered device.",
                )}
              </DialogDescription>
            </DialogHeader>
            {!invite ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  parse(input);
                }}
              >
                <label className="connection-field">
                  <span>{t("Invitation")}</span>
                  <Textarea
                    data-iori-field="invitation"
                    required
                    rows={4}
                    autoCapitalize="none"
                    spellCheck={false}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                  />
                </label>
                <ErrorMessage message={inputError} />
                <ErrorMessage
                  message={state.error ? t(state.error) : undefined}
                />
                <div className="connection-actions">
                  {state.initial?.canScanQr && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      data-iori-action="scan-qr"
                      onClick={() => {
                        setBusy(true);
                        void native
                          .scan()
                          .then((value) => {
                            setInput(value);
                            parse(value);
                          })
                          .catch(() =>
                            setInputError(
                              t(
                                "Could not read the QR code. Paste the invitation instead.",
                              ),
                            ),
                          )
                          .finally(() => setBusy(false));
                      }}
                    >
                      {t("Scan QR code")}
                    </Button>
                  )}
                  {canSetupHost && (
                    <Button
                      type="button"
                      variant="outline"
                      data-iori-action="back"
                      disabled={busy}
                      onClick={() => {
                        setAdding(false);
                        setAddHostChoiceOpen(true);
                        connection.clearError();
                      }}
                    >
                      {t("Back")}
                    </Button>
                  )}
                  <Button disabled={busy} data-iori-action="continue">
                    {t("Continue")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    data-iori-action="cancel-add-host"
                    onClick={requestCloseAddHost}
                  >
                    {t("Cancel")}
                  </Button>
                </div>
              </form>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setBusy(true);
                  void connection
                    .pair(invite, name)
                    .then((ok) => {
                      if (ok) clearAddHost();
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <dl className="host-confirmation">
                  <div>
                    <dt>{t("Host")}</dt>
                    <dd data-iori-value="host-name">{invite.hostName}</dd>
                  </div>
                  <div>
                    <dt>{t("Address")}</dt>
                    <dd>
                      {invite.addresses.map((address) => (
                        <span className="address-line" key={address}>
                          {address}
                        </span>
                      ))}
                    </dd>
                  </div>
                </dl>
                <label className="connection-field">
                  <span>{t("This device’s name")}</span>
                  <Input
                    data-iori-field="device-name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <ErrorMessage
                  message={state.error ? t(state.error) : undefined}
                />
                <div className="connection-actions">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    data-iori-action="back"
                    onClick={() => {
                      setInvite(undefined);
                      connection.clearError();
                    }}
                  >
                    {t("Back")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    data-iori-action="cancel-add-host"
                    onClick={requestCloseAddHost}
                  >
                    {t("Cancel")}
                  </Button>
                  <Button pending={busy} data-iori-action="register">
                    {t("Register")}
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={discardAddHost} onOpenChange={setDiscardAddHost}>
        <DialogContent
          className="discard-add-host-dialog"
          data-iori-view="discard-add-host-confirmation"
        >
          <DialogHeader>
            <DialogTitle>{t("Discard invitation input?")}</DialogTitle>
            <DialogDescription>
              {t("Your invitation input will be cleared.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              autoFocus
              data-iori-action="keep-add-host"
              onClick={() => setDiscardAddHost(false)}
            >
              {t("Keep editing")}
            </Button>
            <Button
              variant="destructive"
              data-iori-action="discard-add-host"
              onClick={clearAddHost}
            >
              {t("Discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {(!state.host || state.revoked) && (
        <Button
          className="app-settings-trigger"
          variant="ghost"
          size="icon"
          data-iori-action="settings-open"
          aria-label={t("Settings")}
          title={t("Settings")}
          onClick={() => onSettings()}
        >
          <SettingsIcon aria-hidden="true" />
          <UpdateMark
            t={t}
            available={
              Boolean(clientUpdate.available) ||
              Object.values(state.observedHosts).some(hostNeedsUpdate)
            }
          />
        </Button>
      )}
      <Dialog
        open={notificationDialog}
        onOpenChange={(open) => {
          if (!open) changePreferences({ notificationPrompted: true });
          setNotificationDialog(open);
        }}
      >
        <DialogContent data-iori-view="notification-permission">
          <DialogHeader>
            <DialogTitle>{t("Receive notifications")}</DialogTitle>
            <DialogDescription>
              {t(
                "To receive notifications while the app is in the background, keep the connection active. This shows one persistent notification and uses battery.",
              )}
            </DialogDescription>
          </DialogHeader>
          {/* The main action comes last: right on a PC, first on a phone. */}
          <DialogFooter>
            <Button
              variant="outline"
              data-iori-action="notifications-allow-foreground"
              onClick={() => void allowNotifications(false)}
            >
              {t("Allow only while using the app")}
            </Button>
            <Button
              data-iori-action="notifications-allow-background"
              onClick={() => void allowNotifications(true)}
            >
              {t("Allow and keep connected")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={addHostChoiceOpen} onOpenChange={setAddHostChoiceOpen}>
        <DialogContent
          className="add-host-dialog"
          data-iori-view="host-choices"
        >
          <DialogHeader>
            <DialogTitle>{t("Add iori Host")}</DialogTitle>
            <DialogDescription>
              {t("Choose how to add iori Host.")}
            </DialogDescription>
          </DialogHeader>
          <HostSetupChoices
            t={t}
            onLocal={openSetup}
            onInvitation={() => {
              setAddHostChoiceOpen(false);
              setAdding(true);
              setInvitationEntry(true);
            }}
          />
        </DialogContent>
      </Dialog>
      {setupStarted && state.initial && (
        <HostSetupDialog
          open={setupOpen}
          deviceName={state.initial.deviceName}
          t={t}
          onClose={() => setSetupOpen(false)}
          onCompleted={() => {
            setSetupOpen(false);
            setSetupStarted(false);
          }}
          onInvitation={() => {
            setSetupOpen(false);
            setSetupStarted(false);
            setSettingsOpen(false);
            setAdding(true);
            setInvitationEntry(true);
          }}
          onOpenWindowsSettings={
            navigator.userAgent.includes("Windows")
              ? () => void native.openWindowsOptionalFeatures()
              : undefined
          }
        />
      )}
      <ConnectedHostUpdates
        t={t}
        onOpenTerminal={(hostKey, terminalId) => {
          setSettingsOpen(false);
          setTerminalToOpen({ hostKey, terminalId, nonce: Date.now() });
        }}
      />
      <SettingsDialog
        uninstallActions={uninstallActions}
        onUninstallClose={() => setUninstallDetail(undefined)}
        repositoryPath={settingsRepository}
        onRepositoryChange={setSettingsRepository}
        onOpenTerminal={(hostKey, terminalId) => {
          setSettingsOpen(false);
          setTerminalToOpen({ hostKey, terminalId, nonce: Date.now() });
        }}
        state={state}
        open={settingsOpen}
        section={settingsSection}
        initialDetail={settingsInitialDetail}
        onOpenChange={setSettingsOpen}
        onCloseHandler={setSettingsClose}
        notificationError={notificationError}
        onNotificationPermission={() => {
          setNotificationError(false);
          void requestNotificationPermission();
        }}
        onSectionChange={setSettingsSection}
        preferences={preferences}
        preferencesError={preferencesError}
        onPreferencesChange={changePreferences}
        accessoryLayout={accessoryLayout}
        onDefaultShellChange={(hostKey) =>
          setDefaultShellChange((current) => ({
            hostKey,
            revision: (current?.revision ?? 0) + 1,
          }))
        }
        onRetryPreferences={retryPreferences}
        language={language}
        t={t}
        disconnectedSeconds={disconnectedSeconds}
        onNestedBack={setNestedBack}
        onRegisterNewHost={() => {
          setSettingsOpen(false);
          if (canSetupHost) {
            setAddHostChoiceOpen(true);
            setInvite(undefined);
            setInput("");
            setInputError(undefined);
            connection.clearError();
            return;
          }
          setAdding(true);
          setInvite(undefined);
          setInput("");
          setInputError(undefined);
          connection.clearError();
        }}
      />
      {state.storageError && !setupOpen && (
        <div className="storage-retry" role="alert">
          <span>{t("Could not save the registration. Retry saving.")}</span>
          <Button
            variant="outline"
            size="sm"
            data-iori-action="retry-save"
            onClick={() => void connection.retrySave()}
          >
            {t("Retry saving")}
          </Button>
        </div>
      )}
    </div>
  );
}
