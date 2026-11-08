import { NewWorktreeLayoutSettings } from "./NewWorktreeLayoutSettings.tsx";
import { native } from "./native.ts";
import { Command as CommandPrimitive } from "cmdk";
import { Command, CommandItem, CommandList } from "./components/ui/command.tsx";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "./components/ui/popover.tsx";
import { sidebarOrder } from "@iori/protocol";
import {
  useSettingsEditor,
  type SettingsEditor,
  type RegisterSettingsEditor,
} from "./settings-save.ts";
import {
  PageHeader,
  PageBody,
  FieldRow,
  SettingsSection as Section,
  SectionSave,
} from "./components/page-layout.tsx";
import { RepositoryGitSettings } from "./GitSettings.tsx";
import { IntegrationsSettings } from "./IntegrationsSettings.tsx";
import { basename } from "./workspace-panel.tsx";
import { TERMINAL_FONT_SIZES } from "./terminal/terminal-font-size.ts";
import { useUninstallFlow } from "./updates/uninstall-flow.ts";
import type { UninstallActions } from "./updates/HostUninstallDialog.tsx";
import { Connecting } from "./components/flow/Notice.tsx";
import { LocalHostConnections } from "./host-setup/HostSetupDialog.tsx";
import { HostVersionSettings } from "./updates/HostVersionSettings.tsx";
import { UpdateMark } from "./updates/UpdateSettings.tsx";
import { hostNeedsUpdate } from "./updates/host-controller.ts";
import { UpdateSettings } from "./updates/UpdateSettings.tsx";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { InviteQr } from "./InviteQr.tsx";
import { useIsMobile } from "./hooks/use-mobile.ts";
import {
  ArrowLeft,
  Bell,
  Blocks,
  Settings as SettingsIcon,
  Cable,
  Check,
  Keyboard,
  Monitor,
  Package,
  GitFork,
  Terminal,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  inviteToText,
  relayUrl,
  type Device,
  type FolderHistoryItem,
  type Invite,
  type TerminalShell,
} from "@iori/protocol";
import { connection } from "./connection.ts";
import { registeredDateMessage, registeredMessage } from "./i18n.ts";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { Textarea } from "./components/ui/textarea.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.tsx";
import { Switch } from "./components/ui/switch.tsx";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "./components/ui/sidebar.tsx";
import type { WorkspaceViewKind } from "./workspace-panel.tsx";
import { KeyboardSettings } from "./KeyboardSettings.tsx";
import type { TerminalLinkOpen } from "./terminal/link-click.ts";
import type { TerminalAccessoryLayout } from "./terminal/terminal-accessory-layout.ts";
import type { TerminalInputPreferences } from "./terminal/TerminalPane.tsx";
import type { LastWorkspaceTarget } from "./WorkspaceFrame.tsx";
import "./settings.css";

export const DEFAULT_SIDEBAR_WIDTH = 360;

export type Preferences = {
  notifyWaiting: boolean;
  notifyDone: boolean;
  backgroundConnection: boolean;
  notificationPrompted: boolean;
  closeToExit: boolean;
  receiveDevelopmentVersions?: boolean;
  language: "system" | "en" | "ja";
  theme: "system" | "light" | "dark";
  fontSize: number;
  terminalFontSize: number;
  terminalFontFamily: string;
  showForgeStatus?: boolean;
  terminalRightClick: "menu" | "copyPaste";
  terminalLinkOpen: TerminalLinkOpen;
  doubleClickMaximize: boolean;
  panelWidths: Partial<Record<WorkspaceViewKind, number>>;
  panelFullWidth: Partial<Record<WorkspaceViewKind, boolean>>;
  hostOrder?: string[];
  sidebarCollapsed?: string[];
  sidebarWidth?: number;
  lastWorkspaceTarget?: LastWorkspaceTarget;
  /** The phone key band, read leniently with normalizeTerminalAccessoryLayout. */
  keyboard?: unknown;
  terminalInput?: TerminalInputPreferences;
};

export type SettingsSection =
  | "general"
  | "notifications"
  | "display"
  | "keyboard"
  | "connection"
  | "devices"
  | "integrations"
  | "git"
  | "version";

export function ErrorMessage({ message }: { message?: string }) {
  return message ? (
    <p className="connection-error" role="alert" data-iori-state="error">
      {message}
    </p>
  ) : null;
}

