import { useEffect, useId, useState, type ReactNode } from "react";
import { FlowDialog, type FooterSpec } from "../components/flow/FlowDialog.tsx";
import { Progress, type Step } from "../components/flow/Progress.tsx";
import {
  Command,
  Connecting,
  Failure,
  P,
  SshOriginal,
  Status,
  Text,
  Warning,
} from "../components/flow/Notice.tsx";
import { SettingsSection } from "../components/page-layout.tsx";
import { Button } from "../components/ui/button.tsx";
import { Checkbox } from "../components/ui/checkbox.tsx";
import { Input } from "../components/ui/input.tsx";
import { HostMaintenanceWork, stages } from "./HostMaintenanceDetails.tsx";
import { notices } from "../notices.ts";
import type { SshPrompt } from "../host-setup/ssh-events.ts";
import { failureMessage, shellArgument } from "../host-setup/ssh-errors.ts";
import type {
  UninstallFailure,
  UninstallFlow,
  UninstallLog,
  UninstallStep,
} from "./uninstall-flow-types.ts";

/** 処理の担当が実装する第2.2節の入口。画面は store の実装に依存しない。 */
export interface UninstallActions {
  open(hostKey: string): Promise<void>;
  retryPlan(hostKey: string): Promise<void>;
  start(hostKey: string, options: { deleteData: boolean }): Promise<void>;
  answerPrompt(hostKey: string, answer: string): void;
  startWithoutResult(hostKey: string): Promise<void>;
  cancel(hostKey: string): Promise<void>;
  retry(hostKey: string): Promise<void>;
  close(hostKey: string): void;
  dismiss(hostKey: string): void;
}
type Translate = (key: string) => string;
const stepKeys: Record<UninstallStep, string> = {
  settings: "Remove iori settings",
  work: "Stop work",
  remove: "Delete iori Host",
  result: "Check the result",
};
const stepOrder: UninstallStep[] = ["settings", "work", "remove", "result"];
function onHost(t: Translate, key: string, host: string) {
  return t(key).replaceAll("{host}", () => host);
}

/** 設定を閉じた後の「詳細」は、保持した結果をそのまま画面へ渡す。 */
export function showUninstallNotice(
  flow: UninstallFlow,
  t: Translate,
  openDetail: (flow: UninstallFlow) => void,
): void {
  const phase = flow.phase;
  if (
    phase.type !== "done" &&
    phase.type !== "failed" &&
    phase.type !== "sshLost"
  )
    return;
  const failed = phase.type !== "done";
  const warning =
    phase.type === "done" &&
    (phase.outcome.type === "tokensRemaining" ||
      phase.outcome.type === "filesRemaining");
  const key =
    phase.type === "sshLost"
      ? "The SSH connection to {host} was lost, so the uninstall result could not be checked."
      : failed
        ? "Could not uninstall iori Host on {host}."
        : warning
          ? "Uninstalled iori Host on {host}. Some items need your attention."
          : phase.type === "done" && phase.outcome.type === "started"
            ? "Started uninstalling iori Host on {host}."
            : phase.type === "done" &&
                phase.outcome.type === "uninstalledWithData"
              ? "Deleted iori Host and its saved data on {host}."
              : "Uninstalled iori Host on {host}.";
  notices.show({
    key: flow.hostKey,
    text: onHost(t, key, flow.hostName),
    dismissible: !warning,
    detail:
      failed || warning
        ? {
            open: () => {
              notices.dismiss(flow.hostKey);
              openDetail(flow);
            },
          }
        : undefined,
  });
}

export function uninstallFailureText(
  failure: UninstallFailure,
  t: Translate,
): string {
  if (
    failure.stage === "hooks" &&
    (failure.osError === "EACCES" || failure.osError === "EPERM")
  )
    return t(
      "The iori entries could not be removed from CLI settings. You do not have permission to change the settings file.",
    );
  if (failure.stage === "terminals")
    return t("Could not stop Terminals and agents.");
  const reasons: Record<string, string> = {
    hooks: "Could not remove iori entries from CLI settings.",
    registration: "Could not remove the automatic startup registration.",
    stop: "Could not stop iori Host.",
    "prepare-removal": "Could not prepare the uninstall.",
    "save-removal": "Could not prepare the uninstall.",
    request: "Could not prepare the uninstall.",
  };
  return t(reasons[failure.stage] ?? "Could not uninstall iori Host.");
}

