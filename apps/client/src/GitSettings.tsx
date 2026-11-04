import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  GitHubAccounts,
  RepositoryGitSettings as Settings,
} from "@iori/protocol";
import { connection } from "./connection.ts";
import { basename } from "./workspace-panel.tsx";
import { Input } from "./components/ui/input.tsx";
import {
  useSettingsEditor,
  type RegisterSettingsEditor,
} from "./settings-save.ts";
import {
  SettingsSection,
  LoadRecovery,
  FieldRow,
  SectionSave,
} from "./components/page-layout.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.tsx";

type Props = {
  hostKey: string;
  t: (key: string) => string;
  registerEditor?: RegisterSettingsEditor;
};

function useGitHubAccounts(hostKey: string) {
  const [accounts, setAccounts] = useState<GitHubAccounts>();
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await connection.requestHost(
        hostKey,
        "github.accounts",
        {},
      );
      if (!response?.ok) throw new Error();
      setAccounts(response.result);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [hostKey]);
  useEffect(() => {
    void load();
  }, [load]);
  return { accounts, failed, load };
}

function Recovery({
  failed,
  load,
  t,
}: {
  failed: boolean;
  load: () => Promise<void>;
  t: Props["t"];
}) {
  return failed ? (
    <LoadRecovery
      message={t("Could not load settings. Retry.")}
      retryLabel={t("Retry")}
      onRetry={() => void load()}
    />
  ) : null;
}

/** Wrap each command named in a translated sentence in <code>. */
export function withCode(text: string, codes: string[]) {
  const pattern = new RegExp(
    `(${codes.map((code) => code.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})`,
    "u",
  );
  return text
    .split(pattern)
    .map((part, index) =>
      codes.includes(part) ? <code key={index}>{part}</code> : part,
    );
}

export function GitHubSettings({ hostKey, t }: Props) {
  const { accounts, failed, load } = useGitHubAccounts(hostKey);
  return (
    <SettingsSection
      title="GitHub"
      description={withCode(t("This Host uses its gh login."), ["gh"])}
      data-iori-view="github-settings"
    >
      {failed && (
        <div>
          <Recovery failed={failed} load={load} t={t} />
        </div>
      )}
      {accounts &&
        (!accounts.available ? (
          <p data-iori-state="github-missing">
            {withCode(t("gh was not found."), ["gh"])}
          </p>
        ) : accounts.accounts.length === 0 ? (
          <p data-iori-state="github-signed-out">
            {withCode(t("Run gh auth login in a Terminal on this Host."), [
              "gh auth login",
            ])}
          </p>
        ) : (
          <>
            {accounts.accounts.map((account) => (
              <FieldRow
                key={account.login}
                data-iori-github-account={account.login}
                label={account.login}
                description={
                  account.active || !account.verified ? (
                    <>
                      {account.active && (
                        <span data-iori-state="github-active">
                          {t("Active account")}
                        </span>
                      )}
                      {account.active && !account.verified && " · "}
                      {!account.verified && t("Could not verify")}
                    </>
                  ) : undefined
                }
              />
            ))}
            <p className="settings-note">
              {withCode(
                t(
                  "Use gh auth switch in a Terminal on this Host to change the active account.",
                ),
                ["gh auth switch"],
              )}
            </p>
          </>
        ))}
    </SettingsSection>
  );
}

