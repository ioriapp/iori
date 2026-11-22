import {
  Bell,
  Blocks,
  Cable,
  GitFork,
  Keyboard,
  Monitor,
  Package,
  Settings as SettingsIcon,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  sidebarOrder,
  type FolderHistoryItem,
  type HostInfo,
} from "@iori/protocol";
import { cn } from "cn";
import { connection } from "../connection.ts";
import { basename } from "../workspace-panel.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { hostNeedsUpdate } from "../updates/host-controller.ts";
import { UpdateMark } from "../updates/UpdateSettings.tsx";
import type { Preferences, SettingsSection, Translate } from "./shared.tsx";

export const hostSections: {
  id: Exclude<
    SettingsSection,
    "general" | "notifications" | "display" | "keyboard" | "git"
  >;
  title: string;
  icon: LucideIcon;
  action: string;
}[] = [
  {
    id: "connection",
    title: "Connection",
    icon: Cable,
    action: "open-connection",
  },
  { id: "devices", title: "Devices", icon: Terminal, action: "open-devices" },
  {
    id: "integrations",
    title: "Integrations",
    icon: Blocks,
    action: "open-integrations",
  },
  {
    id: "version",
    title: "Version",
    icon: Package,
    action: "open-host-version",
  },
];

function NavItemButton({
  active,
  icon: Icon,
  label,
  action,
  onClick,
  trailing,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  action: string;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-active={active || undefined}
      aria-current={active ? "page" : undefined}
      data-iori-action={action}
      title={label}
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 text-left text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "min-h-11 md:min-h-0 md:h-8",
        active
          ? "text-foreground md:rounded-l-none md:border-l-2 md:border-l-primary md:bg-sidebar-accent md:font-semibold"
          : "text-sidebar-foreground/85 [@media(hover:hover)]:hover:bg-sidebar-accent/70 [@media(hover:hover)]:hover:text-foreground",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            active
              ? "text-muted-foreground md:text-primary"
              : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <span className="truncate">{label}</span>
      </span>
      {trailing}
    </button>
  );
}

