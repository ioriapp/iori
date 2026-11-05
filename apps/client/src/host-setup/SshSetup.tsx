import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  compareVersions,
  inviteSchema,
  parseResult,
  type HostInfo,
  type Invite,
} from "@iori/protocol";
import releaseSource from "../../../../release-source.txt?raw";
import { clientVersion } from "../updates/host-controller.ts";
import { native } from "../native.ts";
import { connection } from "../connection.ts";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { FirewallCommand } from "./FirewallCommand.tsx";

export type SshMachine = {
  os: string;
  cpu: string;
  user?: string;
  home?: string;
  installed: boolean;
  host?: HostInfo;
};
export type SshEvent = {
  session: string;
  value: {
    type: string;
    stage?: string;
    id?: string;
    prompt?: string;
    notification?: boolean;
    enabled?: boolean;
    allowed?: boolean;
    command?: string;
    message?: string;
  };
};
const stages: Record<string, string> = {
  connect: "Checking the SSH destination",
  download: "The destination machine is downloading iori Host",
  verification: "Verifying iori Host",
  extract: "Extracting iori Host on the destination",
  service: "Setting up iori Host to run after logout",
  start: "Starting iori Host on the destination",
  register: "Registering this device",
  firewall: "Allowing connections from other devices",
};
const unreachable =
  "SSH connected, but the iori connection could not reach the Host. Check the Host’s listening addresses and network route in Connection settings.";