/** Explicitly save a section while preserving edits made during a request. */
function SavedText({
  value: initial,
  onSave,
  label,
  field,
  registerEditor,
  url = false,
  t,
  description,
}: {
  value: string;
  onSave: (value: string) => Promise<string>;
  label: string;
  field: string;
  registerEditor?: RegisterSettingsEditor;
  url?: boolean;
  t: Props["t"];
  description?: string;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const draft = useRef(initial);
  const baseline = useRef(initial);
  useEffect(() => {
    if (draft.current === baseline.current) {
      draft.current = initial;
      setValue(initial);
    }
    baseline.current = initial;
  }, [initial]);
  useSettingsEditor(
    () => draft.current !== baseline.current,
    registerEditor,
    () => {
      draft.current = baseline.current;
      setValue(baseline.current);
      setSaved(false);
      setError("");
    },
  );
  const save = async () => {
    if (busy) return;
    const submitted = draft.current;
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      const result = await onSave(submitted);
      baseline.current = result;
      if (draft.current === submitted) {
        draft.current = result;
        setValue(result);
        setSaved(true);
      }
    } catch (error) {
      setError(
        error instanceof Error && error.message === "url"
          ? "Enter an http or https URL."
          : "Could not save. Press Save or Enter to retry.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection
      title={<label htmlFor={id}>{t(label)}</label>}
      onSave={() => void save()}
    >
      <FieldRow stacked>
        <Input
          id={id}
          value={value}
          data-iori-field={field}
          className="font-mono"
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            draft.current = event.target.value;
            setValue(event.target.value);
            setSaved(false);
            setError("");
          }}
          inputMode={url ? "url" : undefined}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {description && <p className="settings-note">{description}</p>}
      </FieldRow>
      <SectionSave
        t={t}
        busy={busy}
        action={`save-${field}`}
        onSave={() => void save()}
        error={Boolean(error)}
        state="saved"
        message={error ? t(error) : saved ? t("Settings saved") : undefined}
      />
    </SettingsSection>
  );
}

