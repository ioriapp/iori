import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  compareVersions,
  inviteSchema,
  parseResult,
  type Invite,
} from "@iori/protocol";
import { ChevronRight } from "lucide-react";
import { native } from "../native.ts";
import { connection } from "../connection.ts";
import { notices } from "../notices.ts";
import { clientVersion } from "../updates/host-controller.ts";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { FlowDialog, type FooterSpec } from "../components/flow/FlowDialog.tsx";
import {
  Command,
  Failure,
  Notice,
  P,
  SshOriginal,
  Status,
  Summary,
  Text,
  Warning,
} from "../components/flow/Notice.tsx";
import { Progress, steps } from "../components/flow/Progress.tsx";
import { SetupFields } from "./SetupFields.tsx";
import { SshPrompt } from "./SshPrompt.tsx";
import {
  failureMessage,
  message,
  parseDestination,
  setupLabels,
  shellArgument,
  setupStep,
} from "./ssh-errors.ts";
import type {
  SetupCompletion,
  SshFailure,
  SshFunctions,
  SshInstallMode,
  SshMachine as Machine,
  SshPrompt as Prompt,
  SshStage,
} from "./ssh-events.ts";

const ssh: SshFunctions = native;

export function SshSetup({
  open,
  name,
  t,
  onName,
  onLocal,
  onClose,
  onCompleted,
  onInvitation,
  onOpenWindowsSettings,
}: {
  open: boolean;
  name: string;
  t: (key: string) => string;
  onName: (name: string) => void;
  onLocal: () => void;
  onClose: () => void;
  onCompleted?: (completion: SetupCompletion) => void;
  onInvitation?: () => void;
  onOpenWindowsSettings?: () => void;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const [available, setAvailable] = useState<boolean>();
  const [candidates, setCandidates] = useState<string[]>();
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [destination, setDestination] = useState("");
  const [machine, setMachine] = useState<Machine>();
  const [prompt, setPrompt] = useState<Prompt>();
  const [failure, setFailure] = useState<SshFailure>();
  const [registrationError, setRegistrationError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState(false);
  const [stage, setStage] = useState<SshStage>("download");
  const [mode, setMode] = useState<SshInstallMode>("install");
  const [log, setLog] = useState<string[]>([]);
  const [linger, setLinger] = useState(false);
  const [signIn, setSignIn] = useState<"required" | "notStarted">();
  const [invite, setInvite] = useState<Invite>();
  const [registered, setRegistered] = useState<string>();
  const [warning, setWarning] = useState<SetupCompletion>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [phone, setPhone] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );
  const session = useRef("");
  const stopping = useRef(false);
  const connected = useRef(false);
  const running = useRef(false);
  const hidden = useRef(!open);
  const update = useRef(false);
  const activeMode = useRef<SshInstallMode>("install");
  const loggedStep = useRef<number | undefined>(undefined);
  const failedLog = useRef(false);
  const existing = useRef(false);
  const currentMachine = useRef<Machine | undefined>(undefined);
  const complete = useRef(false);
  const identity = useRef<Prompt | undefined>(undefined);
  const listener = useRef<Promise<() => void> | undefined>(undefined);
  const callbacks = useRef({ t, onCompleted, onClose });
  callbacks.current = { t, onCompleted, onClose };
  hidden.current = !(open || detailOpen);
  const windows = machine?.os === "Windows";
  const platform = machine
    ? `${machine.os} ${machine.arch === "other" ? machine.cpu : machine.arch}`
    : "";
  const values = {
    host: destination,
    user: machine?.user ?? "",
    version: failure?.hostVersion ?? machine?.host?.version ?? "",
    clientVersion,
  };
  const m = (key: string) => message(t, key, values);
  const names = [destination, name, machine?.user ?? ""];

  function failed(value: SshFailure) {
    setPrompt(undefined);
    if (stopping.current || value.kind === "cancelled") return;
    if (value.kind === "disconnected" || value.kind === "declined")
      connected.current = false;
    if (value.kind === "declined") {
      setDestination("");
      setMachine(undefined);
      setProgress(false);
      setFailure(undefined);
      setRegistrationError(undefined);
      setBusy(false);
      return;
    }
    setFailure(value);
    if (value.kind === "controlOutdated") setProgress(false);
    setBusy(false);
    if (!failedLog.current) {
      failedLog.current = true;
      const labels = setupLabels(
        destination,
        currentMachine.current?.os === "Windows",
        activeMode.current === "register" ? "register" : update.current,
        t,
      );
      const at = setupStep(
        value.stage ?? stage,
        currentMachine.current?.os === "Windows",
        activeMode.current === "register" ? "register" : update.current,
      );
      setLog((lines) => [
        ...lines,
        ...(loggedStep.current === undefined
          ? []
          : [`${labels[at]} · ${t("Failed")}`]),
        ...(value.detail ? [value.detail] : []),
      ]);
    }
    if (update.current && hidden.current)
      notices.show({
        key: `setup:${session.current}`,
        text: m(
          "Could not update iori Host on {host}, so this device could not be registered.",
        ),
        detail: { open: () => setDetailOpen(true) },
      });
  }
  async function load() {
    setFailure(undefined);
    try {
      const client = await ssh.sshClient();
      setAvailable(client.available);
      if (client.available) setCandidates(await ssh.sshCandidates());
    } catch (cause) {
      setFailure(cause as SshFailure);
    }
  }
  const handleEvent = useRef<
    (event: import("./ssh-events.ts").SshEvent) => void
  >(() => {});
  handleEvent.current = (event) => {
    if (event.session !== session.current) return;
    const value = event.value;
    if (value.type === "prompt") {
      setPrompt(value.prompt);
      if (value.prompt.kind === "password") identity.current = value.prompt;
    }
    if (value.type === "promptClosed")
      setPrompt((current) => (current?.id === value.id ? undefined : current));
    if (value.type === "linger") setLinger(true);
    if (value.type === "output") setLog((lines) => [...lines, value.line]);
    if (value.type === "stage") {
      setStage(value.stage);
      if (value.stage !== "connect") {
        const grouping =
          activeMode.current === "register" ? "register" : update.current;
        const labels = setupLabels(
          destination,
          currentMachine.current?.os === "Windows",
          grouping,
          callbacks.current.t,
        );
        const next = setupStep(
          value.stage,
          currentMachine.current?.os === "Windows",
          grouping,
        );
        if (next !== loggedStep.current) {
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
      }
    }
    if (value.type === "closed") {
      setPrompt(undefined);
      connected.current = false;
      if (value.failure) failed(value.failure);
    }
  };
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const change = () => setPhone(media.matches);
    media.addEventListener("change", change);
    void load();
    listener.current = ssh.onSshSetup((event) => handleEvent.current(event));
    return () => {
      media.removeEventListener("change", change);
      void listener.current?.then((stop) => stop());
      if (session.current) void ssh.sshCancel(session.current);
    };
  }, []);

  useEffect(() => {
    if (
      !registered ||
      !state.connectedHosts.includes(registered) ||
      state.storageError ||
      complete.current ||
      cancelling
    )
      return;
    complete.current = true;
    setBusy(false);
    setProgress(false);
    const host =
      state.initial?.hosts.find((host) => host.publicKey === registered) ??
      state.host;
    const completion: SetupCompletion = {
      type: existing.current ? "registered" : "installed",
      hostKey: registered,
      hostName: host?.hostName ?? destination,
    };
    setLog((lines) => [
      ...lines,
      `${t("Register this device")} · ${t("Done")}`,
    ]);
    if (session.current) {
      stopping.current = true;
      void ssh.sshCancel(session.current).finally(() => {
        stopping.current = false;
        session.current = "";
      });
    }
    if (linger) {
      setWarning(completion);
      if (hidden.current)
        notices.show({
          key: registered,
          text: m(
            existing.current
              ? "Registered this device with iori Host on {host}."
              : "Installed iori Host on {host} and registered this device.",
          ),
          dismissible: false,
          detail: { open: () => setDetailOpen(true) },
        });
    } else {
      notices.show({
        key: registered,
        text: m(
          existing.current
            ? "Registered this device with iori Host on {host}."
            : "Installed iori Host on {host} and registered this device.",
        ),
      });
      setDetailOpen(false);
      callbacks.current.onCompleted?.(completion);
      callbacks.current.onClose();
    }
  }, [
    registered,
    state.connectedHosts,
    state.storageError,
    state.initial,
    state.host,
    cancelling,
    linger,
    destination,
    t,
  ]);

  async function stop() {
    if (!session.current) return;
    stopping.current = true;
    setCancelling(true);
    setPrompt(undefined);
    const id = session.current;
    try {
      await ssh.sshCancel(id);
      if (session.current === id) session.current = "";
      connected.current = false;
    } finally {
      stopping.current = false;
      setCancelling(false);
    }
  }
  async function choose(value: string): Promise<Machine | undefined> {
    await stop();
    const id = crypto.randomUUID();
    session.current = id;
    existing.current = false;
    complete.current = false;
    identity.current = undefined;
    failedLog.current = false;
    setDestination(value);
    setMachine(undefined);
    setInvite(undefined);
    setRegistered(undefined);
    setWarning(undefined);
    setLinger(false);
    setSignIn(undefined);
    setFailure(undefined);
    setRegistrationError(undefined);
    setCancelled(false);
    setBusy(true);
    try {
      await listener.current;
      const result = await ssh.sshConnect(value, id, "setup");
      if (session.current !== id || stopping.current) return;
      if (result.host) {
        try {
          result.host = parseResult("host.info", result.host);
        } catch {
          result.host = undefined;
        }
      }
      currentMachine.current = result;
      existing.current = result.installed;
      connected.current = true;
      setMachine(result);
      return result;
    } catch (cause) {
      if (session.current === id) failed(cause as SshFailure);
    } finally {
      if (session.current === id) setBusy(false);
    }
  }
  async function change(local = false) {
    try {
      await stop();
      setDestination("");
      setMachine(undefined);
      setPrompt(undefined);
      setFailure(undefined);
      setProgress(false);
      setBusy(false);
      setQuery("");
      setManual(false);
      setCancelled(false);
      setSignIn(undefined);
      if (local) onLocal();
    } catch (cause) {
      failed(cause as SshFailure);
    }
  }
  async function answer(value: string | null) {
    if (!prompt) return;
    const id = prompt.id;
    setPrompt(undefined);
    try {
      await ssh.sshAnswer(id, value);
    } catch (cause) {
      failed(cause as SshFailure);
    }
  }
  async function submit(requested?: SshInstallMode) {
    if (running.current) return;
    running.current = true;
    const nextMode =
      requested ??
      (signIn ? "register" : machine?.installed ? "register" : "install");
    update.current = nextMode === "update";
    setMode(nextMode);
    activeMode.current = nextMode;
    loggedStep.current = undefined;
    failedLog.current = false;
    setFailure(undefined);
    setRegistrationError(undefined);
    setCancelled(false);
    try {
      let target = machine;
      if (!connected.current && !registered && !invite) {
        const wasExisting = existing.current;
        target = await choose(destination);
        existing.current = wasExisting;
      }
      if (!target) return;
      setBusy(true);
      setProgress(true);
      setStage(nextMode === "register" ? "register" : "download");
      let invitation = invite;
      if (registered) {
        if (state.storageError) await connection.retrySave();
        else await connection.reconnect();
        return;
      }
      const id = session.current;
      if (!invitation) {
        const result = await ssh.sshInstall(id, nextMode);
        if (session.current !== id || stopping.current) return;
        setMachine({ ...target, installed: true });
        if (result.type === "signInRequired") {
          setSignIn(signIn ? "notStarted" : "required");
          setProgress(false);
          return;
        }
        invitation = inviteSchema.parse(result.invite);
        setInvite(invitation);
        setSignIn(undefined);
      }
      setStage("register");
      const ok = await connection.pair(invitation, name, destination);
      if (session.current !== id || stopping.current) return;
      const current = connection.getSnapshot();
      if (
        ok ||
        (current.host?.publicKey === invitation.hostKey &&
          current.devices.length > 0)
      )
        setRegistered(invitation.hostKey);
      else if (current.error) {
        if (current.error.startsWith("Could not reach the Host"))
          setRegistrationError(
            m(
              "Installed iori Host on {host}, but this device cannot connect. Check that incoming connections are allowed by the firewall between this device and {host}, then retry. To retry later, check the firewall, then select {host} in “Set up iori Host”.",
            ),
          );
        else {
          setRegistrationError(t(current.error));
          if (current.error.includes("This invitation cannot be used"))
            setInvite(undefined);
        }
      }
    } catch (cause) {
      failed(cause as SshFailure);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function cancel() {
    if (update.current && busy) {
      setDetailOpen(false);
      onClose();
      return;
    }
    if (warning) {
      onCompleted?.({ type: "closedAfterWarning", hostKey: warning.hostKey });
      setDetailOpen(false);
      onClose();
      return;
    }
    try {
      if (busy && progress) {
        await stop();
        setBusy(false);
        setProgress(false);
        setFailure(undefined);
        setRegistrationError(undefined);
        setCancelled(true);
        setLog((lines) => [...lines, t("Installation cancelled.")]);
        return;
      }
      await stop();
      setDetailOpen(false);
      onClose();
    } catch (cause) {
      failed(cause as SshFailure);
    }
  }

  const supported =
    machine &&
    ["Linux", "Windows"].includes(machine.os) &&
    machine.arch === "x64";
  const notAdmin =
    machine?.os === "Windows" &&
    !machine.installed &&
    machine.administrator === false;
  const outdated = failure?.kind === "controlOutdated";
  const currentError =
    registrationError ??
    (registered && state.storageError
      ? t("Could not save the registration. Retry saving.")
      : registered && state.error
        ? t(state.error)
        : undefined);
  let panel: ReactNode = null;
  let destinationField: ReactNode = null;
  let footer: FooterSpec = {
    onCancel: () => void cancel(),
    onPrimary: () => void submit(),
    primaryDisabled:
      busy ||
      (progress && !failure && !currentError && !signIn) ||
      !name.trim() ||
      !supported ||
      notAdmin ||
      !machine,
    cancelDisabled: cancelling,
  };
  if (!name.trim()) footer.note = t("Enter a name for this device");
  else if (!destination && available)
    footer.note = t(
      manual || candidates?.length === 0
        ? "Enter a destination"
        : "Choose a destination",
    );
  if (available === false || failure?.kind === "clientMissing") {
    const isWindows = navigator.userAgent.includes("Windows");
    panel = (
      <Failure>
        <P>
          {t(
            isWindows
              ? "OpenSSH Client was not found. Add “OpenSSH Client” in Windows Settings → Optional features, then retry."
              : "OpenSSH client was not found. Install the OpenSSH client (openssh-client), then retry.",
          )}
        </P>
        {isWindows && onOpenWindowsSettings && (
          <Button variant="outline" onClick={onOpenWindowsSettings}>
            {t("Open Windows Settings")}
          </Button>
        )}
      </Failure>
    );
    footer = {
      ...footer,
      primary: t("Retry"),
      primaryDisabled: false,
      primaryOutline: true,
      onPrimary: () => void load(),
    };
  } else if (failure && !destination) {
    panel = (
      <Failure>
        <P>{t("Invalid SSH destination information")}</P>
        {failure.detail && <SshOriginal t={t}>{failure.detail}</SshOriginal>}
      </Failure>
    );
    footer = {
      ...footer,
      primary: t("Retry"),
      primaryDisabled: false,
      primaryOutline: true,
      onPrimary: () => void load(),
    };
  } else if (!destination) {
    destinationField = (
      <div className="ssh-setup-field">
        <span className="field-label">{t("SSH destination")}</span>
        {manual ? (
          <>
            <Input
              value={input}
              placeholder={t("Example: user@192.168.1.24")}
              aria-label={t("SSH destination")}
              aria-invalid={invalid || undefined}
              aria-describedby="ssh-destination-help"
              onChange={(event) => {
                setInput(event.target.value);
                setInvalid(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const value = parseDestination(input);
                  if (value) void choose(value);
                  else setInvalid(true);
                }
              }}
            />
            <div className="ssh-setup-manual">
              <div id="ssh-destination-help" className="ssh-setup-help">
                {invalid ? (
                  <Failure>
                    <P>
                      {t("Enter host, user@host, or ssh://user@host:port.")}
                    </P>
                  </Failure>
                ) : (
                  t("Enter host, user@host, or ssh://user@host:port.")
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setManual(false);
                  setInvalid(false);
                }}
              >
                {t("Choose from the list")}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const value = parseDestination(input);
                  if (value) void choose(value);
                  else setInvalid(true);
                }}
              >
                {t("Use this SSH destination")}
              </Button>
            </div>
          </>
        ) : candidates && candidates.length > 0 ? (
          <Input
            value={query}
            placeholder={t("Filter SSH destinations")}
            aria-label={t("Filter SSH destinations")}
            onChange={(event) => setQuery(event.target.value)}
          />
        ) : null}
      </div>
    );
    if (!manual && candidates) {
      const filtered = candidates.filter((candidate) =>
        candidate.toLowerCase().includes(query.toLowerCase()),
      );
      const manualRow = (
        <div className="ssh-manual-row">
          <div className="group-body">
            <Button variant="ghost" onClick={() => setManual(true)}>
              {t("Enter manually…")}
              <ChevronRight className="row-chevron" />
            </Button>
          </div>
        </div>
      );
      panel =
        candidates.length === 0 ? (
          <div className="host-panel-stack">
            <Text muted>
              {message(
                t,
                "There are no Hosts in {path}. Select “Enter manually…” to enter a destination.",
                { path: "~/.ssh/config" },
              )}
            </Text>
            {manualRow}
          </div>
        ) : (
          <div className="ssh-candidates-block">
            <span className="ssh-setup-help">
              {message(t, "Hosts in {path}", { path: "~/.ssh/config" })}
            </span>
            <div className="ssh-candidates-box">
              <div className="group-body ssh-candidates">
                {filtered.length === 0 && (
                  <div className="row ssh-empty-row">
                    {message(t, "No destinations match “{query}”.", { query })}
                  </div>
                )}
                {filtered.map((candidate) => (
                  <div className="row" key={candidate}>
                    <Button
                      variant="ghost"
                      data-iori-ssh-host={candidate}
                      onClick={() => {
                        setLog([]);
                        void choose(candidate);
                      }}
                    >
                      {candidate}
                      <ChevronRight className="row-chevron" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            {manualRow}
          </div>
        );
    }
  } else {
    destinationField = (
      <div className="ssh-setup-field">
        <span className="field-label">{t("SSH destination")}</span>
        <div className="ssh-setup-chosen">
          <span className="name">
            <span>{destination}</span>
            {machine && (
              <span className="machine" data-iori-state="ssh-machine">
                {[platform, machine.user, machine.home]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </span>
          <Button
            variant="outline"
            data-iori-action="ssh-change-destination"
            disabled={cancelling || (busy && progress) || !!registered}
            onClick={() => void change()}
          >
            {t("Change")}
          </Button>
        </div>
      </div>
    );
    if (prompt)
      panel = (
        <SshPrompt
          key={prompt.id}
          prompt={prompt}
          t={t}
          onAnswer={(value) => void answer(value)}
          onCancel={(value) => void answer(value)}
        />
      );
    else if (busy && !progress) panel = <Status>{t("Connecting")}</Status>;
    else if (outdated) {
      panel = (
        <Warning>
          <P names={names}>
            {m(
              "iori Host on {host} is version {version}, so this device cannot be registered. It will be updated to {clientVersion} before registration.",
            )}
          </P>
          <P>
            {t(
              "All open CLIs and Terminals will stop. CLI conversations can be resumed later.",
            )}
          </P>
        </Warning>
      );
      footer = {
        ...footer,
        primary: t("Update iori Host and register"),
        primaryDisabled: !name.trim(),
        focusCancel: true,
        onPrimary: () => void submit("update"),
      };
    } else if (failure || currentError) {
      panel = (
        <Failure>
          <P names={names}>
            {currentError ??
              failureMessage(
                failure!,
                destination,
                t,
                mode === "update",
                identity.current,
              )}
          </P>
          {failure?.kind === "hostKeyChanged" && failure.address && (
            <Command
              t={t}
            >{`ssh-keygen -R ${shellArgument(failure.address)}`}</Command>
          )}
          {failure?.detail && <SshOriginal t={t}>{failure.detail}</SshOriginal>}
          {invite && currentError && (
            <Text muted>
              {message(t, "Addresses tried (UDP): {addresses}", {
                addresses: invite.addresses.join("、"),
              })}
            </Text>
          )}
        </Failure>
      );
      footer = {
        ...footer,
        primary: t("Retry"),
        primaryDisabled: busy || !name.trim(),
        primaryOutline: true,
        cancel: progress ? t("Close") : t("Cancel"),
        onPrimary: () => {
          if (progress || registered) void submit(mode);
          else void choose(destination);
        },
      };
    } else if (warning) {
      panel = (
        <div className="host-panel-stack">
          <Text names={names}>
            {m(
              existing.current
                ? "Registered this device with iori Host on {host}."
                : "Installed iori Host on {host} and registered this device.",
            )}
          </Text>
          <Warning>
            <P names={names}>
              {m(
                machine?.user
                  ? "iori Host will stop when {user} logs out of {host}. To keep it running after logout, run this command with administrator privileges."
                  : "iori Host will stop when you log out of {host}. To keep it running after logout, run this command with administrator privileges as the user running iori Host.",
              )}
            </P>
            <Command t={t}>
              {machine?.user
                ? `sudo loginctl enable-linger ${shellArgument(machine.user)}`
                : 'sudo loginctl enable-linger "$USER"'}
            </Command>
          </Warning>
        </div>
      );
      footer = { ...footer, cancel: t("Close"), primary: null };
    } else if (signIn) {
      panel =
        signIn === "notStarted" ? (
          <Warning>
            <P names={names}>
              {m(
                "iori Host has not started on {host} yet. Sign in to {host} as {user}, then select “Register with this iori Host” again.",
              )}
            </P>
          </Warning>
        ) : (
          <Text names={names}>
            {m(
              "Installed iori Host on {host}. Sign in to {host} as {user}, then select “Register with this iori Host”. To register later, sign in to {host}, then select {host} in “Set up iori Host”.",
            )}
          </Text>
        );
      footer = {
        ...footer,
        cancel: t("Close"),
        primary: t("Register with this iori Host"),
        primaryDisabled: busy || !name.trim(),
      };
    } else if (machine && !supported) {
      panel = (
        <Failure>
          <P>
            {message(
              t,
              "iori Host does not support {platform}. Linux x64 and Windows x64 are supported.",
              { platform },
            )}
          </P>
        </Failure>
      );
      footer.note = t("Choose another destination");
    } else if (notAdmin) {
      panel = (
        <Notice tone="info">
          <P names={names}>
            {m(
              "{user} on {host} is not an administrator, so installation over SSH is not available. Open iori Client on {host} and install iori Host using “This PC” in “Set up iori Host”. Windows will ask for an administrator password once during installation. Then, in iori Client on {host}, select Devices → Invite a new device, and read the invitation using “Connect with an invitation” on this device.",
            )}
          </P>
        </Notice>
      );
      footer = {
        ...footer,
        primary: t("Connect with an invitation"),
        primaryDisabled: !onInvitation,
        onPrimary: () => {
          void stop().then(onInvitation);
        },
      };
    } else if (machine?.installed) {
      panel = (
        <div className="host-panel-stack">
          <Text names={names}>
            {machine.host?.version
              ? m(
                  "iori Host {version} is already installed on {host}. This device will be registered with it.",
                )
              : t(
                  "Register this device with the existing iori Host without reinstalling it.",
                )}
          </Text>
          {machine.host?.version &&
            compareVersions(machine.host.version, clientVersion) < 0 && (
              <Text muted>
                {t(
                  "After registration, select “Update iori Host” in Settings to update to the latest version.",
                )}
              </Text>
            )}
        </div>
      );
      footer.primary = t("Register with this iori Host");
    } else if (windows)
      panel = (
        <Text muted>
          {t(
            "During installation, incoming connections for iori Host will be allowed in Windows Firewall.",
          )}
        </Text>
      );
    if (cancelled) panel = <Text>{t("Installation cancelled.")}</Text>;
    if (progress && !outdated && !warning && !signIn)
      panel = (
        <Progress
          items={steps(
            setupLabels(
              destination,
              windows,
              mode === "register" ? "register" : mode === "update",
              t,
            ),
            setupStep(
              failure?.stage ?? stage,
              windows,
              mode === "register" ? "register" : mode === "update",
            ),
            cancelling
              ? "stopped"
              : failure || currentError
                ? "failed"
                : "current",
          )}
          log={log}
          names={names}
          t={t}
        >
          {!busy && (failure || currentError) ? (
            panel
          ) : cancelling ? (
            <Status>{t("Cancelling")}</Status>
          ) : prompt ? (
            panel
          ) : null}
        </Progress>
      );
  }
  if (
    progress &&
    !failure &&
    !currentError &&
    !outdated &&
    !warning &&
    !signIn
  ) {
    footer.primary = t("Install");
    footer.primaryDisabled = true;
  }
  if (busy || prompt || invalid) footer.note = undefined;
  if (prompt && phone) footer.primary = null;
  if (update.current && busy && progress)
    footer = {
      cancel: t("Close"),
      primary: null,
      note: t("Updating and registration will continue after closing"),
      onCancel: () => void cancel(),
    };
  if (cancelling)
    footer = { ...footer, cancelDisabled: true, primaryDisabled: true };
  const summary = progress || warning || signIn || (prompt && phone);
  const summaryText = message(
    t,
    machine
      ? "{host} ({platform}) · This device: {device}"
      : "{host} · This device: {device}",
    { host: destination, platform, device: name },
  );
  return (
    <FlowDialog
      kind="setup"
      open={open || detailOpen}
      title={t("Set up iori Host")}
      description={t(
        machine?.installed && !signIn
          ? "Register this device with iori Host."
          : "Install iori Host and register this device.",
      )}
      fields={
        summary ? (
          <Summary names={names}>{summaryText}</Summary>
        ) : (
          <SetupFields
            name={name}
            remote
            t={t}
            disabled={(busy && progress) || !!registered}
            onName={onName}
            onRemote={(value) => {
              if (!value) void change(true);
            }}
          >
            {destinationField}
          </SetupFields>
        )
      }
      panel={panel}
      footer={footer}
      names={names}
      t={t}
      onOpenChange={(visible) => {
        if (!visible && !cancelling) void cancel();
      }}
    />
  );
}
