import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowLeft, FolderGit2, X } from "lucide-react";
import type { FolderHistoryItem } from "@iori/protocol";
import { cn } from "cn";
import { connection } from "./connection.ts";
import { basename } from "./workspace-panel.tsx";
import { useIsMobile } from "./hooks/use-mobile.ts";
import { AsyncState } from "./components/AsyncState.tsx";
import { Connecting } from "./components/flow/Notice.tsx";
import { PageBody, PageHeader } from "./components/page-layout.tsx";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.tsx";
import type { SettingsEditor } from "./settings-save.ts";
import { RepositoryGitSettings } from "./GitSettings.tsx";
import { IntegrationsSettings } from "./IntegrationsSettings.tsx";
import { KeyboardSettings } from "./KeyboardSettings.tsx";
import type { TerminalAccessoryLayout } from "./terminal/terminal-accessory-layout.ts";
import type { UnifiedPushSettingsState } from "./unified-push.ts";
import type { UninstallActions } from "./updates/HostUninstallDialog.tsx";
import { HostVersionSettings } from "./updates/HostVersionSettings.tsx";
import { useUninstallFlow } from "./updates/uninstall-flow.ts";
import { ConnectionSettings } from "./settings/ConnectionSettings.tsx";
import { DevicesSettings } from "./settings/DevicesSettings.tsx";
import { DisplaySettings } from "./settings/DisplaySettings.tsx";
import { GeneralSettings } from "./settings/GeneralSettings.tsx";
import { NotificationsSettings } from "./settings/NotificationsSettings.tsx";
import { SettingsNav, hostSections } from "./settings/SettingsNav.tsx";
import {
  DEFAULT_SIDEBAR_WIDTH,
  ErrorMessage,
  InstantSavedStatus,
  SettingsDirtyContext,
  type Preferences,
  type SettingsSection,
} from "./settings/shared.tsx";

export { DEFAULT_SIDEBAR_WIDTH, ErrorMessage };
export type { Preferences, SettingsSection };