function GitHubAccountSetting({
  hostKey,
  path,
  value,
  automaticAccount,
  t,
}: Props & { path: string; value: string; automaticAccount: string }) {
  const { accounts, failed, load } = useGitHubAccounts(hostKey);
  const [selected, setSelected] = useState(value);
  const [error, setError] = useState(false);
  const pending = useRef<Promise<boolean>>(Promise.resolve(true));
  const selection = useRef(value);
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) {
      selection.current = value;
      setSelected(value);
    }
  }, [value]);
  const save = (next: string) => {
    dirty.current = true;
    selection.current = next;
    setSelected(next);
    setError(false);
    pending.current = pending.current.then(async () => {
      try {
        const response = await connection.requestHost(
          hostKey,
          "repository.git.set",
          { path, githubAccount: next },
        );
        if (!response?.ok) throw new Error();
        if (selection.current === next) dirty.current = false;
        return true;
      } catch {
        if (selection.current === next) {
          setError(true);
          selection.current = value;
          dirty.current = false;
          setSelected(value);
        }
        return false;
      }
    });
  };
  return (
    <SettingsSection>
      <FieldRow
        label={
          <label htmlFor="repository-github-account">
            {t("GitHub account")}
          </label>
        }
      >
        <Recovery failed={failed} load={load} t={t} />
        <Select
          value={selected || "__automatic__"}
          onValueChange={(account) => {
            save(account === "__automatic__" ? "" : account);
          }}
        >
          <SelectTrigger
            id="repository-github-account"
            data-iori-field="repository-github-account"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__automatic__">
              {automaticAccount
                ? t("Automatic ({account})").replace(
                    "{account}",
                    automaticAccount,
                  )
                : t("Automatic")}
            </SelectItem>
            {value &&
              !accounts?.accounts.some(
                (account) => account.login === value,
              ) && <SelectItem value={value}>{value}</SelectItem>}
            {accounts?.accounts.map((account) => (
              <SelectItem
                key={account.login}
                value={account.login}
                data-iori-github-account={account.login}
              >
                {account.login}
                {!account.verified ? `（${t("Could not verify")}）` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>
      {accounts && !accounts.available && (
        <p className="settings-note">{t("gh was not found.")}</p>
      )}
      {accounts?.available && accounts.accounts.length === 0 && (
        <p className="settings-note">
          {t("Run gh auth login in a Terminal on this Host.")
            .split("gh auth login")
            .map((part, index) => (
              <span key={index}>
                {index > 0 && <code>gh auth login</code>}
                {part}
              </span>
            ))}
        </p>
      )}
      {error && (
        <p className="connection-error" role="alert">
          {t("Could not save the account. Choose it again to retry.")}
        </p>
      )}
    </SettingsSection>
  );
}

export function RepositoryGitSettings({
  hostKey,
  path,
  t,
  registerEditor,
}: Props & { path: string }) {
  const [settings, setSettings] = useState<Settings>();
  const [failed, setFailed] = useState(false);
  const reading = useRef(0);
  const load = useCallback(async () => {
    const revision = ++reading.current;
    try {
      const response = await connection.requestHost(
        hostKey,
        "repository.git.settings",
        { path },
      );
      if (revision !== reading.current) return;
      if (!response?.ok) throw new Error();
      setSettings(response.result);
      setFailed(false);
    } catch {
      if (revision === reading.current) setFailed(true);
    }
  }, [hostKey, path]);
  useEffect(() => {
    void load();
    const stop = connection.subscribeHostEvents((host, event) => {
      if (
        host === hostKey &&
        (event.type === "forge.settings.changed" ||
          event.type === "folders.changed")
      )
        void load();
    });
    return () => {
      stop();
    };
  }, [hostKey, load]);
  return (
    <div
      className="git-settings"
      data-iori-view="repository-git-settings"
      data-iori-repository-path={path}
    >
      <Recovery failed={failed} load={load} t={t} />
      {settings && (
        <>
          <SavedText
            value={settings.setupCommand}
            field="repository-setup-command"
            registerEditor={registerEditor}
            label="Command to run after creating a worktree"
            t={t}
            onSave={async (setupCommand) => {
              const response = await connection.requestHost(
                hostKey,
                "repository.git.set",
                { path, setupCommand },
              );
              if (!response?.ok) throw new Error();
              return response.result.setupCommand;
            }}
          />
          <SettingsSection title={t("Remotes and websites")}>
            {settings.remotes.length === 0 && (
              <p className="settings-note">
                {t("No remotes. Add a remote in a Terminal.")}
              </p>
            )}
            {settings.remotes.map((remote) => (
              <div
                className="git-remote"
                key={`${remote.name}:${remote.url}`}
                data-iori-remote-name={remote.name}
                data-iori-forge-host={remote.remoteHost}
              >
                <strong>{remote.name}</strong>
                <p className="git-remote-url">{remote.url}</p>
                {remote.forge && (
                  <p className="settings-note" data-iori-value="remote-website">
                    {remote.forge.label}
                    {remote.forge.id !== "github" ? `（${remote.webUrl}）` : ""}
                  </p>
                )}
                {remote.detecting && (
                  <p
                    className="settings-note"
                    data-iori-state="forge-detecting"
                  >
                    {t("Checking website…")}
                  </p>
                )}
                {remote.remoteHost &&
                  (remote.mapping !== undefined || !remote.forge) && (
                    <>
                      <SavedText
                        value={remote.mapping ?? ""}
                        field="forge-web-url"
                        registerEditor={registerEditor}
                        label="Website URL"
                        url
                        description={t(
                          "Other workspaces using {host}{workspaces} use the same URL.",
                        )
                          .replace("{host}", remote.remoteHost)
                          .replace(
                            "{workspaces}",
                            remote.sharedRepositories.length
                              ? `（${remote.sharedRepositories.map(basename).join("、")}）`
                              : "",
                          )}
                        t={t}
                        onSave={async (value) => {
                          let webUrl = value.trim();
                          if (webUrl) {
                            try {
                              const parsed = new URL(webUrl);
                              if (
                                parsed.protocol !== "http:" &&
                                parsed.protocol !== "https:"
                              )
                                throw new Error();
                              webUrl = parsed.origin;
                            } catch {
                              throw new Error("url");
                            }
                          }
                          const response = webUrl
                            ? await connection.requestHost(
                                hostKey,
                                "forge.mapping.set",
                                { remoteHost: remote.remoteHost!, webUrl },
                              )
                            : await connection.requestHost(
                                hostKey,
                                "forge.mapping.remove",
                                { remoteHost: remote.remoteHost! },
                              );
                          if (!response?.ok) throw new Error();
                          return webUrl;
                        }}
                      />
                    </>
                  )}
              </div>
            ))}
          </SettingsSection>
          {settings.remotes.some((remote) => remote.forge?.id === "github") && (
            <>
              <GitHubAccountSetting
                hostKey={hostKey}
                path={path}
                value={settings.githubAccount}
                automaticAccount={settings.githubAutoAccount}
                t={t}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
