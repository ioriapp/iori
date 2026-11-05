import { useEffect, useRef, useState } from "react";
import { native } from "../native.ts";
import { Button } from "../components/ui/button.tsx";
import { Input } from "../components/ui/input.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import { SshPrompt, type SshPromptValue } from "./SshPrompt.tsx";
import { formatError } from "./ssh-errors.ts";

export function FirewallCommand({
  command,
  target,
  t,
  onBusy,
  onAllowed,
}: {
  command: string;
  target?: string;
  t: (key: string) => string;
  onBusy?: (busy: boolean) => void;
  onAllowed?: () => void;
}) {
  const [copied, setCopied] = useState<string>();
  const [copyError, setCopyError] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [user, setUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState<string>();
  const [prompt, setPrompt] = useState<SshPromptValue>();
  const invalidUser =
    !user ||
    user.startsWith("-") ||
    Array.from(user).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    });
  const session = useRef("");
  const listener = useRef<Promise<() => void> | undefined>(undefined);
  useEffect(() => {
    listener.current = native.onSshSetup((event) => {
      if (event.session !== session.current) return;
      const value = event.value;
      if (value.type === "prompt" && value.id && value.prompt)
        setPrompt({
          id: value.id,
          text: value.prompt,
          notification: value.notification,
        });
      if (value.type === "promptClosed")
        setPrompt((current) =>
          current?.id === value.id ? undefined : current,
        );
      if (value.type === "closed") setPrompt(undefined);
    });
    return () => {
      void native.sshCancel(session.current);
      session.current = "";
      void listener.current?.then((stop) => stop());
    };
  }, []);
  useEffect(() => {
    onBusy?.(busy);
  }, [busy, onBusy]);
  async function allow() {
    if (!target || !user || busy) return;
    const id = crypto.randomUUID();
    session.current = id;
    setBusy(true);
    setError(undefined);
    try {
      await listener.current;
      const result = await native.sshAllow(target, user, id);
      if (session.current !== id) return;
      if (result.allowed) {
        setAllowed(true);
        onAllowed?.();
      } else if (!result.administrator)
        setError(
          t(
            "This account is not running as an administrator. The permission was not added.",
          ),
        );
      else
        setError(
          t("Could not allow connections from other devices.") +
            (result.message ? " " + t(result.message) : ""),
        );
    } catch (cause) {
      if (session.current === id) {
        const message = t("Could not allow connections from other devices.");
        const reason = formatError(String(cause), t);
        setError(reason === message ? message : message + " " + reason);
      }
    } finally {
      if (session.current === id) {
        setBusy(false);
        setPrompt(undefined);
      }
    }
  }
  return (
    <div
      className="settings-note setup-firewall-guidance"
      data-iori-state="setup-firewall-command"
    >
      {allowed ? (
        <p role="status" data-iori-state="setup-firewall-allowed">
          {t("Connections from other devices are allowed.")}
        </p>
      ) : (
        <>
          <p>
            {t(
              "Other devices cannot connect yet. Allow connections in one of these ways.",
            )}
          </p>
          {target && (
            <>
              <Button
                type="button"
                variant="outline"
                data-iori-action="setup-firewall-admin"
                onClick={() => setExpanded(true)}
              >
                {t("Allow with an administrator account…")}
              </Button>
              {expanded && (
                <form
                  className="connection-field"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void allow();
                  }}
                >
                  <label>
                    <span>{t("Administrator user name")}</span>
                    <Input
                      autoComplete="off"
                      value={user}
                      required
                      disabled={busy}
                      data-iori-field="setup-administrator"
                      onChange={(event) => setUser(event.target.value)}
                    />
                  </label>
                  <Button
                    type="submit"
                    disabled={busy || invalidUser}
                    data-iori-action="setup-firewall-allow"
                  >
                    {busy && <Spinner />}
                    {t("Allow")}
                  </Button>
                </form>
              )}
              {prompt && (
                <SshPrompt
                  key={prompt.id}
                  prompt={prompt}
                  t={t}
                  onAnswer={(answer) => {
                    setPrompt(undefined);
                    void native.sshAnswer(prompt.id, answer);
                  }}
                  onCancel={(answer) => {
                    void native
                      .sshAnswer(prompt.id, answer)
                      .then(() => native.sshCancel(session.current));
                  }}
                />
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <p>{t("On that PC, run this in PowerShell as an administrator:")}</p>
          <div className="setup-command">
            <code data-iori-field="setup-command">{command}</code>
            <Button
              type="button"
              variant="outline"
              data-iori-action="copy-setup-command"
              onClick={() => {
                void native.clipboardWrite(command).then(
                  () => {
                    setCopied(command);
                    setCopyError(undefined);
                  },
                  () =>
                    setCopyError(
                      t("Could not copy. Select the text and copy it."),
                    ),
                );
              }}
            >
              {t(copied === command ? "Copied" : "Copy command")}
            </Button>
          </div>
          {copyError && <p role="alert">{copyError}</p>}
          <p>
            {t(
              'If Windows asks on that PC, choose "Allow" (an administrator password is needed).',
            )}
          </p>
        </>
      )}
    </div>
  );
}
