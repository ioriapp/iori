import { useState } from "react";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Failure,
  P,
  Original,
  SshOriginal,
  Status,
  Text,
} from "../components/flow/Notice.tsx";
import type { SshPrompt as Prompt } from "./ssh-events.ts";
import { message } from "./ssh-errors.ts";

export function SshPrompt({
  prompt,
  t,
  onAnswer,
  onCancel,
}: {
  prompt: Prompt;
  t: (key: string) => string;
  onAnswer: (answer: string) => void;
  onCancel?: (answer: string | null) => void;
}) {
  const value = prompt;
  const [answer, setAnswer] = useState("");
  const hostKey = value.kind === "hostKeyNew";
  const notification = value.kind === "notification";
  const values = {
    host: value.host ?? "",
    address: value.address ?? value.host ?? "",
    user: value.user ?? "",
    key: value.key ?? "",
  };
  const secretLabel =
    value.kind === "passphrase"
      ? message(t, "Passphrase for {key}", values)
      : value.kind === "password"
        ? message(t, "{user}@{host} password", values)
        : t("SSH response");
  return (
    <div className="host-panel-stack" data-iori-state="ssh-prompt">
      {value.kind === "password" && value.attempt > 1 && (
        <Failure>
          <P>
            {message(
              t,
              "Could not sign in to {user}@{host}. Check the password and enter it again.",
              values,
            )}
          </P>
        </Failure>
      )}
      <form
        className="ssh-setup-prompt"
        onSubmit={(event) => {
          event.preventDefault();
          const value = hostKey ? "yes" : answer;
          setAnswer("");
          onAnswer(value);
        }}
      >
        {hostKey ? (
          <>
            <Text names={[values.host]}>
              {message(
                t,
                value.address
                  ? "This is the first connection to {host} ({address}). Check that the displayed key fingerprint matches the one for {host}."
                  : "This is the first connection to {host}. Check that the displayed key fingerprint matches the one for {host}.",
                values,
              )}
            </Text>
            {value.fingerprint && (
              <code className="ssh-fingerprint">{value.fingerprint}</code>
            )}
            <SshOriginal t={t}>{prompt.text}</SshOriginal>
          </>
        ) : notification ? (
          <>
            <Status>{t("Touch your security key.")}</Status>
            <SshOriginal t={t}>{prompt.text}</SshOriginal>
          </>
        ) : (
          <>
            {value.kind === "other" || value.kind === "hostKeyChanged" ? (
              <Original>{prompt.text}</Original>
            ) : null}
            <label className="ssh-setup-field">
              <span className="label">{secretLabel}</span>
              <Input
                type="password"
                autoComplete="off"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                data-iori-field="ssh-answer"
              />
            </label>
          </>
        )}
        {!notification && (
          <div className="actions">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => {
                  setAnswer("");
                  onCancel(null);
                }}
                data-iori-action="ssh-cancel"
              >
                {t("Do not connect")}
              </Button>
            )}
            <Button type="submit" size="lg" data-iori-action="ssh-answer">
              {t(hostKey ? "Connect" : "Send")}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
