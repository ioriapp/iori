import { SshSetup } from "./SshSetup.tsx";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  inviteSchema,
  type Invite,
  type HostInfo,
  compareVersions,
} from "@iori/protocol";
import { native } from "../native.ts";
import { connection } from "../connection.ts";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Separator } from "../components/ui/separator.tsx";
import { clientVersion } from "../updates/host-controller.ts";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog.tsx";

export type LocalHost = {
  installed: boolean;
  canAllowConnections: boolean;
  user?: string;
  host?: HostInfo | null;
  version?: string;
  name?: string;
};
const stages: Record<string, string> = {
  download: "Downloading iori Host",
  verification: "Verifying iori Host",
  extract: "Extracting iori Host",
  start: "Starting iori Host",
  service: "Setting up iori Host to run after logout",
  firewall: "Allowing connections from other devices",
  register: "Registering this device",
};
const failures: Record<string, string> = {
  download: "Could not download iori Host. Check the connection and retry.",
  verification: "Could not verify iori Host. Retry downloading.",
  install: "Could not install or start iori Host. Retry the installation.",
  local:
    "Could not request an invitation from this PC’s Host. Check that it is running and retry.",
};
export function HostSetupDialog({
  open,
  deviceName,
  t,
  onClose,
  onComplete,
}: {
  open: boolean;
  deviceName: string;
  t: (s: string) => string;
  onClose: () => void;
  onComplete: (
    name: string,
    localOnly: boolean,
    lingerUser?: string,
    firewallCommand?: string,
    firewallTarget?: string,
  ) => void;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const [remote, setRemote] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const sshSession = useRef("");
  const [name, setName] = useState(deviceName);
  const [local, setLocal] = useState<LocalHost>();
  const [invitation, setInvitation] = useState<Invite>();
  const [allow, setAllow] = useState(true);
  const [linger, setLinger] = useState(false);
  const listener = useRef<Promise<() => void> | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>();
  const [error, setError] = useState<string>();
  const [registered, setRegistered] = useState<string>();
  const [allowed, setAllowed] = useState<boolean | null>();
  const completed = useRef(false);
  const completing = useRef(onComplete);
  completing.current = onComplete;
  async function loadLocal() {
    setError(undefined);
    try {
      const value = await native.hostSetupStatus();
      if (value) {
        setLocal(value);
        if (!value.canAllowConnections) setAllowed(null);
        else if (value.installed) {
          void native
            .hostFirewallStatus()
            .then(setAllowed)
            .catch(() => setAllowed(null));
        }
      }
    } catch {
      setError(failures.local);
    }
  }
  useEffect(() => {
    if (open && !registered) void loadLocal();
  }, [open, registered]);
  useEffect(() => {
    listener.current = Promise.all([
      native.onHostSetupStage(setStage),
      native.onHostSetupLinger(() => setLinger(true)),
    ]).then((stops) => () => stops.forEach((stop) => stop()));
    return () => {
      void listener.current?.then((stop) => stop());
    };
  }, []);
  useEffect(() => {
    if (
      registered &&
      allowed !== undefined &&
      state.host?.publicKey === registered &&
      state.connected &&
      !state.storageError &&
      !completed.current
    ) {
      completed.current = true;
      completing.current(
        state.host.hostName,
        allowed === false,
        linger ? local?.user : undefined,
      );
    }
  }, [
    registered,
    state.host,
    state.connected,
    state.storageError,
    allowed,
    linger,
    local?.user,
  ]);
  async function submit() {
    setError(undefined);
    if (!local) {
      await loadLocal();
      return;
    }
    setBusy(true);
    try {
      if (registered) {
        if (state.storageError) await connection.retrySave();
        else await connection.reconnect();
        return;
      }
      await listener.current;
      const permitted = await native.hostSetupInstall(allow);
      if (!local.installed && local.canAllowConnections) setAllowed(permitted);
      setStage("register");
      let invite = invitation;
      if (!invite) {
        const result = await native.hostSetupInvite();
        invite = inviteSchema.parse(result.invite);
        setInvitation(invite);
      }
      const ok = await connection.pair(invite, name);
      if (
        ok ||
        (connection.getSnapshot().host?.publicKey === invite.hostKey &&
          connection.getSnapshot().devices.length > 0)
      )
        setRegistered(invite.hostKey);
      else {
        const failure = connection.getSnapshot().error;
        if (
          failure ===
          "This invitation cannot be used. Create a new invitation on the Host."
        ) {
          setInvitation(undefined);
          setError("The invitation could not be used. Select Retry.");
        } else setError(failure);
      }
    } catch (cause) {
      const detail = /^LOCAL_SETUP_FAILED:([^\n]+)\n([\s\S]*)$/.exec(
        String(cause),
      );
      setError(
        detail
          ? `${t(failures[detail[1]!] ?? failures.install!)}\n${detail[2]}`
          : (failures[String(cause)] ??
              "Could not complete registration. Retry registration."),
      );
    } finally {
      setBusy(false);
      setStage(undefined);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(visible) => {
        if (!visible) {
          if (remote) void native.sshCancel(sshSession.current).then(onClose);
          else onClose();
        }
      }}
    >
      <DialogContent
        className="add-host-dialog"
        data-iori-view="host-setup"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t("Set up iori Host")}</DialogTitle>
          <DialogDescription>
            {t(
              remote
                ? "Set up iori Host on another machine"
                : "Set up iori Host on this PC",
            )}
          </DialogDescription>
        </DialogHeader>
        <label className="connection-field">
          <span>{t("This device’s name")}</span>
          <Input
            required
            form={remote ? undefined : "host-setup-local-form"}
            value={name}
            disabled={busy || (remote && remoteBusy) || !!registered}
            data-iori-field="device-name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="connection-field">
          <span>{t("Destination")}</span>
          <div className="connection-actions">
            <Button
              type="button"
              variant={remote ? "outline" : "default"}
              disabled={busy || !!registered}
              aria-pressed={!remote}
              data-iori-action="setup-local"
              onClick={() => {
                void native
                  .sshCancel(sshSession.current)
                  .then(() => setRemote(false));
              }}
            >
              {t("This PC")}
            </Button>
            <Button
              type="button"
              variant={remote ? "default" : "outline"}
              disabled={busy || !!registered}
              aria-pressed={remote}
              data-iori-action="setup-ssh"
              onClick={() => setRemote(true)}
            >
              {t("Another machine (SSH)")}
            </Button>
          </div>
        </div>
        {remote ? (
          <SshSetup
            session={sshSession}
            name={name}
            t={t}
            onComplete={onComplete}
            onBusy={setRemoteBusy}
            onClose={onClose}
          />
        ) : (
          <form
            id="host-setup-local-form"
            className="connection-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {!local ? (
              <p role="status">
                <Spinner /> {t("Checking iori Host on this PC")}
              </p>
            ) : local.installed ? (
              <div>
                <p>{local.host?.hostName ?? local.name}</p>
                {(local.host?.version ?? local.version) && (
                  <p>
                    {t("Version")}: {local.host?.version ?? local.version}
                  </p>
                )}
                <p className="settings-note">
                  {t(
                    "Register this device with the existing iori Host without reinstalling it.",
                  )}
                </p>
                {(local.host?.version ?? local.version) &&
                  compareVersions(
                    (local.host?.version ?? local.version)!,
                    clientVersion,
                  ) < 0 && (
                    <p className="settings-note">
                      {t(
                        "To update iori Host, select “Update iori Host” in Settings after registration.",
                      )}
                    </p>
                  )}
              </div>
            ) : local.canAllowConnections ? (
              <label className="settings-checkbox">
                <Checkbox
                  checked={allow}
                  disabled={busy}
                  data-iori-field="setup-allow-connections"
                  onCheckedChange={(checked) => setAllow(checked === true)}
                />
                <span>{t("Allow connections from other devices")}</span>
              </label>
            ) : null}
            {local?.canAllowConnections && !local.installed && allow && (
              <p className="settings-note">
                {t(
                  "Windows will ask for administrator approval to allow other devices to connect.",
                )}
              </p>
            )}
            {allowed === false && (
              <p className="settings-note">
                {t(
                  "This PC can connect. To connect from other devices, select “Allow connections from other devices” in Connection settings.",
                )}
              </p>
            )}
            {linger && (
              <p className="settings-note" data-iori-state="setup-linger">
                {t(
                  "iori Host will stop after logout. An administrator can enable it with:",
                )}{" "}
                <code>sudo loginctl enable-linger {local?.user}</code>
              </p>
            )}
            {stage && (
              <p
                role="status"
                className="connection-actions"
                data-iori-state="setup-progress"
              >
                <Spinner aria-label={t(stages[stage] ?? stage)} />
                {t(stages[stage] ?? stage)}
              </p>
            )}
            {(error || (registered && (state.storageError || state.error))) && (
              <p
                role="alert"
                data-iori-state="error"
                className="connection-error"
              >
                {t(
                  error ??
                    (state.storageError
                      ? "Could not save the registration. Retry saving."
                      : state.error!),
                )}
              </p>
            )}
            <div className="connection-actions">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t(busy ? "Close" : "Cancel setup")}
              </Button>
              {(local || error) && (
                <Button
                  disabled={busy || !name.trim()}
                  data-iori-action="setup-submit"
                >
                  {t(
                    error || registered
                      ? "Retry"
                      : local?.installed
                        ? "Register with this iori Host"
                        : "Install",
                  )}
                </Button>
              )}
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function LocalHostConnections({
  hostKey,
  t,
}: {
  hostKey: string;
  t: (s: string) => string;
}) {
  const [local, setLocal] = useState<LocalHost>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>();
  useEffect(() => {
    void native
      .hostSetupStatus()
      .then((value) => {
        setLocal(value ?? undefined);
        if (value?.canAllowConnections && value.host?.publicKey === hostKey)
          void native
            .hostFirewallStatus()
            .then(setAllowed)
            .catch(() => {});
      })
      .catch(() => {});
  }, [hostKey]);
  if (!local?.canAllowConnections || local.host?.publicKey !== hostKey)
    return null;
  return (
    <>
      <Separator />
      <section className="settings-section connection-form">
        {allowed && <p>{t("Connections from other devices are allowed")}</p>}
        <p className="settings-note">
          {t(
            "Windows will ask for administrator approval to allow other devices to connect.",
          )}
        </p>
        <Button
          variant="outline"
          pending={busy}
          data-iori-action="allow-host-connections"
          onClick={() => {
            setBusy(true);
            setFailed(false);
            void native
              .hostFirewall()
              .then((allowed) => {
                setAllowed((previous) => allowed || previous);
                setFailed(!allowed);
              })
              .catch(() => setFailed(true))
              .finally(() => setBusy(false));
          }}
        >
          {t("Allow connections from other devices")}
        </Button>
        {failed && (
          <p role="alert" className="connection-error">
            {t(
              "Could not allow connections. This PC can connect. To connect from other devices, select “Allow connections from other devices” in Connection settings.",
            )}
          </p>
        )}
      </section>
    </>
  );
}

export function HostSetupChoices({
  t,
  onLocal,
  onInvitation,
}: {
  t: (key: string) => string;
  onLocal: () => void;
  onInvitation: () => void;
}) {
  return (
    <div className="connection-actions">
      <Button data-iori-action="setup-host" onClick={onLocal}>
        {t("Set up iori Host")}
      </Button>
      <Button
        variant="outline"
        data-iori-action="connect-invitation"
        onClick={onInvitation}
      >
        {t("Connect with an invitation")}
      </Button>
    </div>
  );
}