export function SettingsDialog({
  uninstallActions,
  onUninstallClose,
  onOpenTerminal,
  repositoryPath,
  onRepositoryChange,
  state,
  open,
  section,
  initialDetail = false,
  onOpenChange,
  onCloseHandler,
  onSectionChange: changeSection,
  preferences,
  preferencesError,
  onPreferencesChange: changePreferences,
  onRetryPreferences,
  language,
  t,
  onRegisterNewHost,
  onNestedBack,
  disconnectedSeconds,
  accessoryLayout,
  onDefaultShellChange,
  onNotificationPermission,
  notificationError,
  notificationPermissionGranted = false,
  unifiedPush,
}: {
  uninstallActions: UninstallActions;
  onUninstallClose: () => void;
  repositoryPath?: string;
  onRepositoryChange: (path: string) => void;
  state: ReturnType<typeof connection.getSnapshot>;
  onOpenTerminal: (hostKey: string, terminalId: string) => void;
  open: boolean;
  section: SettingsSection;
  initialDetail?: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseHandler: (close?: () => void) => void;
  onSectionChange: (section: SettingsSection) => void;
  preferences: Preferences;
  preferencesError?: "load" | "save";
  onPreferencesChange: (
    change: Partial<Preferences>,
  ) => Promise<boolean> | void;
  onRetryPreferences: () => void;
  language: string;
  t: (key: string) => string;
  onRegisterNewHost: () => void;
  onNestedBack: (close?: () => void) => void;
  disconnectedSeconds: number;
  accessoryLayout: TerminalAccessoryLayout;
  /** The Host's default shell changed; views listing its Terminals read again. */
  onDefaultShellChange: (hostKey: string) => void;
  onNotificationPermission: () => void;
  notificationError?: boolean;
  notificationPermissionGranted?: boolean;
  unifiedPush?: UnifiedPushSettingsState;
}) {
  const [preferenceField, setPreferenceField] = useState<string>();
  const [instantSaved, setInstantSaved] = useState(false);
  const instantSavedTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (instantSavedTimer.current !== null)
        window.clearTimeout(instantSavedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (preferencesError) setInstantSaved(false);
  }, [preferencesError]);

  const flashInstantSaved = useCallback(() => {
    setInstantSaved(true);
    if (instantSavedTimer.current !== null)
      window.clearTimeout(instantSavedTimer.current);
    instantSavedTimer.current = window.setTimeout(() => {
      setInstantSaved(false);
    }, 2500);
  }, []);

  const onPreferencesChange = (change: Partial<Preferences>) => {
    setPreferenceField(Object.keys(change)[0]);
    const result = changePreferences(change);
    if (result && typeof result.then === "function") {
      void result.then((ok) => {
        if (ok !== false) flashInstantSaved();
      });
    } else {
      flashInstantSaved();
    }
  };

  const preferenceError = (field: string) =>
    preferencesError === "save" && preferenceField === field ? (
      <ErrorMessage
        message={t("Could not save settings. Choose it again to retry.")}
      />
    ) : null;

  const editors = useRef(new Set<SettingsEditor>());
  const [dirtyEditors, setDirtyEditors] = useState<Set<string>>(
    () => new Set(),
  );
  const reportDirty = useCallback((editorId: string, dirty: boolean) => {
    setDirtyEditors((current) => {
      const has = current.has(editorId);
      if (has === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(editorId);
      else next.delete(editorId);
      return next;
    });
  }, []);
  const hasUnsavedChanges = dirtyEditors.size > 0;

  const [pendingLeave, setPendingLeave] = useState<() => void>();
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [forgettingHost, setForgettingHost] = useState<{
    publicKey: string;
    hostName: string;
  }>();

  const registerEditor = useCallback((editor: SettingsEditor) => {
    editors.current.add(editor);
    return () => {
      editors.current.delete(editor);
    };
  }, []);

  const leave = useCallback((action: () => void) => {
    if ([...editors.current].some((isDirty) => isDirty()))
      setPendingLeave(() => action);
    else action();
  }, []);

  const handleSaveAndLeave = async () => {
    if (!pendingLeave || leaveSaving) return;
    setLeaveSaving(true);
    try {
      const dirty = [...editors.current].filter((editor) => editor());
      for (const editor of dirty) {
        const ok = editor.save ? await editor.save() : true;
        if (!ok) {
          setPendingLeave(undefined);
          return;
        }
      }
      const next = pendingLeave;
      setPendingLeave(undefined);
      next();
    } finally {
      setLeaveSaving(false);
    }
  };

  const handleDiscardAndLeave = () => {
    const next = pendingLeave;
    for (const editor of editors.current) editor.discard?.();
    setPendingLeave(undefined);
    next?.();
  };

  useLayoutEffect(() => {
    onCloseHandler(() => {
      void leave(() => onOpenChange(false));
    });
    return () => onCloseHandler();
  }, [leave, onCloseHandler, onOpenChange]);

  const isMobile = useIsMobile();
  const [mobileDetail, setMobileDetail] = useState(initialDetail);
  const childBack = useRef<(() => void) | undefined>(undefined);
  const setChildBack = useCallback((back?: () => void) => {
    childBack.current = back;
  }, []);

  useEffect(() => {
    if (open) setMobileDetail(initialDetail);
  }, [open, initialDetail]);

  useEffect(() => {
    if (!open) return;
    onNestedBack(() => {
      if (pendingLeave) setPendingLeave(undefined);
      else if (forgettingHost) setForgettingHost(undefined);
      else if (childBack.current) childBack.current();
      else if (isMobile && mobileDetail) leave(() => setMobileDetail(false));
      else leave(() => onOpenChange(false));
    });
    return () => onNestedBack(undefined);
  }, [
    open,
    onNestedBack,
    pendingLeave,
    forgettingHost,
    isMobile,
    mobileDetail,
    leave,
    onOpenChange,
  ]);

  const host = state.host
    ? (state.observedHosts[state.host.publicKey] ?? state.host)
    : undefined;
  const uninstall = useUninstallFlow(host?.publicKey ?? "");

  const [repositories, setRepositories] = useState<{
    hostKey: string;
    items: FolderHistoryItem[];
  }>();
  const [repositoriesError, setRepositoriesError] = useState<string>();
  const repositoryReads = useRef(0);

  const loadRepositories = useCallback(async () => {
    const hostKey = host?.publicKey;
    if (!hostKey) return;
    const revision = ++repositoryReads.current;
    try {
      const response = await connection.requestHost(
        hostKey,
        "folders.history",
        {},
      );
      if (revision !== repositoryReads.current) return;
      if (!response?.ok) throw new Error();
      const unique = new Map(
        response.result.folders
          .filter((folder) => folder.inSidebar)
          .map((folder) => [folder.workspacePath, folder]),
      );
      setRepositories({
        hostKey,
        items: [...unique.values()].sort(
          (a, b) =>
            (a.sidebarPosition ?? Infinity) - (b.sidebarPosition ?? Infinity),
        ),
      });
      setRepositoriesError((previous) =>
        previous === hostKey ? undefined : previous,
      );
    } catch {
      if (revision === repositoryReads.current) setRepositoriesError(hostKey);
    }
  }, [host?.publicKey]);

  useEffect(() => {
    if (!open) return;
    void loadRepositories();
    const stop = connection.subscribeHostEvents((key, event) => {
      if (key === host?.publicKey && event.type === "folders.changed")
        void loadRepositories();
    });
    return () => {
      repositoryReads.current++;
      stop();
    };
  }, [open, host?.publicKey, loadRepositories]);

  const repositoryItems =
    repositories?.hostKey === host?.publicKey
      ? (repositories?.items ?? [])
      : [];
  const repository =
    repositoryItems.find((item) => item.workspacePath === repositoryPath) ??
    repositoryItems[0];

  const current =
    section === "keyboard" && !state.initial?.mobile
      ? "general"
      : host ||
          ["general", "notifications", "display", "keyboard"].includes(section)
        ? section
        : "general";

  const onSectionChange = (next: SettingsSection) => {
    const select = () => {
      setInstantSaved(false);
      changeSection(next);
      setMobileDetail(true);
    };
    if (next !== current) leave(select);
    else select();
  };

  const contentRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [current, host?.publicKey]);

  const title =
    current === "git"
      ? `${repository ? basename(repository.workspacePath) : t("Workspace")} › Git`
      : current === "general"
        ? t("General")
        : current === "notifications"
          ? t("Notifications")
          : current === "display"
            ? t("Display")
            : current === "keyboard"
              ? t("Keyboard")
              : `${host?.hostName} › ${t(hostSections.find((item) => item.id === current)?.title ?? "")}`;

  const mobileTitle = [
    "general",
    "notifications",
    "display",
    "keyboard",
  ].includes(current)
    ? `${t("This device")} › ${title}`
    : title;

  const isDeviceSection = [
    "display",
    "general",
    "notifications",
    "keyboard",
  ].includes(current);

  const repositoriesMode =
    host && repositoriesError === host.publicKey
      ? "error"
      : !host || repositories?.hostKey !== host.publicKey
        ? "loading"
        : !repository
          ? "empty"
          : "ready";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else void leave(() => onOpenChange(false));
      }}
    >
      <DialogContent
        className={cn(
          "dialog-full-screen flex flex-col gap-0 overflow-hidden p-0 outline-none",
          "h-[min(51.25rem,calc(100dvh-4rem))] max-h-none w-[min(60rem,calc(100vw-1.75rem))] max-w-[calc(100vw-1.75rem)] sm:max-w-[min(60rem,calc(100vw-1.75rem))]",
          "rounded-lg border border-border bg-popover shadow-lg",
          "max-md:bg-background",
        )}
        data-iori-view="settings"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("Settings")}</DialogTitle>
          <DialogDescription>{t("Client and Host settings")}</DialogDescription>
        </DialogHeader>

        {/* Top bar: desktop modal header + mobile location bar with back & close */}
        <div
          className={cn(
            "flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-border bg-popover px-4 py-2.5",
            "max-md:min-h-14 max-md:bg-background max-md:px-2 max-md:py-2",
            !mobileDetail && "max-md:pl-5",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {mobileDetail && (
              <Button
                variant="ghost"
                size="icon"
                className="hidden shrink-0 max-md:inline-flex max-md:size-11"
                aria-label={t("Settings")}
                title={t("Settings")}
                data-iori-action="settings-back"
                onClick={() => leave(() => setMobileDetail(false))}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Button>
            )}
            <span className="truncate font-heading text-sm font-semibold text-foreground max-md:hidden">
              {t("Settings")}
            </span>
            <span className="hidden min-w-0 flex-1 truncate font-heading text-sm font-medium text-foreground max-md:block">
              {mobileDetail ? mobileTitle : t("Settings")}
            </span>
            {hasUnsavedChanges && (
              <Badge variant="waiting" className="shrink-0">
                {t("Unsaved changes")}
              </Badge>
            )}
            {mobileDetail && isDeviceSection && (
              <span className="hidden max-md:inline-flex">
                <InstantSavedStatus visible={instantSaved} t={t} />
              </span>
            )}
          </div>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 max-md:size-11"
              aria-label={t("Close")}
              title={t("Close")}
              data-iori-action="settings-close"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>

        {/* 2-pane body split by 1px vertical hairline on desktop; list/detail switch on mobile */}
        <SettingsDirtyContext.Provider value={reportDirty}>
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <SettingsNav
              current={current}
              mobileDetail={mobileDetail}
              host={host}
              state={state}
              preferences={preferences}
              repository={repository}
              repositoryItems={repositoryItems}
              hasUnsavedChanges={hasUnsavedChanges}
              onSectionChange={onSectionChange}
              onRegisterNewHost={onRegisterNewHost}
              onRepositoryChange={onRepositoryChange}
              onLeave={leave}
              t={t}
            />
            <section
              ref={contentRef}
              className={cn(
                "min-w-0 flex-1 overflow-y-auto bg-background px-8 pt-6 pb-14 max-md:px-4 max-md:pt-5 max-md:pb-12",
                !mobileDetail && "max-md:hidden",
              )}
            >
              <PageBody>
                <PageHeader
                  title={current === "version" ? t("Version") : title}
                  className="max-md:hidden"
                  actions={
                    isDeviceSection ? (
                      <InstantSavedStatus visible={instantSaved} t={t} />
                    ) : undefined
                  }
                  description={
                    current === "version" && host ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="whitespace-nowrap">
                          {host.hostName}
                        </span>
                        {!state.connectedHosts.includes(host.publicKey) && (
                          <>
                            {" "}
                            · <Connecting t={t} />
                          </>
                        )}
                      </span>
                    ) : undefined
                  }
                />

                {current === "general" && (
                  <GeneralSettings
                    canCloseToExit={Boolean(state.initial?.canCloseToExit)}
                    preferences={preferences}
                    onPreferencesChange={onPreferencesChange}
                    preferenceError={preferenceError}
                    t={t}
                  />
                )}

                {current === "version" && host && (
                  <HostVersionSettings
                    key={host.publicKey}
                    host={host}
                    onOpenTerminal={onOpenTerminal}
                    t={t}
                    uninstall={{
                      flow: open ? uninstall : undefined,
                      actions: uninstallActions,
                      onClose: onUninstallClose,
                    }}
                    onClientUpdate={() => onSectionChange("general")}
                    onNestedBack={setChildBack}
                    disconnectedSeconds={disconnectedSeconds}
                  />
                )}

                {current === "notifications" && (
                  <NotificationsSettings
                    preferences={preferences}
                    mobile={Boolean(state.initial?.mobile)}
                    unifiedPush={unifiedPush}
                    notificationError={notificationError}
                    notificationPermissionGranted={
                      notificationPermissionGranted
                    }
                    onPreferencesChange={onPreferencesChange}
                    onClearPreferenceField={() => setPreferenceField(undefined)}
                    onNotificationPermission={onNotificationPermission}
                    preferenceError={preferenceError}
                    t={t}
                  />
                )}

                {current === "keyboard" && (
                  <KeyboardSettings
                    t={t}
                    layout={accessoryLayout}
                    onChange={(keyboard) => onPreferencesChange({ keyboard })}
                  />
                )}

                {current === "display" && (
                  <DisplaySettings
                    preferences={preferences}
                    isNativeMobile={Boolean(state.initial?.mobile)}
                    isNarrowViewport={isMobile}
                    onPreferencesChange={onPreferencesChange}
                    onTerminalFontSave={async (terminalFontFamily) => {
                      setPreferenceField("terminalFontFamily");
                      return changePreferences({ terminalFontFamily });
                    }}
                    preferenceError={preferenceError}
                    registerEditor={registerEditor}
                    t={t}
                  />
                )}

                {preferencesError &&
                  (preferencesError === "load" ||
                    current === "keyboard" ||
                    !preferenceField) &&
                  isDeviceSection && (
                    <div
                      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-4 py-3 text-xs text-status-failed-text"
                      role="alert"
                    >
                      <p className="m-0 text-foreground">
                        {t(
                          preferencesError === "load"
                            ? "Could not load settings. Retry."
                            : "Could not save settings. Retry saving.",
                        )}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onRetryPreferences}
                        data-iori-action="preferences-retry"
                      >
                        {t(
                          preferencesError === "load"
                            ? "Retry"
                            : "Retry saving",
                        )}
                      </Button>
                    </div>
                  )}

                {current === "connection" && host && (
                  <ConnectionSettings
                    host={host}
                    state={state}
                    disconnectedSeconds={disconnectedSeconds}
                    onDefaultShellChange={onDefaultShellChange}
                    registerEditor={registerEditor}
                    forgettingHost={forgettingHost}
                    setForgettingHost={setForgettingHost}
                    t={t}
                  />
                )}

                {current === "integrations" && host && (
                  <IntegrationsSettings
                    key={host.publicKey}
                    hostKey={host.publicKey}
                    t={t}
                    language={language}
                    registerEditor={registerEditor}
                    onNestedBack={setChildBack}
                  />
                )}

                {current === "git" && host && (
                  <div
                    data-iori-state={
                      repositoriesMode === "empty" ? "no-workspaces" : undefined
                    }
                  >
                    <AsyncState
                      mode={repositoriesMode}
                      t={t}
                      compact
                      emptyIcon={
                        <FolderGit2 className="size-4" aria-hidden="true" />
                      }
                      emptyTitle={t("No workspaces are open on this Host.")}
                      errorTitle={t("Could not load folders. Retry.")}
                      retryLabel={t("Retry")}
                      onRetry={() => void loadRepositories()}
                    >
                      {repository?.kind === "folder" && (
                        <p
                          className="m-0 border-t border-border py-4 text-sm text-muted-foreground"
                          data-iori-state="workspace-not-git"
                        >
                          {t(
                            "This workspace is not a Git repository, so there are no Git settings.",
                          )}
                        </p>
                      )}
                      {repository?.kind === "git" && (
                        <RepositoryGitSettings
                          key={`${host.publicKey}:${repository.workspacePath}`}
                          hostKey={host.publicKey}
                          path={repository.workspacePath}
                          registerEditor={registerEditor}
                          t={t}
                        />
                      )}
                    </AsyncState>
                  </div>
                )}

                {current === "devices" && host && (
                  <DevicesSettings
                    key={host.publicKey}
                    t={t}
                    language={language}
                    onNestedBack={setChildBack}
                  />
                )}
              </PageBody>
            </section>
          </div>
        </SettingsDirtyContext.Provider>

        <UnsavedChangesDialog
          open={Boolean(pendingLeave)}
          saving={leaveSaving}
          view="settings-discard-confirmation"
          t={t}
          onCancel={() => setPendingLeave(undefined)}
          onDiscard={handleDiscardAndLeave}
          onSave={() => void handleSaveAndLeave()}
        />
      </DialogContent>
    </Dialog>
  );
}