export function uninstallLogLines(log: UninstallLog[], t: Translate): string[] {
  return log.map((line) => {
    switch (line.kind) {
      case "sshOutput":
        return line.line;
      case "receiptMissing":
        return t("Checking the removal result");
      case "terminalsStopped":
        return t("Stopped Terminals and agents ({count})").replace(
          "{count}",
          String(line.count),
        );
      case "error":
        if (line.stage === "receipt")
          return t(
            "The uninstall result was saved, but its receipt file could not be deleted.",
          );
        return [
          uninstallFailureText(
            {
              step: "settings",
              stage: line.stage ?? "",
              osError: line.osError,
              autostartRestored: true,
              hooksRestored: true,
              terminalsRestored: true,
            },
            t,
          ),
          line.osError,
        ]
          .filter(Boolean)
          .join(": ");
      case "stage": {
        const completed: Record<string, string> = {
          hooks: "Removed iori entries from CLI settings",
          registration: "Removed automatic startup registration",
          stop: "Stopped iori Host",
          terminals: "Stopped Terminals and agents",
          "forge-tokens": "Deleted Forgejo and Gitea tokens",
          program: "Deleted the iori Host program",
          data: "Deleted iori Host saved data",
          receipt: "Checked the uninstall result",
        };
        return t(
          (line.done
            ? completed[line.stage]
            : line.stage === "forge-tokens"
              ? "Deleting Forgejo and Gitea tokens"
              : stages[line.stage]) ??
            stepKeys[line.stage as UninstallStep] ??
            "Uninstalling iori Host",
        );
      }
    }
  });
}