function RevokeDialog({
  device,
  onClose,
  onRevoke,
  t,
}: {
  device?: Device;
  onClose: () => void;
  onRevoke: () => Promise<boolean>;
  t: (key: string) => string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={Boolean(device)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="revoke-dialog"
        data-iori-view="revoke-confirmation"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t("Revoke registration")}</DialogTitle>
          <DialogDescription>{device?.name}</DialogDescription>
        </DialogHeader>
        <div className="revoke-details">
          <p>
            {t(
              "This device will no longer connect to this Host. Files and work on the Host, and data on this device, are not deleted.",
            )}
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("Cancel")}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            data-iori-action="confirm-revoke"
            pending={busy}
            onClick={() => {
              setBusy(true);
              void onRevoke().finally(() => {
                setBusy(false);
                onClose();
              });
            }}
          >
            {t("Revoke registration")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Invitation({
  invite,
  status,
  device,
  busy,
  pending,
  onRevoke,
  onNewInvite,
  onNestedBack,
  t,
  language,
}: {
  invite: Invite;
  status?: "expired" | "invalidated";
  device?: Device;
  busy: boolean;
  pending: boolean;
  onRevoke: (device: Device) => void;
  onNewInvite: () => void;
  onNestedBack: (close?: () => void) => void;
  t: (key: string) => string;
  language: string;
}) {
  const [copy, setCopy] = useState(false);
  const [error, setError] = useState<string>();
  const value = inviteToText(invite);
  return (
    <section className="invitation" data-iori-view="invitation">
      {device ? (
        <>
          <p className="registered-message" data-iori-state="device-registered">
            <Check aria-hidden="true" />
            {registeredMessage(language, device.name)}
          </p>
          <Button
            onClick={() => onRevoke(device)}
            data-iori-action="undo-registration"
          >
            {t("Revoke")}
          </Button>
        </>
      ) : status ? (
        <>
          <p>
            {t(
              status === "expired"
                ? "This invitation has expired."
                : "This invitation was invalidated by a newer invitation.",
            )}
          </p>
          <Button
            data-iori-action="new-invitation"
            disabled={busy}
            pending={pending}
            onClick={onNewInvite}
          >
            {t("Create a new invitation")}
          </Button>
        </>
      ) : (
        <>
          <p>{t("Valid for 10 minutes. Can be used once.")}</p>
          <p className="settings-note">
            {t("Creating a new invitation invalidates the previous one.")}
          </p>
          <InviteQr invite={invite} t={t} onNestedBack={onNestedBack} />
          <label className="connection-field field-code">
            <span>{t("Invitation")}</span>
            <Textarea
              readOnly
              value={value}
              rows={3}
              data-iori-field="issued-invitation"
            />
          </label>
          <Button
            variant="outline"
            data-iori-action="copy-invitation"
            onClick={() => {
              void navigator.clipboard
                .writeText(value)
                .then(() => {
                  setCopy(true);
                  setError(undefined);
                })
                .catch(() =>
                  setError(
                    t("Could not copy. Select and copy the invitation below."),
                  ),
                );
            }}
          >
            {t(copy ? "Copied" : "Copy invitation")}
          </Button>
          <ErrorMessage message={error} />
        </>
      )}
    </section>
  );
}

function seenDeviceKey(device: Device) {
  return `${device.publicKey}:${device.registeredAt}`;
}

function readSeen(hostKey: string): string[] {
  try {
    return JSON.parse(
      localStorage.getItem(`iori-devices-seen-${hostKey}`) ?? "[]",
    ) as string[];
  } catch {
    return [];
  }
}

function saveSeen(hostKey: string, devices: Device[]) {
  try {
    localStorage.setItem(
      `iori-devices-seen-${hostKey}`,
      JSON.stringify(devices.map(seenDeviceKey)),
    );
  } catch {
    // Keep the new-device mark for this session when local storage is unavailable.
  }
}

function Devices({
  t,
  language,
  onNestedBack,
}: {
  t: (key: string) => string;
  language: string;
  onNestedBack: (close?: () => void) => void;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const hostKey = state.host?.publicKey ?? "";
  const [busy, setBusy] = useState<"invite" | "new-invitation">();
  const [revoke, setRevoke] = useState<Device>();
  const [seen, setSeen] = useState(() => new Set(readSeen(hostKey)));
  const [revokeErrors, setRevokeErrors] = useState<Set<string>>(
    () => new Set(),
  );
  const displayStarted = useRef(false);
  useEffect(() => {
    onNestedBack(revoke ? () => setRevoke(undefined) : undefined);
    return () => onNestedBack(undefined);
  }, [onNestedBack, revoke]);
  useLayoutEffect(() => {
    if (displayStarted.current || !hostKey) return;
    const justRegistered = state.registrationReadHostKey === hostKey;
    if (justRegistered && !state.connected) return;
    if (!justRegistered && !state.connected && state.devices.length === 0)
      return;

    if (justRegistered) {
      const visible = new Set(seen);
      for (const device of state.devices) visible.add(seenDeviceKey(device));
      setSeen(visible);
      connection.markRegistrationDevicesRead(hostKey);
    }
    saveSeen(hostKey, state.devices);
    displayStarted.current = true;
  }, [
    hostKey,
    state.connected,
    state.devices,
    state.registrationReadHostKey,
    seen,
  ]);
  return (
    <Section data-iori-view="devices">
      <FieldRow label={t("Invite a new device")}>
        <Button
          data-iori-action="invite"
          disabled={Boolean(busy)}
          pending={busy === "invite"}
          onClick={() => {
            setBusy("invite");
            void connection.createInvite().finally(() => setBusy(undefined));
          }}
        >
          {t("Invite a new device")}
        </Button>
      </FieldRow>
      {state.error && <ErrorMessage message={t(state.error)} />}
      <div className="section-rows" role="list" data-iori-list="devices">
        {state.devices.map((device) => (
          <FieldRow
            key={device.publicKey}
            role="listitem"
            data-iori-row="device"
          >
            <div className="field-copy">
              <div className="device-details">
                <span className="device-name" data-iori-value="device-name">
                  {device.name}
                </span>
                {device.publicKey === state.initial?.publicKey ? (
                  <span className="device-badge" data-iori-state="this-device">
                    {t("This device")}
                  </span>
                ) : !seen.has(seenDeviceKey(device)) ? (
                  <span className="device-badge" data-iori-state="new-device">
                    {t("New")}
                  </span>
                ) : null}
              </div>
              <p
                className="page-description"
                data-iori-value="device-registered-date"
              >
                {registeredDateMessage(language, device.registeredAt)}
              </p>
            </div>
            <div className="device-actions">
              {revokeErrors.has(device.publicKey) && (
                <ErrorMessage
                  message={t("Could not revoke this registration. Retry.")}
                />
              )}
              <Button
                variant="outline"
                data-iori-action="revoke-device"
                onClick={() => setRevoke(device)}
              >
                {t("Revoke registration")}
              </Button>
            </div>
          </FieldRow>
        ))}
      </div>
      {state.invitation && (
        <Invitation
          invite={state.invitation}
          status={state.invitationStatus}
          device={state.invitedDevice}
          busy={Boolean(busy)}
          pending={busy === "new-invitation"}
          onRevoke={setRevoke}
          onNestedBack={onNestedBack}
          onNewInvite={() => {
            setBusy("new-invitation");
            void connection.createInvite().finally(() => setBusy(undefined));
          }}
          t={t}
          language={language}
        />
      )}
      <RevokeDialog
        device={revoke}
        t={t}
        onClose={() => setRevoke(undefined)}
        onRevoke={async () => {
          if (!revoke) return false;
          const ok = await connection.revoke(revoke.publicKey);
          setRevokeErrors((current) => {
            const next = new Set(current);
            if (ok) next.delete(revoke.publicKey);
            else next.add(revoke.publicKey);
            return next;
          });
          return ok;
        }}
      />
    </Section>
  );
}

function TerminalFontSettings({
  value: savedValue,
  onSave,
  t,
  registerEditor,
  mobile,
}: {
  value: string;
  onSave: (value: string) => Promise<boolean | void>;
  t: (key: string) => string;
  registerEditor: RegisterSettingsEditor;
  mobile: boolean;
}) {
  const [value, setValue] = useState(savedValue);
  const saved = useRef(savedValue);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState(false);
  const [families, setFamilies] = useState<string[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedFont, setSelectedFont] = useState("");
  const [unselectedVersion, setUnselectedVersion] = useState(0);
  const selectingFont = useRef(false);
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  useEffect(() => {
    if (mobile) return;
    let active = true;
    void native.fontFamilies().then(
      (names) => {
        if (active) setFamilies(names);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [mobile]);
  useSettingsEditor(
    () => value !== saved.current,
    registerEditor,
    () => {
      setValue(saved.current);
      setMessage(undefined);
      setError(false);
    },
  );
  const save = async () => {
    if (busy) return;
    const submitted = value.trim();
    setBusy(true);
    setMessage(undefined);
    setError(false);
    try {
      const ok = await onSave(submitted);
      if (ok === false) throw new Error();
      saved.current = submitted;
      // Keep edits made while the save was in progress.
      setValue((current) => (current === value ? submitted : current));
      setMessage(t("Settings saved"));
    } catch {
      setError(true);
      setMessage(t("Could not save. Press Save or Enter to retry."));
    } finally {
      setBusy(false);
    }
  };
  const fragment = value
    .slice(value.lastIndexOf(",") + 1)
    .trim()
    .toLowerCase();
  const matches = families.filter((name) =>
    name.toLowerCase().includes(fragment),
  );
  const completed = families.some((name) => name.toLowerCase() === fragment);
  const shown = !mobile && suggestionsOpen && matches.length > 0 && !completed;
  const clearSelection = () => {
    selectingFont.current = false;
    setSelectedFont("");
    // cmdk may select the first remaining item after removing the selected
    // one. Change the controlled value even when already unselected so its
    // internal value and selection styling are reset too.
    setUnselectedVersion((version) => version + 1);
  };
  const startSelection = () => {
    selectingFont.current = true;
    // cmdk reports keyboard/pointer selection synchronously during the event.
    // An event that leaves the selection unchanged must not authorize a later
    // automatic selection when items mount or unmount.
    queueMicrotask(() => {
      selectingFont.current = false;
    });
  };
  const change = (next: string) => {
    setValue(next);
    clearSelection();
    setMessage(undefined);
  };
  const choose = (name: string) => {
    const comma = value.lastIndexOf(",");
    change(comma < 0 ? name : value.slice(0, comma + 1) + " " + name);
    setSuggestionsOpen(false);
  };
  const label = t("Font name");
  return (
    <Section
      title={t("Terminal font")}
      className="terminal-font-settings"
      onSave={() => void save()}
    >
      <FieldRow
        stacked
        label={<label htmlFor={input?.id}>{label}</label>}
        description={
          <span id="terminal-font-help">
            {t(
              "To use several fonts, separate them with commas. The first font installed on this device is used; if the field is empty or none are installed, the default font is used.",
            )}
          </span>
        }
      >
        <Command
          label={label}
          shouldFilter={false}
          // A nonempty value absent from font names suppresses cmdk's initial
          // automatic selection. NUL cannot occur in an installed font name.
          value={selectedFont || `\u0000${unselectedVersion}`}
          onValueChange={(name) => {
            if (selectingFont.current) {
              selectingFont.current = false;
              setSelectedFont(name);
            } else {
              clearSelection();
            }
          }}
          loop={!selectedFont}
          className="terminal-font-combobox"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              startSelection();
            }
            if (event.key === "Escape" && shown) {
              event.preventDefault();
              event.stopPropagation();
              setSuggestionsOpen(false);
            } else if (event.key === "Enter") {
              event.stopPropagation();
              if (!shown || !selectedFont) {
                event.preventDefault();
                setSuggestionsOpen(false);
                void save();
              }
            }
          }}
        >
          <Popover open={shown} onOpenChange={setSuggestionsOpen}>
            <PopoverAnchor asChild>
              <CommandPrimitive.Input
                asChild
                // Filtering is handled above. Keeping cmdk's search empty
                // avoids its automatic first-item selection on search changes.
                value=""
                onValueChange={(next) => {
                  change(next);
                  setSuggestionsOpen(true);
                }}
                onFocus={() => {
                  clearSelection();
                  setSuggestionsOpen(true);
                }}
                onBlur={() => setSuggestionsOpen(false)}
                aria-describedby="terminal-font-help"
              >
                <Input
                  // cmdk finds and focuses its input by the ID it generates.
                  ref={setInput}
                  value={value}
                  {...(!selectedFont && { "aria-activedescendant": undefined })}
                  data-iori-field="terminal-font-family"
                  placeholder="JetBrains Mono"
                  aria-expanded={shown}
                />
              </CommandPrimitive.Input>
            </PopoverAnchor>
            <PopoverContent
              className="terminal-font-options"
              align="start"
              side="bottom"
              sideOffset={4}
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
              onInteractOutside={(event) => {
                if (event.target === input) event.preventDefault();
              }}
              onEscapeKeyDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSuggestionsOpen(false);
              }}
            >
              <CommandList label={label}>
                {matches.map((name) => (
                  <CommandItem
                    key={name}
                    value={name}
                    onPointerMoveCapture={startSelection}
                    onPointerDown={(event) => event.preventDefault()}
                    onSelect={() => choose(name)}
                  >
                    {name}
                  </CommandItem>
                ))}
              </CommandList>
            </PopoverContent>
          </Popover>
        </Command>
      </FieldRow>
      <SectionSave
        t={t}
        busy={busy}
        error={error}
        message={message}
        state="terminal-font-saved"
        action="save-terminal-font"
        onSave={() => void save()}
      />
    </Section>
  );
}

function AddressSettings({
  t,
  registerEditor,
}: {
  t: (key: string) => string;
  registerEditor: RegisterSettingsEditor;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const [address, setAddress] = useState(
    state.host?.addresses.join("\n") ?? "",
  );
  const saved = useRef(address);
  const draft = useRef(address);
  draft.current = address;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState(false);
  useSettingsEditor(
    () => draft.current !== saved.current,
    registerEditor,
    () => {
      draft.current = saved.current;
      setAddress(saved.current);
      setMessage(undefined);
      setError(false);
    },
  );
  const save = async () => {
    if (busy) return;
    const submitted = address;
    const addresses = submitted
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!addresses.length && !state.host?.relay) {
      setError(true);
      setMessage(t("Enter an address and port."));
      return;
    }
    setBusy(true);
    setMessage(undefined);
    setError(false);
    try {
      if (JSON.stringify(addresses) !== JSON.stringify(state.host?.addresses))
        await connection.updateAddresses(addresses);
      saved.current = submitted;
      setMessage(t("Settings saved"));
    } catch {
      setError(true);
      setMessage(t("Could not update the Host address. Retry saving."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title={t("Address")}
      data-iori-view="connection"
      onSave={() => void save()}
    >
      <label className="connection-field field-code">
        <span className="sr-only">{t("Address")}</span>
        <Textarea
          data-iori-field="address"
          rows={3}
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
            setMessage(undefined);
          }}
          placeholder={t("Example: my-host:49171")}
        />
        <span className="settings-note">
          {t("IP address or name, including port. One address per line.")}
        </span>
      </label>
      <SectionSave
        t={t}
        busy={busy}
        error={error}
        message={message}
        action="save-address"
        onSave={() => void save()}
      />
    </Section>
  );
}

function RelaySettings({
  t,
  registerEditor,
}: {
  t: (key: string) => string;
  registerEditor: RegisterSettingsEditor;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const [url, setUrl] = useState(state.host?.relay?.url ?? "");
  const [token, setToken] = useState(state.host?.relay?.token ?? "");
  const [status, setStatus] = useState<"saved" | "error">();
  const [busy, setBusy] = useState(false);
  const saved = useRef({ url, token });
  const draft = useRef({ url, token });
  draft.current = { url, token };
  useSettingsEditor(
    () =>
      draft.current.url !== saved.current.url ||
      draft.current.token !== saved.current.token,
    registerEditor,
    () => {
      draft.current = saved.current;
      setUrl(saved.current.url);
      setToken(saved.current.token);
      setStatus(undefined);
    },
  );
  useEffect(() => {
    const next = {
      url: state.host?.relay?.url ?? "",
      token: state.host?.relay?.token ?? "",
    };
    const clean =
      draft.current.url === saved.current.url &&
      draft.current.token === saved.current.token;
    saved.current = next;
    if (clean) {
      draft.current = next;
      setUrl(next.url);
      setToken(next.token);
    }
  }, [state.host?.relay?.url, state.host?.relay?.token]);
  const save = async () => {
    if (busy) return;
    const submitted = { url, token };
    setBusy(true);
    setStatus(undefined);
    try {
      const relay = url.trim()
        ? { url: relayUrl(url.trim()), ...(token ? { token } : {}) }
        : undefined;
      const next = { url: relay?.url ?? "", token: relay?.token ?? "" };
      if (
        (next.url !== saved.current.url ||
          next.token !== saved.current.token) &&
        !(await connection.updateRelay(relay))
      )
        throw new Error("save failed");
      saved.current = next;
      if (
        draft.current.url === submitted.url &&
        draft.current.token === submitted.token
      ) {
        draft.current = saved.current;
        setUrl(saved.current.url);
        setToken(saved.current.token);
      }
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Relay" data-iori-view="relay" onSave={() => void save()}>
      <label className="connection-field field-code">
        <span>{t("Relay URL")}</span>
        <Input
          data-iori-field="relay-url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setStatus(undefined);
          }}
          placeholder="https://relay.example.com"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
      <label className="connection-field field-code">
        <span>{t("Relay access token (only if required)")}</span>
        <Input
          data-iori-field="relay-token"
          type="password"
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
            setStatus(undefined);
          }}
          autoComplete="off"
        />
      </label>
      <p className="settings-note">
        {t(
          "Use a Relay you provide to connect outside your LAN or VPN. Clear the URL to use direct connections only.",
        )}
      </p>
      {state.host?.relay &&
        state.connected &&
        state.routes[state.host.publicKey] && (
          <p
            className="settings-note"
            data-iori-state="connection-route"
            data-iori-route={state.routes[state.host.publicKey] ?? undefined}
          >
            {t(
              state.routes[state.host.publicKey] === "relay"
                ? "Connection: Relay"
                : "Connection: Direct",
            )}
          </p>
        )}
      <SectionSave
        t={t}
        busy={busy}
        action="save-relay"
        onSave={() => void save()}
        error={status === "error"}
        state={status === "saved" ? "relay-saved" : undefined}
        message={
          status === "saved"
            ? t("Settings saved")
            : status === "error"
              ? t(
                  "Could not save Relay settings. Check the URL and token, then save again.",
                )
              : undefined
        }
      />
    </Section>
  );
}