export function SettingsNav({
  current,
  mobileDetail,
  host,
  state,
  preferences,
  repository,
  repositoryItems,
  hasUnsavedChanges,
  onSectionChange,
  onRegisterNewHost,
  onRepositoryChange,
  onLeave,
  t,
}: {
  current: SettingsSection;
  mobileDetail: boolean;
  host?: HostInfo;
  state: ReturnType<typeof connection.getSnapshot>;
  preferences: Preferences;
  repository?: FolderHistoryItem;
  repositoryItems: FolderHistoryItem[];
  hasUnsavedChanges: boolean;
  onSectionChange: (section: SettingsSection) => void;
  onRegisterNewHost: () => void;
  onRepositoryChange: (path: string) => void;
  onLeave: (action: () => void) => void;
  t: Translate;
}) {
  const dirtyDot = (sectionId: SettingsSection) =>
    hasUnsavedChanges && current === sectionId ? (
      <span
        aria-label={t("Unsaved changes")}
        className="size-2 shrink-0 rounded-full bg-status-waiting"
      />
    ) : null;

  return (
    <nav
      aria-label={t("Settings")}
      className={cn(
        "flex shrink-0 flex-col gap-4 overflow-y-auto bg-sidebar p-2.5 md:w-[min(13.5rem,32%)] md:border-r md:border-border",
        "max-md:w-full max-md:bg-background max-md:px-4 max-md:pt-4 max-md:pb-12",
        mobileDetail && "max-md:hidden",
      )}
    >
      {/* This device */}
      <div className="flex flex-col gap-0.5">
        <div
          className="truncate px-2 py-1 text-2xs font-semibold text-muted-foreground"
          title={t("This device")}
        >
          {t("This device")}
        </div>
        <NavItemButton
          active={current === "general"}
          icon={SettingsIcon}
          label={t("General")}
          action="settings-general"
          onClick={() => onSectionChange("general")}
          trailing={<UpdateMark t={t} />}
        />
        <NavItemButton
          active={current === "notifications"}
          icon={Bell}
          label={t("Notifications")}
          action="settings-notifications"
          onClick={() => onSectionChange("notifications")}
        />
        <NavItemButton
          active={current === "display"}
          icon={Monitor}
          label={t("Display")}
          action="settings-display"
          onClick={() => onSectionChange("display")}
          trailing={dirtyDot("display")}
        />
        {state.initial?.mobile && (
          <NavItemButton
            active={current === "keyboard"}
            icon={Keyboard}
            label={t("Keyboard")}
            action="settings-keyboard"
            onClick={() => onSectionChange("keyboard")}
          />
        )}
      </div>

      {/* Host */}
      {host && (
        <div className="flex flex-col gap-1.5">
          <div
            className="truncate px-2 py-0.5 text-2xs font-semibold text-muted-foreground"
            title={t("Host")}
          >
            {t("Host")}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center"
            data-iori-action="register-new-host"
            title={t("Add iori Host")}
            onClick={() => onLeave(onRegisterNewHost)}
          >
            <span className="truncate">{t("Add iori Host")}</span>
          </Button>
          <Select
            value={host.publicKey}
            onValueChange={(value) => {
              if (value !== host.publicKey)
                onLeave(() => {
                  void connection.selectHost(value);
                });
            }}
          >
            <SelectTrigger
              className="w-full min-w-0 justify-between bg-card text-xs"
              aria-label={t("Host")}
              data-iori-action="settings-host-select"
              data-iori-host-key={host.publicKey}
            >
              <SelectValue>{host.hostName}</SelectValue>
              <UpdateMark t={t} available={hostNeedsUpdate(host)} />
            </SelectTrigger>
            <SelectContent>
              {[...(state.initial?.hosts ?? [])]
                .sort((a, b) =>
                  sidebarOrder(preferences.hostOrder ?? [])(
                    a.publicKey,
                    b.publicKey,
                  ),
                )
                .map((item) => (
                  <SelectItem
                    key={item.publicKey}
                    value={item.publicKey}
                    data-iori-host-key={item.publicKey}
                  >
                    {item.hostName}
                    <UpdateMark
                      t={t}
                      available={hostNeedsUpdate(
                        state.observedHosts[item.publicKey],
                      )}
                    />
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <div className="flex flex-col gap-0.5">
            {hostSections.map(({ id, title: label, icon, action }) => (
              <NavItemButton
                key={id}
                active={current === id}
                icon={icon}
                label={t(label)}
                action={action}
                onClick={() => {
                  onSectionChange(id);
                  connection.clearError();
                }}
                trailing={
                  <span className="flex shrink-0 items-center gap-1.5">
                    {id === "version" && (
                      <UpdateMark t={t} available={hostNeedsUpdate(host)} />
                    )}
                    {dirtyDot(id)}
                  </span>
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Workspace */}
      {host && (
        <div className="flex flex-col gap-1.5">
          <div
            className="truncate px-2 py-0.5 text-2xs font-semibold text-muted-foreground"
            title={t("Workspace")}
          >
            {t("Workspace")}
          </div>
          {repository && (
            <Select
              value={repository.workspacePath}
              onValueChange={(value) => {
                if (value === repository.workspacePath) return;
                const change = () => onRepositoryChange(value);
                if (current === "git") onLeave(change);
                else change();
              }}
            >
              <SelectTrigger
                className="w-full min-w-0 justify-between bg-card text-xs"
                aria-label={t("Workspace")}
                data-iori-action="settings-repository-select"
                title={repository.workspacePath}
              >
                <SelectValue>{basename(repository.workspacePath)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {repositoryItems.map((item) => (
                  <SelectItem
                    key={item.workspacePath}
                    value={item.workspacePath}
                    data-iori-repository-path={item.workspacePath}
                  >
                    {basename(item.workspacePath)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex flex-col gap-0.5">
            <NavItemButton
              active={current === "git"}
              icon={GitFork}
              label="Git"
              action="open-repository-git"
              onClick={() => onSectionChange("git")}
              trailing={dirtyDot("git")}
            />
          </div>
        </div>
      )}
    </nav>
  );
}