function UninstallPrompt({
  prompt,
  hostName,
  t,
  answer,
}: {
  prompt: SshPrompt;
  hostName: string;
  t: Translate;
  answer: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const id = useId();
  const label =
    prompt.kind === "password"
      ? t("{user}@{host} password")
          .replace("{user}", () => prompt.user ?? "")
          .replace("{host}", () => prompt.host ?? hostName)
      : prompt.kind === "passphrase"
        ? t("Passphrase for {key}").replace("{key}", () => prompt.key ?? "")
        : t("SSH response");
  return (
    <form
      className="ssh-setup-prompt"
      onSubmit={(event) => {
        event.preventDefault();
        answer(prompt.kind === "hostKeyNew" ? "yes" : value);
        setValue("");
      }}
    >
      {prompt.kind === "notification" ? (
        <Status>{t("Touch your security key.")}</Status>
      ) : (
        <>
          {prompt.kind === "hostKeyNew" ? (
            <Text names={[hostName]}>
              {t(
                "This is the first connection to {host} ({address}). Check that the displayed key fingerprint matches the one for {host}.",
              )
                .replaceAll("{host}", () => prompt.host ?? hostName)
                .replace(
                  "{address}",
                  () => prompt.address ?? prompt.host ?? hostName,
                )}
            </Text>
          ) : (
            <label className="label" htmlFor={id}>
              {label}
            </label>
          )}
          {prompt.kind === "hostKeyNew" && <Text>{prompt.fingerprint}</Text>}
          {prompt.kind !== "hostKeyNew" && (
            <Input
              id={id}
              type={prompt.kind === "other" ? "text" : "password"}
              autoComplete="off"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              data-iori-field="ssh-answer"
            />
          )}
          <div className="actions">
            <Button type="submit" size="lg" data-iori-action="ssh-answer">
              {t(prompt.kind === "hostKeyNew" ? "Connect" : "Send")}
            </Button>
          </div>
        </>
      )}
      {prompt.kind !== "password" && prompt.kind !== "passphrase" && (
        <SshOriginal t={t}>{prompt.text}</SshOriginal>
      )}
    </form>
  );
}

export function HostUninstallDialog({
  flow,
  actions,
  connected,
  onOpenTerminal,
  onClose,
  t,
}: {
  flow: UninstallFlow;
  actions: UninstallActions;
  connected: boolean;
  onOpenTerminal: (hostKey: string, terminalId: string) => void;
  onClose: () => void;
  t: Translate;
}) {
  const [deleteData, setDeleteData] = useState(flow.deleteData);
  const { phase, hostKey, hostName } = flow;
  useEffect(() => {
    if (phase.type === "confirming") setDeleteData(flow.deleteData);
  }, [phase.type, flow.deleteData]);
  const names = [hostName];
  const beforeStart = [
    "confirming",
    "sshConnecting",
    "sshPrompt",
    "sshFailed",
  ].includes(phase.type);
  const close = () => {
    if (beforeStart) void actions.cancel(hostKey);
    else actions.close(hostKey);
    onClose();
  };
  let description: ReactNode = hostName;
  const connecting = (
    <span className="host-desc-line">
      <span className="host-flow-name">{hostName}</span> · <Connecting t={t} />
    </span>
  );
  let panel: ReactNode;
  let footer: FooterSpec = {
    focusCancel: phase.type === "confirming",
    onCancel: close,
  };
  const skipHelp = t(
    "When uninstalling without SSH, you will not see whether iori Host has been completely removed.",
  );
  const skip = {
    label: t("Uninstall without SSH"),
    variant: "destructive" as const,
    onClick: () => void actions.startWithoutResult(hostKey),
  };
  const log = uninstallLogLines(flow.log, t);
  const itemsAt = (
    step: UninstallStep,
    completed: UninstallStep[],
    failed = false,
  ): Step[] =>
    stepOrder
      .filter((item) => flow.route !== "remote" || item !== "result")
      .map((item) => ({
        label: t(stepKeys[item]),
        state:
          item === step
            ? failed
              ? "failed"
              : "current"
            : completed.includes(item)
              ? "done"
              : "next",
      }));
  switch (phase.type) {
    case "confirming":
      if (!connected) description = connecting;
      panel = (
        <div className="host-panel-stack">
          <Text names={names}>
            {onHost(t, "Uninstall iori Host on {host}?", hostName)}
          </Text>
          <Text>
            {t(
              "All devices using this Host will no longer be able to connect.",
            )}
          </Text>
          <Text muted>
            {t(
              "The iori Host program and automatic startup registration will be removed, along with entries added by iori to CLI settings. Development files and CLI conversations, settings, and sign-ins will remain.",
            )}
          </Text>
          <div className="host-data-option">
            <label className="host-setup-check">
              <Checkbox
                checked={deleteData}
                onCheckedChange={(checked) => setDeleteData(checked === true)}
                data-iori-field="host-uninstall-data"
              />
              <span>{t("Also delete iori Host saved data")}</span>
            </label>
            <Text muted>
              {t(
                "Device registrations, work records, and Forgejo and Gitea tokens will be deleted. They will remain if this is not selected.",
              )}
            </Text>
          </div>
          {phase.plan?.targets.length ? (
            <HostMaintenanceWork
              plan={phase.plan}
              hostKey={hostKey}
              onOpenTerminal={(key, id) => {
                close();
                onOpenTerminal(key, id);
              }}
              t={t}
            />
          ) : (
            <SettingsSection title={t("Work that will be interrupted")}>
              {phase.planError ? (
                <Failure>
                  <P>
                    {t("Could not load work that will be interrupted. Retry.")}
                  </P>
                  <Button
                    variant="outline"
                    onClick={() => void actions.retryPlan(hostKey)}
                  >
                    {t("Retry")}
                  </Button>
                </Failure>
              ) : phase.plan ? (
                <Text>{t("No work will be interrupted.")}</Text>
              ) : (
                <Status>{t("Checking")}</Status>
              )}
            </SettingsSection>
          )}
        </div>
      );
      footer = {
        ...footer,
        primary: t(
          phase.plan?.targets.length ? "Stop and uninstall" : "Uninstall",
        ),
        primaryDisabled: !connected || !phase.plan,
        onPrimary: () => void actions.start(hostKey, { deleteData }),
      };
      break;
    case "sshConnecting":
      description = connecting;
      panel = null;
      footer.primaryDisabled = true;
      break;
    case "sshPrompt":
      panel = (
        <div className="host-panel-stack">
          {phase.prompt.attempt > 1 && (
            <Failure>
              <P>
                {t(
                  "Could not sign in to {user}@{host}. Check the password and enter it again.",
                )
                  .replace("{user}", () => phase.prompt.user ?? "")
                  .replace("{host}", () => phase.prompt.host ?? hostName)}
              </P>
              <Text muted>{skipHelp}</Text>
            </Failure>
          )}
          <UninstallPrompt
            key={phase.prompt.id}
            prompt={phase.prompt}
            hostName={hostName}
            t={t}
            answer={(value) => actions.answerPrompt(hostKey, value)}
          />
        </div>
      );
      footer.primary = phase.prompt.attempt > 1 ? null : t("Uninstall");
      footer.primaryDisabled = true;
      if (phase.prompt.attempt > 1) footer.secondary = skip;
      break;
    case "sshFailed": {
      const failure = phase.failure;
      panel = (
        <Failure>
          <P names={names}>
            {failure.kind === "clientMissing"
              ? t(
                  "OpenSSH Client was not found. Install OpenSSH Client and try again.",
                )
              : failureMessage(failure, hostName, t)}
          </P>
          {failure.kind === "hostKeyChanged" && failure.address && (
            <Command
              t={t}
            >{`ssh-keygen -R ${shellArgument(failure.address)}`}</Command>
          )}
          <Text muted>{skipHelp}</Text>
          <SshOriginal t={t}>{failure.detail}</SshOriginal>
        </Failure>
      );
      footer = {
        ...footer,
        primary: t("Retry"),
        primaryOutline: true,
        onPrimary: () =>
          void actions.start(hostKey, { deleteData: flow.deleteData }),
        secondary: skip,
      };
      break;
    }
    case "running":
      panel = (
        <Progress
          items={itemsAt(phase.step, phase.completed)}
          log={log}
          t={t}
        />
      );
      footer = {
        ...footer,
        cancel: t("Close"),
        primary: null,
        note: t("Uninstalling will continue after closing"),
      };
      break;
    case "sshLost":
      panel = (
        <Progress
          items={itemsAt("result", ["settings", "work", "remove"], true)}
          log={log}
          t={t}
        >
          <Failure>
            <P names={names}>
              {onHost(
                t,
                "The SSH connection to {host} was lost during uninstall, so the result could not be checked. Retry.",
                hostName,
              )}
            </P>
          </Failure>
        </Progress>
      );
      footer = {
        ...footer,
        cancel: t("Close"),
        primary: t("Retry"),
        primaryOutline: true,
        onPrimary: () => void actions.retry(hostKey),
      };
      break;
    case "failed": {
      const failure = phase.failure;
      const at = stepOrder.indexOf(failure.step);
      panel = (
        <Progress
          items={itemsAt(failure.step, stepOrder.slice(0, at), true)}
          log={log}
          t={t}
        >
          <Failure>
            <P names={names}>
              {[
                t("Could not uninstall iori Host."),
                uninstallFailureText(failure, t) !==
                t("Could not uninstall iori Host.")
                  ? uninstallFailureText(failure, t)
                  : undefined,
                failure.autostartRestored &&
                failure.hooksRestored &&
                failure.terminalsRestored
                  ? t(
                      "iori Host was restored to its state before uninstall and can still be used.",
                    )
                  : !failure.autostartRestored
                    ? onHost(
                        t,
                        "iori Host is running, but will not start automatically after {host} restarts.",
                        hostName,
                      )
                    : undefined,
              ]
                .filter(Boolean)
                .join(" ")}
            </P>
          </Failure>
        </Progress>
      );
      footer = {
        ...footer,
        cancel: t("Close"),
        primary: t("Retry"),
        primaryOutline: true,
        onPrimary: () => void actions.retry(hostKey),
      };
      break;
    }
    case "done": {
      const outcome = phase.outcome;
      panel = (
        <div className="host-panel-stack host-uninstall-result">
          <Text names={names}>
            {onHost(
              t,
              outcome.type === "started"
                ? "Started uninstalling iori Host on {host}."
                : outcome.type === "uninstalledWithData" ||
                    (outcome.type === "tokensRemaining" && outcome.deleteData)
                  ? "Deleted iori Host and its saved data on {host}."
                  : "Uninstalled iori Host on {host}.",
              hostName,
            )}
          </Text>
          {outcome.type === "tokensRemaining" && (
            <Warning>
              <P>
                {t(
                  flow.os === "Windows"
                    ? "Could not delete the tokens for these sites. Revoke each token on its site, then delete it from Credential Manager."
                    : flow.os
                      ? "Could not delete the tokens for these sites. Revoke each token on its site, then delete it from the keyring."
                      : "Could not delete the tokens for these sites. Revoke each token on its site, then delete it from Credential Manager or the keyring.",
                )}
              </P>
              <div className="lines is-plain">
                {outcome.sites.map((site) => (
                  <span key={site}>{site}</span>
                ))}
              </div>
            </Warning>
          )}
          {outcome.type === "filesRemaining" && (
            <Warning>
              <P>{t("Could not delete some iori Host files.")}</P>
              {outcome.processes.length > 0 && (
                <>
                  <P>{t("Could not stop these processes:")}</P>
                  <div className="lines is-plain">
                    {outcome.processes.map((process) => (
                      <span key={process}>{process}</span>
                    ))}
                  </div>
                </>
              )}
              {outcome.paths.length > 0 && (
                <>
                  <P>{t("Remaining folders:")}</P>
                  {outcome.paths.map((path) => (
                    <Command key={path} t={t}>
                      {path}
                    </Command>
                  ))}
                  <P names={names}>
                    {flow.route === "local"
                      ? t("Restart your PC, then delete this folder.")
                      : onHost(
                          t,
                          "Restart {host}, then delete this folder on {host}.",
                          hostName,
                        )}
                  </P>
                </>
              )}
            </Warning>
          )}
        </div>
      );
      footer = { ...footer, cancel: t("Close"), primary: null };
      break;
    }
  }
  return (
    <FlowDialog
      kind="uninstall"
      title={t("iori Host uninstallation")}
      description={description}
      names={names}
      panel={panel}
      footer={footer}
      t={t}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    />
  );
}