function DefaultShellSettings({
  hostKey,
  t,
  onDefaultShellChange,
}: {
  hostKey: string;
  t: (key: string) => string;
  onDefaultShellChange: (hostKey: string) => void;
}) {
  const [shells, setShells] = useState<TerminalShell[]>([]);
  const [defaultShellId, setDefaultShellId] = useState<string>();
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setStatus("loading");
    setError(false);
    try {
      const response = await connection.requestHost(
        hostKey,
        "terminal.list",
        {},
      );
      if (!response?.ok) {
        setStatus("error");
        return;
      }
      setShells(response.result.shells);
      setDefaultShellId(response.result.defaultShell);
      setStatus("loaded");
    } catch {
      setStatus("error");
    }
  }, [hostKey]);
  useEffect(() => {
    void load();
  }, [load]);
  const changeDefault = async (shellId: string) => {
    setSaving(true);
    setError(false);
    try {
      const response = await connection.requestHost(
        hostKey,
        "terminal.defaultShell.set",
        { shell: shellId },
      );
      if (!response?.ok) {
        setError(true);
        return;
      }
      setDefaultShellId(response.result.shell);
      onDefaultShellChange(hostKey);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      {status === "loading" ? (
        <p className="settings-note">{t("Loading available shells")}</p>
      ) : null}
      {status === "error" ? (
        <div className="settings-recovery" role="alert">
          <p>{t("Could not load shells. Retry.")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            data-iori-action="shells-retry"
          >
            {t("Retry")}
          </Button>
        </div>
      ) : null}
      {status === "loaded" && shells.length > 0 ? (
        <FieldRow className="v9-settings-row">
          <div className="field-copy">
            <label htmlFor="default-shell-select">{t("Default shell")}</label>
          </div>
          <div className="field-control">
            <Select
              value={defaultShellId ?? ""}
              onValueChange={(value) => void changeDefault(value)}
              disabled={saving}
            >
              <SelectTrigger
                id="default-shell-select"
                data-iori-action="default-shell-select"
              >
                <SelectValue placeholder={t("Select a shell")} />
              </SelectTrigger>
              <SelectContent>
                {shells.map((shell) => (
                  <SelectItem
                    key={shell.id}
                    value={shell.id}
                    data-iori-shell-id={shell.id}
                  >
                    {shell.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </FieldRow>
      ) : null}
      {status === "loaded" && shells.length === 0 ? (
        <p className="settings-note">
          {t("No shells were returned by this Host")}
        </p>
      ) : null}
      {error ? (
        <ErrorMessage
          message={t(
            "Could not change the default shell. Choose it again to retry.",
          )}
        />
      ) : null}
    </>
  );
}

const hostSections: {
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
}) {
  const [preferenceField, setPreferenceField] = useState<string>();
  const onPreferencesChange = (change: Partial<Preferences>) => {
    setPreferenceField(Object.keys(change)[0]);
    changePreferences(change);
  };
  const preferenceError = (field: string) =>
    preferencesError === "save" && preferenceField === field ? (
      <ErrorMessage
        message={t("Could not save settings. Choose it again to retry.")}
      />
    ) : null;
  const editors = useRef(new Set<SettingsEditor>());
  const [pendingLeave, setPendingLeave] = useState<() => void>();
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
  const onSectionChange = (next: SettingsSection) => {
    const select = () => {
      changeSection(next);
      setMobileDetail(true);
    };
    if (next !== current) leave(select);
    else select();
  };
  const [forgetBusy, setForgetBusy] = useState(false);
  const [forgetError, setForgetError] = useState(false);
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
    ? `${t("This PC")} › ${title}`
    : title;
  const selectRow = (
    label: string,
    value: string,
    options: [string, string, string?][],
    onValueChange: (next: string) => void,
    action: string,
    field: string,
    description?: string,
  ) => (
    // FieldRow's own copy/control parts, with the save error left directly in
    // the row where it takes a line of its own.
    <FieldRow className="v9-settings-row">
      <div className="field-copy">
        <span>{t(label)}</span>
        {description && <p className="page-description">{t(description)}</p>}
      </div>
      <div className="field-control">
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger aria-label={t(label)} data-iori-action={action}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map(([optionValue, optionLabel, option]) => (
              <SelectItem
                key={optionValue}
                value={optionValue}
                data-iori-option={option}
              >
                {t(optionLabel)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {preferenceError(field)}
    </FieldRow>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else void leave(() => onOpenChange(false));
      }}
    >
      <DialogContent
        className="settings-modal dialog-full-screen"
        data-iori-view="settings"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("Settings")}</DialogTitle>
          <DialogDescription>{t("Client and Host settings")}</DialogDescription>
        </DialogHeader>
        <div className="settings-location">
          {mobileDetail && (
            <Button
              variant="ghost"
              size="icon"
              className="settings-mobile-back"
              aria-label={t("Settings")}
              title={t("Settings")}
              data-iori-action="settings-back"
              onClick={() => leave(() => setMobileDetail(false))}
            >
              <ArrowLeft size={16} />
            </Button>
          )}
          <span className="settings-mobile-title">
            {mobileDetail ? mobileTitle : t("Settings")}
          </span>
          <DialogClose asChild>
            <Button
              className="settings-close"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Close")}
              title={t("Close")}
              data-iori-action="settings-close"
            >
              <X size={16} />
            </Button>
          </DialogClose>
        </div>
        <SidebarProvider
          className={`settings-pane v9-settings-pane ${mobileDetail ? "settings-mobile-detail" : ""}`}
        >
          <nav
            className="settings-nav v9-settings-nav"
            aria-label={t("Settings")}
          >
            <div className="v9-settings-section-title">{t("This PC")}</div>
            <SidebarMenu>
              {[
                ["general", "General", SettingsIcon],
                ["notifications", "Notifications", Bell],
              ].map(([id, label, Icon]) => {
                const ItemIcon = Icon as LucideIcon;
                return (
                  <SidebarMenuItem key={String(id)}>
                    <SidebarMenuButton
                      isActive={current === id}
                      aria-current={current === id ? "page" : undefined}
                      data-iori-action={`settings-${id}`}
                      onClick={() => onSectionChange(id as SettingsSection)}
                    >
                      <ItemIcon size={14} aria-hidden="true" />
                      <span>{t(String(label))}</span>
                      {id === "general" && <UpdateMark t={t} />}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={current === "display"}
                  aria-current={current === "display" ? "page" : undefined}
                  data-iori-action="settings-display"
                  onClick={() => onSectionChange("display")}
                >
                  <Monitor size={14} aria-hidden="true" />
                  <span>{t("Display")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {state.initial?.mobile && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={current === "keyboard"}
                    aria-current={current === "keyboard" ? "page" : undefined}
                    data-iori-action="settings-keyboard"
                    onClick={() => onSectionChange("keyboard")}
                  >
                    <Keyboard size={14} aria-hidden="true" />
                    <span>{t("Keyboard")}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
            {host && (
              <>
                <div className="v9-settings-section-title v9-settings-host-title">
                  {t("Host")}
                </div>
                <Button
                  variant="outline"
                  data-iori-action="register-new-host"
                  onClick={() => leave(onRegisterNewHost)}
                >
                  {t("Add iori Host")}
                </Button>
                <Select
                  value={host.publicKey}
                  onValueChange={(value) => {
                    if (value !== host.publicKey)
                      leave(() => {
                        void connection.selectHost(value);
                      });
                  }}
                >
                  <SelectTrigger
                    className="v9-settings-host-select"
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
                <SidebarMenu>
                  {hostSections.map(
                    ({ id, title: label, icon: Icon, action }) => (
                      <SidebarMenuItem key={id}>
                        <SidebarMenuButton
                          isActive={current === id}
                          aria-current={current === id ? "page" : undefined}
                          data-iori-action={action}
                          onClick={() => {
                            onSectionChange(id);
                            connection.clearError();
                          }}
                        >
                          <Icon size={14} aria-hidden="true" />
                          <span>{t(label)}</span>
                          {id === "version" && (
                            <UpdateMark
                              t={t}
                              available={hostNeedsUpdate(host)}
                            />
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ),
                  )}
                </SidebarMenu>
              </>
            )}
            {host && (
              <>
                <div className="v9-settings-section-title v9-settings-host-title">
                  {t("Workspace")}
                </div>
                {repository && (
                  <Select
                    value={repository.workspacePath}
                    onValueChange={(value) => {
                      if (value === repository.workspacePath) return;
                      const change = () => onRepositoryChange(value);
                      if (current === "git") leave(change);
                      else change();
                    }}
                  >
                    <SelectTrigger
                      className="v9-settings-host-select"
                      aria-label={t("Workspace")}
                      data-iori-action="settings-repository-select"
                      title={repository.workspacePath}
                    >
                      <SelectValue>
                        {basename(repository.workspacePath)}
                      </SelectValue>
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
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={current === "git"}
                      aria-current={current === "git" ? "page" : undefined}
                      data-iori-action="open-repository-git"
                      onClick={() => onSectionChange("git")}
                    >
                      <GitFork size={14} aria-hidden="true" />
                      <span>Git</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </>
            )}
          </nav>
          <section
            ref={contentRef}
            className="settings-content v9-settings-content"
          >
            <PageBody>
              <PageHeader
                title={current === "version" ? t("Version") : title}
                className="settings-page-header"
                description={
                  current === "version" && host ? (
                    <span className="host-desc-line">
                      <span className="host-flow-name">{host.hostName}</span>
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
              {current === "general" && state.initial?.canCloseToExit && (
                <Section>
                  <FieldRow className="v9-settings-row v9-settings-switch-row">
                    <span>{t("Exit when the window closes")}</span>
                    <Switch
                      checked={preferences.closeToExit}
                      onCheckedChange={(closeToExit) =>
                        onPreferencesChange({ closeToExit })
                      }
                      aria-label={t("Exit when the window closes")}
                      data-iori-action="general-close-to-exit"
                    />
                    {preferenceError("closeToExit")}
                  </FieldRow>
                </Section>
              )}
              {current === "general" && (
                <UpdateSettings
                  t={t}
                  receiveDevelopmentVersions={
                    preferences.receiveDevelopmentVersions ?? false
                  }
                  onDevelopmentVersionsChange={(receiveDevelopmentVersions) =>
                    onPreferencesChange({ receiveDevelopmentVersions })
                  }
                  preferenceError={preferenceError(
                    "receiveDevelopmentVersions",
                  )}
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
                <Section>
                  {(
                    [
                      [
                        "notifyWaiting",
                        "Attention notifications",
                        "notifications-waiting",
                      ],
                      [
                        "notifyDone",
                        "Completion notifications",
                        "notifications-done",
                      ],
                    ] as const
                  ).map(([key, label, action]) => (
                    <FieldRow
                      key={key}
                      className="v9-settings-row v9-settings-switch-row"
                    >
                      <span>{t(label)}</span>
                      <Switch
                        checked={preferences[key]}
                        aria-label={t(label)}
                        data-iori-action={action}
                        onCheckedChange={(checked) => {
                          onPreferencesChange({ [key]: checked });
                          if (checked) onNotificationPermission();
                        }}
                      />
                      {preferenceError(key)}
                    </FieldRow>
                  ))}
                  {state.initial?.mobile && (
                    <>
                      <FieldRow className="v9-settings-row v9-settings-switch-row">
                        <span>{t("Keep connected in the background")}</span>
                        <Switch
                          checked={preferences.backgroundConnection}
                          aria-label={t("Keep connected in the background")}
                          data-iori-action="notifications-background"
                          onCheckedChange={(backgroundConnection) => {
                            if (backgroundConnection)
                              onNotificationPermission();
                            onPreferencesChange({ backgroundConnection });
                          }}
                        />
                        {preferenceError("backgroundConnection")}
                      </FieldRow>
                      <p className="settings-note">
                        {t(
                          "Background connection shows a persistent notification and uses battery. When it is off or notifications are denied, return to the app to check pending decisions.",
                        )}
                      </p>
                    </>
                  )}
                  {notificationError && (
                    <ErrorMessage
                      message={t(
                        "Could not configure notifications. Retry in notification settings.",
                      )}
                    />
                  )}
                  {state.initial?.mobile && (
                    <Button
                      variant="outline"
                      size="sm"
                      data-iori-action="notifications-permission"
                      onClick={onNotificationPermission}
                    >
                      {t("Allow OS notifications")}
                    </Button>
                  )}
                </Section>
              )}
              {current === "keyboard" && (
                <KeyboardSettings
                  t={t}
                  layout={accessoryLayout}
                  onChange={(keyboard) => onPreferencesChange({ keyboard })}
                />
              )}
              {current === "display" && (
                <Section>
                  {selectRow(
                    "Display language",
                    preferences.language,
                    [
                      ["system", "System default", "language-system"],
                      ["en", "English", "language-en"],
                      ["ja", "日本語", "language-ja"],
                    ],
                    (value) =>
                      onPreferencesChange({
                        language: value as Preferences["language"],
                      }),
                    "display-language",
                    "language",
                  )}
                  {selectRow(
                    "Theme",
                    preferences.theme,
                    [
                      ["light", "Light", "theme-light"],
                      ["system", "System default", "theme-system"],
                      ["dark", "Dark", "theme-dark"],
                    ],
                    (value) =>
                      onPreferencesChange({
                        theme: value as Preferences["theme"],
                      }),
                    "display-theme",
                    "theme",
                  )}
                  {selectRow(
                    "Text size",
                    String(preferences.fontSize),
                    ["14", "15", "16", "17", "18"].map((size) => [size, size]),
                    (value) => onPreferencesChange({ fontSize: Number(value) }),
                    "display-text-size",
                    "fontSize",
                  )}
                  {selectRow(
                    "Terminal text size",
                    String(preferences.terminalFontSize),
                    TERMINAL_FONT_SIZES.map((size) => [
                      String(size),
                      String(size),
                      `terminal-size-${size}`,
                    ]),
                    (value) =>
                      onPreferencesChange({
                        terminalFontSize: Number(value),
                      }),
                    "terminal-text-size",
                    "terminalFontSize",
                  )}
                  {/* A touch screen has no right-click and opens links by tap. */}
                  {!state.initial?.mobile && (
                    <>
                      {selectRow(
                        "Right-click",
                        preferences.terminalRightClick,
                        [
                          ["menu", "Menu", "right-click-menu"],
                          ["copyPaste", "Copy/paste", "right-click-copy-paste"],
                        ],
                        (value) =>
                          onPreferencesChange({
                            terminalRightClick:
                              value as Preferences["terminalRightClick"],
                          }),
                        "terminal-right-click",
                        "terminalRightClick",
                      )}
                      {selectRow(
                        "Open links",
                        preferences.terminalLinkOpen,
                        [
                          ["click", "Click", "link-open-click"],
                          ["ctrlClick", "Ctrl+click", "link-open-ctrl-click"],
                        ],
                        (value) =>
                          onPreferencesChange({
                            terminalLinkOpen: value as TerminalLinkOpen,
                          }),
                        "terminal-link-open",
                        "terminalLinkOpen",
                        "Links in Terminal and CLI screens",
                      )}
                    </>
                  )}
                  <FieldRow className="v9-settings-row v9-settings-switch-row">
                    <span>{t("Show PR and CI status")}</span>
                    <Switch
                      checked={preferences.showForgeStatus !== false}
                      onCheckedChange={(checked) =>
                        onPreferencesChange({ showForgeStatus: checked })
                      }
                      aria-label={t("Show PR and CI status")}
                      data-iori-action="display-forge-status"
                    />
                    {preferenceError("showForgeStatus")}
                  </FieldRow>
                  <FieldRow className="v9-settings-row v9-settings-switch-row">
                    <span>{t("Double-click a tab to maximize")}</span>
                    <Switch
                      checked={preferences.doubleClickMaximize}
                      onCheckedChange={(checked) =>
                        onPreferencesChange({ doubleClickMaximize: checked })
                      }
                      aria-label={t("Double-click a tab to maximize")}
                      data-iori-action="display-double-click-maximize"
                    />
                    {preferenceError("doubleClickMaximize")}
                  </FieldRow>
                </Section>
              )}
              {current === "display" && !state.initial?.mobile && !isMobile && (
                <NewWorktreeLayoutSettings t={t} />
              )}
              {current === "display" && (
                <TerminalFontSettings
                  value={preferences.terminalFontFamily}
                  onSave={async (terminalFontFamily) => {
                    setPreferenceField("terminalFontFamily");
                    return changePreferences({ terminalFontFamily });
                  }}
                  t={t}
                  registerEditor={registerEditor}
                  mobile={Boolean(state.initial?.mobile) || isMobile}
                />
              )}
              {preferencesError &&
                (preferencesError === "load" ||
                  current === "keyboard" ||
                  !preferenceField) &&
                ["display", "general", "notifications", "keyboard"].includes(
                  current,
                ) && (
                  <div className="settings-recovery" role="alert">
                    <p>
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
                        preferencesError === "load" ? "Retry" : "Retry saving",
                      )}
                    </Button>
                  </div>
                )}
              {current === "connection" && host && (
                <>
                  <Section data-iori-view="terminal-settings">
                    <div
                      className="v9-settings-info-row"
                      data-iori-state={
                        state.connected
                          ? "connected"
                          : state.revoked
                            ? "revoked"
                            : "disconnected"
                      }
                    >
                      <span>{t("Status")}</span>
                      {state.connected ? (
                        <span className="v9-connection-status">
                          <Check size={14} aria-hidden="true" />
                          {t("Connected")}
                        </span>
                      ) : !state.revoked && disconnectedSeconds >= 5 ? (
                        <span className="v9-connection-status">
                          {t("Reconnecting…")}
                          <Button
                            variant="outline"
                            size="sm"
                            data-iori-action="reconnect"
                            onClick={() => void connection.reconnect()}
                          >
                            {t("Reconnect")}
                          </Button>
                        </span>
                      ) : (
                        <span />
                      )}
                    </div>
                    <DefaultShellSettings
                      key={`shell:${host.publicKey}`}
                      hostKey={host.publicKey}
                      t={t}
                      onDefaultShellChange={onDefaultShellChange}
                    />
                  </Section>
                  <AddressSettings
                    key={host.publicKey}
                    t={t}
                    registerEditor={registerEditor}
                  />
                  <RelaySettings
                    key={`relay:${host.publicKey}`}
                    t={t}
                    registerEditor={registerEditor}
                  />
                  <LocalHostConnections hostKey={host.publicKey} t={t} />
                  <div className="connection-actions">
                    <Button
                      variant="outline"
                      data-iori-action="host-forget"
                      onClick={() => {
                        setForgetError(false);
                        setForgettingHost(host);
                      }}
                    >
                      {t("Remove from list")}
                    </Button>
                  </div>
                  <Dialog
                    open={Boolean(forgettingHost)}
                    onOpenChange={(open) => {
                      if (!open) setForgettingHost(undefined);
                    }}
                  >
                    <DialogContent data-iori-view="host-forget-confirmation">
                      <DialogHeader>
                        <DialogTitle>
                          {t("Remove “{name}” from the list?").replace(
                            "{name}",
                            forgettingHost?.hostName ?? "",
                          )}
                        </DialogTitle>
                        <DialogDescription>
                          {t(
                            "This removes only this Client’s list entry and connection information. Device registrations, data and programs on the Host stay unchanged. To use this Host again, connect with an invitation.",
                          )}
                        </DialogDescription>
                      </DialogHeader>
                      {forgetError && (
                        <p role="alert">
                          {t(
                            "Could not remove this Host from the list. Retry.",
                          )}
                        </p>
                      )}
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button variant="outline">{t("Cancel")}</Button>
                        </DialogClose>
                        <Button
                          variant="destructive"
                          pending={forgetBusy}
                          data-iori-action="host-forget-confirm"
                          onClick={() => {
                            if (!forgettingHost) return;
                            setForgetBusy(true);
                            setForgetError(false);
                            void connection
                              .forgetHost(forgettingHost.publicKey)
                              .then(() => setForgettingHost(undefined))
                              .catch(() => setForgetError(true))
                              .finally(() => setForgetBusy(false));
                          }}
                        >
                          {t("Remove from list")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </>
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
              {current === "git" &&
                host &&
                repositoriesError === host.publicKey && (
                  <div className="settings-recovery" role="alert">
                    <p>{t("Could not load folders. Retry.")}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void loadRepositories()}
                    >
                      {t("Retry")}
                    </Button>
                  </div>
                )}
              {current === "git" &&
                host &&
                !repository &&
                repositories?.hostKey === host.publicKey && (
                  <p data-iori-state="no-workspaces">
                    {t("No workspaces are open on this Host.")}
                  </p>
                )}
              {current === "git" && host && repository?.kind === "folder" && (
                <p data-iori-state="workspace-not-git">
                  {t(
                    "This workspace is not a Git repository, so there are no Git settings.",
                  )}
                </p>
              )}
              {current === "git" && host && repository?.kind === "git" && (
                <RepositoryGitSettings
                  key={`${host.publicKey}:${repository.workspacePath}`}
                  hostKey={host.publicKey}
                  path={repository.workspacePath}
                  registerEditor={registerEditor}
                  t={t}
                />
              )}
              {current === "devices" && host && (
                <Devices
                  key={host.publicKey}
                  t={t}
                  language={language}
                  onNestedBack={setChildBack}
                />
              )}
            </PageBody>
          </section>
        </SidebarProvider>
        <Dialog
          open={Boolean(pendingLeave)}
          onOpenChange={(next) => {
            if (!next) setPendingLeave(undefined);
          }}
        >
          <DialogContent data-iori-view="settings-discard-confirmation">
            <DialogHeader>
              <DialogTitle>{t("Discard changes?")}</DialogTitle>
              <DialogDescription>
                {t("Changes to these settings have not been saved.")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPendingLeave(undefined)}
              >
                {t("Keep editing")}
              </Button>
              <Button
                data-iori-action="settings-discard"
                onClick={() => {
                  const next = pendingLeave;
                  for (const editor of editors.current) editor.discard?.();
                  setPendingLeave(undefined);
                  next?.();
                }}
              >
                {t("Discard changes")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
