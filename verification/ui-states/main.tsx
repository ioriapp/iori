import { ReadingPreview } from "./ReadingPreview.tsx";
import { UsageStatus } from "../../apps/client/src/usage/UsageStatus.tsx";
import { UsagePreferences } from "../../apps/client/src/usage/preferences.tsx";
import { AgentsPage } from "../../apps/client/src/teams/AgentsPage.tsx";
import { TeamContext } from "../../apps/client/src/teams/context.tsx";
import "../../apps/client/src/teams/team-editor.css";
import { Board } from "../../apps/client/src/teams/Board.tsx";
import { StatusDot } from "../../apps/client/src/components/StatusDot.tsx";
import {
  SettingsDialog as ProductSettings,
  type Preferences,
} from "../../apps/client/src/Settings.tsx";
import { ChildRows } from "../../apps/client/src/teams/ChildRows.tsx";
import { TerminalPane } from "../../apps/client/src/terminal/TerminalPane.tsx";
import { connection } from "../../apps/client/src/connection.ts";
import { getDefaultTerminalAccessoryLayout } from "../../apps/client/src/terminal/terminal-accessory-layout.ts";
import { IntegrationsSettings } from "../../apps/client/src/IntegrationsSettings.tsx";
import { ClientInitialization } from "../../apps/client/src/ClientInitialization.tsx";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bell,
  Blocks,
  Cable,
  GitFork,
  Keyboard,
  Monitor,
  Package,
  Plus,
  Settings,
  Terminal,
  X,
} from "lucide-react";
import { HostSetupDialog } from "../../apps/client/src/host-setup/HostSetupDialog.tsx";
import { HostVersionSettings } from "../../apps/client/src/updates/HostVersionSettings.tsx";
import {
  HostUninstallDialog,
  showUninstallNotice,
  type UninstallActions,
} from "../../apps/client/src/updates/HostUninstallDialog.tsx";
import { MaintenanceClisContext } from "../../apps/client/src/updates/HostMaintenanceDetails.tsx";
import { NoticeStack } from "../../apps/client/src/components/flow/Toast.tsx";
import { notices } from "../../apps/client/src/notices.ts";
import { translator } from "../../apps/client/src/i18n.ts";
import { Button } from "../../apps/client/src/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../apps/client/src/components/ui/dialog.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../apps/client/src/components/ui/select.tsx";
import {
  SidebarProvider,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "../../apps/client/src/components/ui/sidebar.tsx";
import { TooltipProvider } from "../../apps/client/src/components/ui/tooltip.tsx";
import {
  PageHeader,
  PageBody,
  SettingsSection,
  FieldRow,
} from "../../apps/client/src/components/page-layout.tsx";
import { Connecting } from "../../apps/client/src/components/flow/Notice.tsx";
import { allStates } from "virtual:ui-state-catalog";
import { current, stateId } from "./runtime.ts";
import { clis, deviceName, host, usageSnapshot } from "./fixtures.ts";
import "./preview.css";
import "../../apps/client/src/app.css";
import "../../apps/client/src/workspace.css";
import "../../apps/client/src/terminal/terminal.css";
import "../../apps/client/src/settings.css";
import "../../apps/client/src/worktree-creator.css";

const language = new URLSearchParams(location.search).get("language") ?? "ja";
const t = translator(language);
const noop = () => {};
const asyncNoop = async () => {};
const actions: UninstallActions = {
  open: asyncNoop,
  retryPlan: asyncNoop,
  start: asyncNoop,
  answerPrompt: noop,
  startWithoutResult: asyncNoop,
  cancel: asyncNoop,
  retry: asyncNoop,
  close: noop,
  dismiss: noop,
};
const query = new URLSearchParams(location.search);
const theme = query.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.style.colorScheme = theme;
const flow = current.flow;
if (current.kind === "notice") {
  if (flow) showUninstallNotice(flow, t, noop);
  if (current.notice)
    notices.show({
      key: stateId,
      text: current.notice.text,
      ...(current.notice.detail ? { detail: { open: noop } } : {}),
      dismissible: current.notice.dismissible,
    });
}

function Version() {
  return (
    <HostVersionSettings
      host={host}
      t={t}
      onOpenTerminal={noop}
      onClientUpdate={noop}
      onNestedBack={noop}
      disconnectedSeconds={0}
      uninstall={{ actions, onClose: noop }}
    />
  );
}
function TerminalFontSettingsPreview() {
  const [preferences, setPreferences] = useState<Preferences>({
    notifyWaiting: true,
    notifyDone: true,
    backgroundConnection: false,
    notificationPrompted: true,
    closeToExit: false,
    language,
    theme: theme,
    fontSize: 16,
    terminalFontSize: 14,
    terminalFontFamily:
      stateId === "terminal-font-saved" ? "FiraCode Nerd Font" : "",
    terminalRightClick: "menu",
    terminalLinkOpen: "click",
    doubleClickMaximize: true,
    panelWidths: {},
    panelFullWidth: {},
  });
  return (
    <ProductSettings
      open
      section="display"
      initialDetail
      state={{
        ...connection.getSnapshot(),
        initial: {
          ...connection.getSnapshot().initial,
          mobile: matchMedia("(max-width:767px)").matches,
        },
      }}
      preferences={preferences}
      onPreferencesChange={async (change) => {
        if (stateId === "terminal-font-error") return false;
        setPreferences((current) => ({ ...current, ...change }));
        return true;
      }}
      onRetryPreferences={noop}
      language={language}
      t={t}
      onOpenChange={noop}
      onCloseHandler={noop}
      onSectionChange={noop}
      onRepositoryChange={noop}
      onOpenTerminal={noop}
      onRegisterNewHost={noop}
      onNestedBack={noop}
      disconnectedSeconds={0}
      accessoryLayout={getDefaultTerminalAccessoryLayout()}
      onDefaultShellChange={noop}
      onNotificationPermission={noop}
      uninstallActions={actions}
      onUninstallClose={noop}
    />
  );
}

function SettingsBackdrop() {
  const setup = stateId.startsWith("A");
  const name = setup ? "office-win" : "build-linux";
  const integrations = current.kind === "integrations";
  const title = integrations
    ? t("Integrations")
    : setup
      ? t("Connection")
      : t("Version");
  return (
    <Dialog open>
      <DialogContent
        className="settings-modal dialog-full-screen"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("Settings")}</DialogTitle>
          <DialogDescription>{t("Client and Host settings")}</DialogDescription>
        </DialogHeader>
        <div className="settings-location">
          <span className="settings-mobile-title">{title}</span>
          <Button
            className="settings-close"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Close")}
          >
            <X size={16} />
          </Button>
        </div>
        <SidebarProvider className="settings-pane v9-settings-pane settings-mobile-detail">
          <nav
            className="settings-nav v9-settings-nav"
            aria-label={t("Settings")}
          >
            <div className="v9-settings-section-title">{t("This PC")}</div>
            <SidebarMenu>
              {[
                ["General", Settings],
                ["Notifications", Bell],
                ["Display", Monitor],
                ["Keyboard", Keyboard],
              ].map(([label, Icon]) => (
                <SidebarMenuItem key={String(label)}>
                  <SidebarMenuButton>
                    <Icon size={14} />
                    <span>{t(String(label))}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            <div className="v9-settings-section-title v9-settings-host-title">
              Host
            </div>
            <Button variant="outline">
              <Plus size={14} />
              {t("Add iori Host")}
            </Button>
            <Select value={name}>
              <SelectTrigger className="v9-settings-host-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={name}>{name}</SelectItem>
              </SelectContent>
            </Select>
            <SidebarMenu>
              {[
                ["Connection", Cable],
                ["Devices", Terminal],
                ["Integrations", Blocks],
                ["Version", Package],
              ].map(([label, Icon]) => (
                <SidebarMenuItem key={String(label)}>
                  <SidebarMenuButton isActive={t(String(label)) === title}>
                    <Icon size={14} />
                    <span>{t(String(label))}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            <div className="v9-settings-section-title">{t("Workspace")}</div>
            <Button variant="outline">iori</Button>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <GitFork size={14} />
                  Git
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </nav>
          <div className="settings-content v9-settings-content">
            <PageBody>
              <PageHeader
                className="settings-page-header"
                title={title}
                description={
                  <>
                    {name}
                    {stateId === "B1" && (
                      <>
                        {" "}
                        · <Connecting t={t} />
                      </>
                    )}
                  </>
                }
              />
              {setup ? (
                <SettingsSection title={t("Destination")}>
                  <FieldRow label={name} description="Connected" />
                </SettingsSection>
              ) : integrations ? (
                <IntegrationsSettings
                  hostKey={host.publicKey}
                  t={t}
                  language="ja"
                  registerEditor={() => noop}
                  onNestedBack={noop}
                />
              ) : (
                <Version />
              )}
            </PageBody>
          </div>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
function Onboarding() {
  return (
    <main className="onboarding-screen">
      <section className="onboarding-panel">
        <span className="app-wordmark">iori</span>
        <h1>{t("Connect to a Host")}</h1>
        <div className="onboarding-actions">
          <Button size="lg">{t("Set up iori Host")}</Button>
          <Button size="lg" variant="outline">
            {t("Connect with an invitation")}
          </Button>
        </div>
      </section>
    </main>
  );
}
function ChildStatesPreview() {
  const common = {
    createdAt: 1,
    conversation: "parent",
    parentTerminalId: "parent",
    parentCwd: "/work",
    teamId: "team",
    role: "Worker",
    title: "Task",
    cli: { id: "codex", name: "Codex" },
    model: "gpt-6.1-sol",
    terminalId: "child",
  };
  const children = [
    {
      ...common,
      id: "capacity",
      state: "waiting" as const,
      waiting: "capacity" as const,
    },
    {
      ...common,
      id: "candidates",
      state: "waiting" as const,
      waiting: "candidates" as const,
    },
    {
      ...common,
      id: "parent-exit",
      state: "stopped" as const,
      stoppedBy: "parent_exit" as const,
    },
    {
      ...common,
      id: "host-restart",
      state: "stopped" as const,
      stoppedBy: "host_restart" as const,
    },
  ];
  return (
    <div style={{ display: "flex", height: "100%" }}>
      <SidebarProvider style={{ width: 500, minWidth: 500 }}>
        <div style={{ width: 480 }}>
          <SidebarMenu>
            <ChildRows
              hostKey={host.publicKey}
              children={children}
              t={t}
              onOpen={noop}
              onStop={noop}
              onBranch={noop}
              onDrag={() => noop}
              dragViews={false}
              errors={{}}
              branches={{}}
            />
          </SidebarMenu>
        </div>
      </SidebarProvider>
      <TerminalPane
        viewId="preview"
        hostKey={host.publicKey}
        connectionId="preview"
        connected={false}
        foreground={false}
        mobile={false}
        claimSizeOnOpen={false}
        visible={false}
        terminal={{
          id: "parent",
          createdAt: 1,
          shell: "bash",
          cwd: "/work",
          title: "Parent",
          cols: 80,
          rows: 24,
          lastDesktopSize: { cols: 80, rows: 24 },
          cliResumePending: true,
        }}
        onBackHandler={noop}
        onResume={async () => false}
        onCloseTerminal={noop}
        onFocusConsumed={noop}
        onOpenFile={noop}
        onClosed={noop}
        onOpenClaimConsumed={noop}
        accessoryLayout={getDefaultTerminalAccessoryLayout()}
        fontSize={14}
        fontFamily=""
        onFontSize={noop}
        rightClick="menu"
        linkOpen="click"
        onInputPreferences={noop}
        t={t}
      />
    </div>
  );
}
function UsagePreview() {
  const state = Number(stateId.split("-").at(-1));
  const graph = stateId.includes("-circle-") ? "circle" : "bar";
  const display =
    query.get("display") === "remaining" || [8, 25].includes(state)
      ? "remaining"
      : "used";
  const agents = stateId.includes("-agents-");
  const list = usageSnapshot(stateId);
  return (
    <UsagePreferences.Provider value={{ graph, display }}>
      <TooltipProvider>
        <div className="workspace-app" style={{ height: "100dvh" }}>
          <div className="mobile-location">
            <Terminal size={16} />
            <span>
              {agents ? "AI Agents" : state === 20 ? "Board" : "Terminal"}
            </span>
          </div>
          <main style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {agents && (
              <TeamContext.Provider
                value={{
                  t,
                  language,
                  clis: list.clis,
                  catalogs: {},
                  loadingModels: {},
                  hostName: host.hostName,
                  cliNames: {},
                }}
              >
                <AgentsPage
                  host={host.publicKey}
                  clis={list.clis}
                  failed={[]}
                  listError={false}
                  onRetryList={noop}
                  onChanged={asyncNoop}
                  expanded={{}}
                  onExpandedChange={noop}
                  renderSettings={() => null}
                  renderModelError={() => null}
                />
              </TeamContext.Provider>
            )}
            {state === 20 && (
              <Board
                host={host.publicKey}
                cwd="/home/user"
                visible={false}
                t={t}
                language={language}
                onOpenTerminal={noop}
                onOpenGit={noop}
                onEditTeam={noop}
                onViewState={noop}
              />
            )}
          </main>
          <div className="status-bar">
            <span>
              <StatusDot state={state === 10 ? "stopped" : "active"} />
              {t(state === 10 ? "Reconnecting…" : "Connected")}
            </span>
            <UsageStatus
              hostKey={host.publicKey}
              connected={false}
              language={language}
            />
          </div>
          {state === 13 && <TerminalFontSettingsPreview />}
        </div>
      </TooltipProvider>
    </UsagePreferences.Provider>
  );
}
function Frame() {
  if (current.kind === "reading")
    return (
      <TooltipProvider>
        <ReadingPreview state={stateId} />
      </TooltipProvider>
    );
  if (current.kind === "usage") return <UsagePreview />;
  if (current.kind === "child-states")
    return (
      <TooltipProvider>
        <div className="app-root">
          <ChildStatesPreview />
        </div>
      </TooltipProvider>
    );
  if (current.kind === "initialization")
    return (
      <div className="app-root">
        <ClientInitialization
          error={
            stateId === "registration-windows"
              ? "Cannot read iori's key on this device."
              : "Cannot read iori's key from the system keyring."
          }
          t={t}
          onRetry={asyncNoop}
          onReset={asyncNoop}
        />
      </div>
    );
  const name = stateId === "A0-name" ? "" : deviceName;
  const afterSettings =
    current.kind === "notice" &&
    !["A13", "A13b", "A11d-closed-failed", "B9-closed-failed"].includes(
      stateId,
    );
  return (
    <TooltipProvider>
      <MaintenanceClisContext.Provider
        value={() => ({ [host.publicKey]: clis })}
      >
        <div className="app-root">
          {afterSettings ? (
            stateId === "B5-last" ? (
              <Onboarding />
            ) : null
          ) : current.kind === "terminal-font" ? (
            <TerminalFontSettingsPreview />
          ) : (
            <SettingsBackdrop />
          )}
          {!current.unavailable && current.kind === "setup" && (
            <HostSetupDialog
              open
              deviceName={name}
              t={t}
              onClose={noop}
              onCompleted={noop}
              onInvitation={noop}
              onOpenWindowsSettings={noop}
            />
          )}
          {!current.unavailable && current.kind === "uninstall" && flow && (
            <HostUninstallDialog
              flow={flow}
              actions={actions}
              connected={stateId !== "B2-disconnected"}
              onOpenTerminal={noop}
              onClose={noop}
              t={t}
            />
          )}
          {current.unavailable && <p role="status">{current.unavailable}</p>}
          <NoticeStack
            t={t}
            names={["build-linux", "office-win", deviceName, "iori Host"]}
          />
        </div>
      </MaintenanceClisContext.Provider>
    </TooltipProvider>
  );
}
function Picker() {
  const [selected, setSelected] = useState(stateId);
  const [selectedTheme, setTheme] = useState(theme);
  return (
    <div className="page-body">
      <div className="field-row">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allStates.map(({ id, label }: { id: string; label: string }) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedTheme} onValueChange={setTheme}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">ライト</SelectItem>
            <SelectItem value="dark">ダーク</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <iframe
        title={selected}
        src={`?frame&state=${selected}&theme=${selectedTheme}`}
        style={{ width: "100%", height: "calc(100dvh - 100px)", border: 0 }}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  query.has("frame") ? <Frame /> : <Picker />,
);
