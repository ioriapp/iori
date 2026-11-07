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
import { clis, deviceName, host } from "./fixtures.ts";
import "./preview.css";
import "../../apps/client/src/app.css";
import "../../apps/client/src/workspace.css";
import "../../apps/client/src/terminal/terminal.css";
import "../../apps/client/src/settings.css";
import "../../apps/client/src/worktree-creator.css";

const t = translator("ja");
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
function SettingsBackdrop() {
  const setup = stateId.startsWith("A");
  const name = setup ? "office-win" : "build-linux";
  const title = setup ? t("Connection") : t("Version");
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
function Frame() {
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
