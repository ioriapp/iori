import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  compareVersions,
  inviteSchema,
  type Invite,
  type HostInfo,
} from "@iori/protocol";
import { native } from "../native.ts";
import { connection } from "../connection.ts";
import { notices } from "../notices.ts";
import { clientVersion } from "../updates/host-controller.ts";
import { Button } from "../components/ui/button.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Separator } from "../components/ui/separator.tsx";
import { FlowDialog } from "../components/flow/FlowDialog.tsx";
import {
  Command,
  Failure,
  P,
  Status,
  Summary,
  Text,
  Warning,
} from "../components/flow/Notice.tsx";
import { Progress, steps } from "../components/flow/Progress.tsx";
import { SetupFields } from "./SetupFields.tsx";
import { SshSetup } from "./SshSetup.tsx";
import {
  message,
  setupLabels,
  setupStep,
  shellArgument,
} from "./ssh-errors.ts";
import type { SetupCompletion, SshStage } from "./ssh-events.ts";
export type { SetupCompletion } from "./ssh-events.ts";

export type LocalHost = {
  installed: boolean;
  canAllowConnections: boolean;
  user?: string;
  host?: HostInfo | null;
  version?: string;
  name?: string;
};

export function HostSetupDialog({
  open,
  deviceName,
  t,
  onClose,
  onCompleted,
  onInvitation,
  onOpenWindowsSettings,
}: {
  open: boolean;
  deviceName: string;
  t: (key: string) => string;
  onClose: () => void;
  onCompleted?: (completion: SetupCompletion) => void;
  onInvitation?: () => void;
  onOpenWindowsSettings?: () => void;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const [remote, setRemote] = useState(false);
  const [name, setName] = useState(deviceName);
  const [local, setLocal] = useState<LocalHost>();
  const [allow, setAllow] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>();
  const [linger, setLinger] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(false);
  const [stage, setStage] = useState<SshStage>("download");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [invite, setInvite] = useState<Invite>();
  const [registered, setRegistered] = useState<string>();
  const [warning, setWarning] = useState(false);
  const complete = useRef(false);
  const localInfo = useRef(local);
  localInfo.current = local;
  const loggedStep = useRef<number | undefined>(undefined);
  const active = useRef(false);
  const cancelled = useRef(false);
  const listener = useRef<Promise<() => void> | undefined>(undefined);
  const callbacks = useRef({ onCompleted, onClose, t });
  callbacks.current = { onCompleted, onClose, t };
  async function load() {
    setError(undefined);
    try {
      const result = await native.hostSetupStatus();
      setLocal(result ?? undefined);
      if (result?.canAllowConnections && result.installed)
        setAllowed(await native.hostFirewallStatus().catch(() => null));
      else setAllowed(null);
    } catch {
      setError(
        t(
          "Could not request an invitation from this PC’s Host. Check that it is running and retry.",
        ),
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    listener.current = Promise.all([
      native.onHostSetupStage((value) => {
        if (!active.current) return;
        const stage = value as SshStage;
        setStage(stage);
        const grouping = localInfo.current?.installed ? "register" : false;
        const windows = !!localInfo.current?.canAllowConnections;
        const labels = setupLabels(
          callbacks.current.t("This PC"),
          windows,
          grouping,
          callbacks.current.t,
        );
        const next = setupStep(stage, windows, grouping);
        if (loggedStep.current !== next) {
          const previous = loggedStep.current;
          setLog((lines) => [
            ...lines,
            ...(previous === undefined
              ? []
              : [`${labels[previous]} · ${callbacks.current.t("Done")}`]),
            `${labels[next]} · ${callbacks.current.t("Running")}`,
          ]);
          loggedStep.current = next;
        }
      }),
      native.onHostSetupLinger(() => {
        if (active.current) setLinger(true);
      }),
    ]).then((stops) => () => stops.forEach((stop) => stop()));
    return () => {
      void listener.current?.then((stop) => stop());
    };
  }, []);
  useEffect(() => {
    if (
      !registered ||
      !state.connectedHosts.includes(registered) ||
      state.storageError ||
      complete.current ||
      allowed === undefined
    )
      return;
    complete.current = true;
    setLog((lines) => [
      ...lines,
      `${callbacks.current.t("Register this device")} · ${callbacks.current.t("Done")}`,
    ]);
    setBusy(false);
    setProgress(false);
    if (linger || allowed === false) {
      setWarning(true);
      return;
    }
    const host =
      state.initial?.hosts.find((host) => host.publicKey === registered) ??
      state.host;
    const completion: SetupCompletion = {
      type: local?.installed ? "registered" : "installed",
      hostKey: registered,
      hostName: host?.hostName ?? callbacks.current.t("This PC"),
    };
    notices.show({
      key: registered,
      text: message(
        callbacks.current.t,
        local?.installed
          ? "Registered this device with iori Host on {host}."
          : "Installed iori Host on {host} and registered this device.",
        { host: callbacks.current.t("This PC") },
      ),
    });
    callbacks.current.onCompleted?.(completion);
    callbacks.current.onClose();
  }, [
    registered,
    state.connectedHosts,
    state.storageError,
    state.initial,
    state.host,
    allowed,
    linger,
    local?.installed,
  ]);
  async function submit() {
    if (busy) return;
    if (!local) {
      await load();
      return;
    }
    cancelled.current = false;
    setError(undefined);
    setBusy(true);
    setProgress(true);
    active.current = true;
    loggedStep.current = undefined;
    setStage(local.installed ? "register" : "download");
    try {
      await listener.current;
      if (registered) {
        if (state.storageError) await connection.retrySave();
        else await connection.reconnect();
        return;
      }
      let invitation = invite;
      if (!invitation) {
        const permitted = await native.hostSetupInstall(allow);
        if (!local.installed && local.canAllowConnections)
          setAllowed(permitted);
        if (cancelled.current) return;
        setStage("register");
        invitation = inviteSchema.parse(
          (await native.hostSetupInvite()).invite,
        );
        setInvite(invitation);
      }
      const ok = await connection.pair(invitation, name);
      const current = connection.getSnapshot();
      if (
        ok ||
        (current.host?.publicKey === invitation.hostKey &&
          current.devices.length > 0)
      )
        setRegistered(invitation.hostKey);
      else if (current.error) {
        setError(t(current.error));
        if (current.error.includes("This invitation cannot be used"))
          setInvite(undefined);
      }
    } catch (cause) {
      const detail = /^LOCAL_SETUP_FAILED:([^\n]+)\n([\s\S]*)$/.exec(
        String(cause),
      );
      const key =
        detail?.[1] === "download"
          ? "Could not download iori Host. Check the connection and retry."
          : detail?.[1] === "verification"
            ? "Could not verify iori Host. Retry downloading."
            : "Could not install or start iori Host. Retry the installation.";
      setError(t(key));
      if (detail) setLog((lines) => [...lines, detail[2]!]);
    } finally {
      setBusy(false);
      active.current = false;
    }
  }
  function close() {
    if (warning && registered)
      onCompleted?.({ type: "closedAfterWarning", hostKey: registered });
    if (busy) cancelled.current = true;
    onClose();
  }
  if (remote)
    return (
      <SshSetup
        open={open}
        name={name}
        t={t}
        onName={setName}
        onLocal={() => setRemote(false)}
        onClose={onClose}
        onCompleted={onCompleted}
        onInvitation={onInvitation}
        onOpenWindowsSettings={onOpenWindowsSettings}
      />
    );
  const host = t("This PC");
  const version = local?.host?.version ?? local?.version;
  const currentError =
    error ??
    (registered && state.storageError
      ? t("Could not save the registration. Retry saving.")
      : registered && state.error
        ? t(state.error)
        : undefined);
  const names = [name, host, local?.user ?? ""];
  const m = (key: string) =>
    message(t, key, { host, version: version ?? "", user: local?.user ?? "" });
  let panel = !local ? (
    <Status>{t("Checking iori Host on this PC")}</Status>
  ) : local.installed ? (
    <div className="host-panel-stack">
      <Text>
        {version
          ? m(
              "iori Host {version} is already installed on {host}. This device will be registered with it.",
            )
          : t(
              "Register this device with the existing iori Host without reinstalling it.",
            )}
      </Text>
      {version && compareVersions(version, clientVersion) < 0 && (
        <Text muted>
          {t(
            "After registration, select “Update iori Host” in Settings to update to the latest version.",
          )}
        </Text>
      )}
    </div>
  ) : local.canAllowConnections ? (
    <div className="host-panel-stack is-tight">
      <label className="ssh-setup-check">
        <Checkbox
          checked={allow}
          onCheckedChange={(value) => setAllow(value === true)}
        />
        <span>{t("Allow connections from other devices")}</span>
      </label>
      <Text muted>
        {t(
          allow
            ? "Windows will ask for administrator approval once during installation."
            : "Only this PC can use it.",
        )}
      </Text>
    </div>
  ) : (
    <></>
  );
  if (currentError)
    panel = (
      <Failure>
        <P>{currentError}</P>
      </Failure>
    );
  if (progress)
    panel = (
      <Progress
        t={t}
        names={names}
        items={steps(
          setupLabels(
            host,
            !!local?.canAllowConnections,
            local?.installed ? "register" : false,
            t,
          ),
          setupStep(
            stage,
            !!local?.canAllowConnections,
            local?.installed ? "register" : false,
          ),
          currentError ? "failed" : "current",
        )}
        log={log}
      >
        {currentError ? panel : null}
      </Progress>
    );
  if (warning)
    panel = (
      <div className="host-panel-stack">
        <Text>
          {m(
            local?.installed
              ? "Registered this device with iori Host on {host}."
              : "Installed iori Host on {host} and registered this device.",
          )}
        </Text>
        {allowed === false && (
          <Warning>
            <P>
              {t(
                "This PC can connect. To connect from other devices, select “Allow connections from other devices” in Connection settings.",
              )}
            </P>
          </Warning>
        )}
        {linger && (
          <Warning>
            <P names={names}>
              {m(
                local?.user
                  ? "iori Host will stop when {user} logs out of {host}. To keep it running after logout, run this command with administrator privileges."
                  : "iori Host will stop when you log out of {host}. To keep it running after logout, run this command with administrator privileges as the user running iori Host.",
              )}
            </P>
            <Command t={t}>
              {local?.user
                ? `sudo loginctl enable-linger ${shellArgument(local.user)}`
                : 'sudo loginctl enable-linger "$USER"'}
            </Command>
          </Warning>
        )}
      </div>
    );
  return (
    <FlowDialog
      open={open}
      kind="setup"
      title={t("Set up iori Host")}
      description={t(
        local?.installed
          ? "Register this device with iori Host."
          : "Install iori Host and register this device.",
      )}
      t={t}
      names={names}
      fields={
        progress || warning ? (
          <Summary names={names}>
            {message(t, "{host} · This device: {device}", {
              host,
              device: name,
            })}
          </Summary>
        ) : (
          <SetupFields
            name={name}
            remote={false}
            t={t}
            onName={setName}
            onRemote={setRemote}
          />
        )
      }
      panel={panel}
      footer={{
        cancel:
          warning || (currentError && progress) ? t("Close") : t("Cancel"),
        primary: warning
          ? null
          : t(
              currentError
                ? "Retry"
                : local?.installed
                  ? "Register with this iori Host"
                  : "Install",
            ),
        primaryDisabled:
          busy ||
          (progress && !currentError) ||
          !name.trim() ||
          (!local && !error),
        primaryOutline: !!currentError,
        note:
          !name.trim() && !busy ? t("Enter a name for this device") : undefined,
        onCancel: close,
        onPrimary: () => void submit(),
      }}
      onOpenChange={(visible) => {
        if (!visible) close();
      }}
    />
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