function formatError(error: string, t: (key: string) => string) {
  if (error.startsWith("IORI_CONTROL_ERROR: "))
    return t("The Host could not complete the request: {message}").replace(
      "{message}",
      t(error.slice("IORI_CONTROL_ERROR: ".length)),
    );
  const exit = /^SSH_EXIT:(-?\d+)\n([\s\S]*)$/.exec(error);
  if (exit)
    return t("SSH exited with code {code}: {message}")
      .replace("{code}", exit[1]!)
      .replace("{message}", t(exit[2]!));
  const command = /^SSH_COMMAND_FAILED:(\d+):([^\n]*)\n([\s\S]*)$/.exec(error);
  if (command)
    return t(
      "The destination command failed ({stage}, exit code {code}): {message}",
    )
      .replace("{stage}", t(stages[command[2]!] ?? "Command"))
      .replace("{code}", command[1]!)
      .replace("{message}", t(command[3]!));
  if (error.startsWith("SSH_CLOSED\n"))
    return t("SSH closed: {message}").replace(
      "{message}",
      t(error.slice("SSH_CLOSED\n".length)),
    );
  const translated = t(error);
  return translated !== error
    ? translated
    : t("Could not complete SSH setup: {message}").replace("{message}", error);
}
export function SshSetup({
  name,
  t,
  onComplete,
  onBusy,
  onClose,
  session,
}: {
  name: string;
  t: (key: string) => string;
  onComplete: (
    name: string,
    localOnly: boolean,
    lingerUser?: string,
    firewallCommand?: string,
  ) => void;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
  session: RefObject<string>;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const [candidates, setCandidates] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const [destination, setDestination] = useState("");
  const [machine, setMachine] = useState<SshMachine>();
  const [prompt, setPrompt] = useState<{
    id: string;
    text: string;
    notification?: boolean;
  }>();
  const [answer, setAnswer] = useState("");
  const [stage, setStage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [linger, setLinger] = useState(false);
  const [allow, setAllow] = useState(true);
  const [firewallCommand, setFirewallCommand] = useState<string>();
  const [signInRequired, setSignInRequired] = useState(false);
  const [invite, setInvite] = useState<Invite>();
  const [registered, setRegistered] = useState<string>();
  const complete = useRef(false);
  const listener = useRef<Promise<() => void> | undefined>(undefined);
  useEffect(() => {
    void native
      .sshCandidates()
      .then(setCandidates)
      .catch((cause: unknown) => setError(String(cause)));
    listener.current = native.onSshSetup((event) => {
      if (event.session !== session.current) return;
      const value = event.value;
      if (value.type === "prompt" && value.id && value.prompt) {
        setPrompt({
          id: value.id,
          text: value.prompt,
          notification: value.notification,
        });
        setAnswer("");
      }
      if (value.type === "promptClosed")
        setPrompt((current) =>
          current?.id === value.id ? undefined : current,
        );
      if (value.type === "stage") setStage(value.stage);
      if (value.type === "closed") {
        setPrompt(undefined);
        setAnswer("");
        setError(value.message);
        setMachine(undefined);
        setStage(undefined);
        setBusy(false);
      }
      if (
        value.type === "firewall" &&
        value.allowed === false &&
        typeof value.command === "string"
      )
        setFirewallCommand(value.command);
      if (value.type === "linger" && value.enabled === false) setLinger(true);
    });
    return () => {
      void native.sshCancel(session.current);
      session.current = "";
      void listener.current?.then((stop) => stop());
    };
  }, [session]);
  useEffect(() => {
    onBusy(busy || !!registered);
  }, [busy, registered, onBusy]);
  useEffect(() => {
    if (
      registered &&
      !cancelled &&
      !cancelling &&
      state.host?.publicKey === registered &&
      state.connected &&
      !state.storageError &&
      !complete.current
    ) {
      complete.current = true;
      void native
        .sshCancel(session.current)
        .then(() =>
          onComplete(
            state.host!.hostName,
            false,
            linger ? machine?.user : undefined,
            firewallCommand,
          ),
        );
    }
  }, [
    registered,
    cancelled,
    cancelling,
    state.host,
    state.connected,
    state.storageError,
    onComplete,
    linger,
    machine?.user,
    firewallCommand,
    session,
  ]);
  async function cancel() {
    const id = session.current;
    session.current = "";
    setCancelling(true);
    setPrompt(undefined);
    setAnswer("");
    try {
      await native.sshCancel(id);
      setCancelled(true);
      setStage(undefined);
      setBusy(false);
      return true;
    } catch (cause) {
      setError(String(cause));
      return false;
    } finally {
      setCancelling(false);
    }
  }
  async function select(value: string) {
    if (!(await cancel())) return;
    const id = crypto.randomUUID();
    session.current = id;
    setCancelled(false);
    setError(undefined);
    setMachine(undefined);
    setInvite(undefined);
    setLinger(false);
    setAllow(true);
    setFirewallCommand(undefined);
    setSignInRequired(false);
    setDestination(value);
    setStage("connect");
    setBusy(true);
    try {
      await listener.current;
      const result = await native.sshConnect(value, id);
      if (result.host) {
        try {
          result.host = parseResult("host.info", result.host);
        } catch {
          result.host = undefined;
        }
      }
      if (session.current === id) setMachine(result);
    } catch (cause) {
      if (session.current === id) setError(String(cause));
    } finally {
      if (session.current === id) {
        setBusy(false);
        setStage(undefined);
      }
    }
  }
  async function respond(value: string) {
    if (!prompt) return;
    const id = prompt.id;
    setPrompt(undefined);
    setAnswer("");
    await native.sshAnswer(id, value);
  }
  async function submit() {
    if (!machine || cancelled) {
      await select(destination);
      return;
    }
    const id = session.current;
    setError(undefined);
    setBusy(true);
    try {
      if (registered) {
        if (state.storageError) await connection.retrySave();
        else await connection.reconnect();
        return;
      }
      let invitation = invite;
      if (!invitation) {
        const result = await native.sshInstall(
          id,
          machine.installed,
          !!machine.host,
          allow,
        );
        if (session.current !== id) return;
        setMachine({ ...machine, installed: true });
        if (result.signInRequired) {
          setSignInRequired(true);
          return;
        }
        setSignInRequired(false);
        invitation = inviteSchema.parse(result.invite);
        setInvite(invitation);
      }
      setStage("register");
      const ok = await connection.pair(invitation, name, destination);
      if (session.current !== id) return;
      const current = connection.getSnapshot();
      if (
        ok ||
        (current.host?.publicKey === invitation.hostKey &&
          current.devices.length > 0)
      )
        setRegistered(invitation.hostKey);
      else if (current.error?.includes("This invitation cannot be used")) {
        setInvite(undefined);
        setError(current.error);
      } else
        setError(
          current.error?.startsWith("Could not reach the Host")
            ? unreachable
            : current.error,
        );
    } catch (cause) {
      if (session.current === id) setError(String(cause));
    } finally {
      if (session.current === id) {
        setBusy(false);
        setStage(undefined);
      }
    }
  }
  const controlError = error?.startsWith("IORI_CONTROL_ERROR: ");
  const supported =
    (machine?.os === "Linux" && machine.cpu === "x86_64") ||
    (machine?.os === "Windows" && machine.cpu.toLowerCase() === "amd64");
  const yesNo = prompt?.text.includes(
    "Are you sure you want to continue connecting",
  );
  return (
    <div className="connection-form">
      <div className="connection-field">
        <span>{t("SSH destination")}</span>
        {destination ? (
          <div className="connection-actions">
            <span className="ssh-destination">{destination}</span>
            <Button
              type="button"
              variant="ghost"
              disabled={cancelling || !!registered}
              data-iori-action="ssh-change"
              onClick={() => {
                void cancel().then((stopped) => {
                  if (!stopped) return;
                  setManual(false);
                  setQuery("");
                  setDestination("");
                  setMachine(undefined);
                  setFirewallCommand(undefined);
                  setSignInRequired(false);
                  setAllow(true);
                  setInvite(undefined);
                  setError(undefined);
                  setCancelled(false);
                });
              }}
            >
              {t("Change")}
            </Button>
          </div>
        ) : (
          <>
            <Input
              aria-label={t(
                manual ? "SSH destination" : "Filter SSH destinations",
              )}
              data-iori-field="ssh-destination"
              value={query}
              placeholder={
                manual
                  ? "[user@]host / ssh://[user@]host[:port]"
                  : t("Filter SSH destinations")
              }
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (manual && event.key === "Enter") {
                  event.preventDefault();
                  void select(query);
                }
              }}
            />
            {manual ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  data-iori-action="ssh-back-to-candidates"
                  onClick={() => {
                    setManual(false);
                    setQuery("");
                  }}
                >
                  {t("Change")}
                </Button>
                <Button
                  type="button"
                  disabled={!query.trim()}
                  data-iori-action="ssh-select-manual"
                  onClick={() => {
                    void select(query);
                  }}
                >
                  {t("Use this destination")}
                </Button>
              </>
            ) : (
              <div className="ssh-candidates">
                {candidates
                  .filter((value) =>
                    value.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((value) => (
                    <Button
                      key={value}
                      type="button"
                      variant="ghost"
                      data-iori-ssh-host={value}
                      onClick={() => {
                        void select(value);
                      }}
                    >
                      {value}
                    </Button>
                  ))}
                <Button
                  type="button"
                  variant="ghost"
                  data-iori-action="ssh-manual"
                  onClick={() => {
                    setManual(true);
                    setQuery("");
                  }}
                >
                  {t("Enter manually…")}
                </Button>
              </div>
            )}
          </>
        )}
        {machine && (
          <p data-iori-state="ssh-machine">
            {[machine.os, machine.user, machine.home]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        {machine && !supported && (
          <p role="alert">
            {t("{platform} is not supported yet.").replace(
              "{platform}",
              machine.os === "Linux" || machine.os === "Windows"
                ? machine.cpu
                : machine.os,
            )}
          </p>
        )}
      </div>
      {prompt && (
        <div className="connection-field" data-iori-state="ssh-prompt">
          <p className="ssh-prompt">{prompt.text}</p>
          {!yesNo && !prompt.notification && (
            <Input
              type="password"
              autoComplete="off"
              aria-label={t("SSH response")}
              data-iori-field="ssh-answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void respond(answer);
                }
              }}
            />
          )}
          {!prompt.notification && (
            <div className="connection-actions">
              <Button
                type="button"
                data-iori-action="ssh-answer"
                onClick={() => {
                  void respond(yesNo ? "yes" : answer);
                }}
              >
                {t(yesNo ? "Connect" : "Send")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  void native
                    .sshAnswer(prompt.id, yesNo ? "no" : null)
                    .then(cancel);
                }}
              >
                {t("Cancel setup")}
              </Button>
            </div>
          )}
        </div>
      )}
      {machine?.installed && (
        <div>
          <p>{machine.host?.hostName}</p>
          {machine.host?.version && (
            <p>
              {t("Version")}: {machine.host.version}
            </p>
          )}
          <p className="settings-note">
            {t(
              "Register this device with the existing iori Host without reinstalling it.",
            )}
          </p>
          {machine.host?.version &&
            compareVersions(machine.host.version, clientVersion) < 0 && (
              <p className="settings-note">
                {t("You can update iori Host in Settings after registration.")}
              </p>
            )}
        </div>
      )}
      {machine?.os === "Windows" && !machine.installed && (
        <>
          <label className="settings-checkbox">
            <Checkbox
              checked={allow}
              disabled={busy}
              data-iori-field="setup-allow-connections"
              onCheckedChange={(checked) => setAllow(checked === true)}
            />
            <span>{t("Allow connections from other devices")}</span>
          </label>
          {allow && (
            <p className="settings-note">
              {t(
                "If the user on that PC is an administrator, permission is added during installation.",
              )}
            </p>
          )}
        </>
      )}
      {firewallCommand && <FirewallCommand command={firewallCommand} t={t} />}
      {signInRequired && (
        <p className="settings-note" data-iori-state="setup-sign-in-required">
          {t(
            "iori Host starts when {user} signs in to that PC. After it starts, choose the same connection again to register.",
          ).replace("{user}", machine?.user ?? "")}
        </p>
      )}
      {linger && (
        <p className="settings-note">
          {t(
            "iori Host will stop after logout. An administrator can enable it with:",
          )}{" "}
          <code>sudo loginctl enable-linger {machine?.user}</code>
        </p>
      )}
      {stage && (
        <p role="status" data-iori-state="setup-progress">
          <Spinner /> {t(stages[stage] ?? stage)}
        </p>
      )}
      {cancelling && (
        <p role="status" data-iori-state="ssh-cancelling">
          {t("Cancelling SSH…")}
        </p>
      )}
      {cancelled && <p role="status">{t("Cancelled")}</p>}
      {(error || (registered && (state.storageError || state.error))) && (
        <p role="alert" className="connection-error" data-iori-state="error">
          {formatError(
            error ??
              (state.storageError
                ? "Could not save the registration. Retry saving."
                : unreachable),
            t,
          )}
        </p>
      )}
      {controlError && (
        <p className="settings-note">
          {t(
            "Update iori Host on the destination with the installation command, then retry registration.",
          )}{" "}
          {machine?.os === "Windows" ? (
            <code>{`irm ${releaseSource.trim()}/latest/download/install.ps1 | iex`}</code>
          ) : (
            <>
              <code>
                {`curl -fsSL ${releaseSource.trim()}/latest/download/install.sh | sh`}
              </code>
              <br />
              <code>
                {`wget -qO- ${releaseSource.trim()}/latest/download/install.sh | sh`}
              </code>
            </>
          )}
        </p>
      )}
      <div className="connection-actions">
        <Button
          type="button"
          variant="ghost"
          disabled={cancelling}
          data-iori-action="ssh-cancel"
          onClick={() => {
            void cancel().then((stopped) => {
              if (stopped) onClose();
            });
          }}
        >
          {t("Cancel setup")}
        </Button>
        {destination && (
          <Button
            type="button"
            disabled={
              busy || cancelling || !name.trim() || (!!machine && !supported)
            }
            data-iori-action="setup-submit"
            onClick={() => {
              void submit();
            }}
          >
            {t(
              error || cancelled || registered
                ? "Retry"
                : machine?.installed
                  ? "Register with this iori Host"
                  : "Install",
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
