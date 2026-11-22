import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Link2, Plus } from "lucide-react";
import {
  forgeSiteOrigin,
  forgeToken,
  type ForgeIntegrationResults,
  type ForgeSite,
  type ForgeSites,
} from "@iori/protocol";
import { cn } from "cn";
import { connection } from "./connection.ts";
import { GitHubSettings, withCode } from "./GitSettings.tsx";
import { AsyncState } from "./components/AsyncState.tsx";
import {
  FieldRow,
  LoadRecovery,
  SaveResult,
  SettingsSection,
} from "./components/page-layout.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.tsx";
import type { RegisterSettingsEditor } from "./settings-save.ts";
import { useSaveableSettingsEditor } from "./settings/shared.tsx";

type T = (key: string) => string;
type Rejection = Extract<
  ForgeIntegrationResults["forge.token.set"],
  { rejected: string }
>["rejected"];

const scopes = ["read:repository", "read:issue", "read:user"];

/** The Host's Integrations: gh for GitHub, a token per Forgejo/Gitea site. */
export function IntegrationsSettings({
  hostKey,
  t,
  language,
  registerEditor,
  onNestedBack,
}: {
  hostKey: string;
  t: T;
  language: string;
  registerEditor: RegisterSettingsEditor;
  onNestedBack: (close?: () => void) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-7" data-iori-view="integrations">
      <GitHubSettings hostKey={hostKey} t={t} />
      <ForgeSiteSettings
        hostKey={hostKey}
        t={t}
        language={language}
        registerEditor={registerEditor}
        onNestedBack={onNestedBack}
      />
    </div>
  );
}

function siteState(site: ForgeSite, t: T, language: string) {
  const failure = site.failure;
  if (failure?.reason === "unreachable")
    return {
      id: "site-unreachable",
      problem: true,
      text: t("Cannot connect ({time})").replace(
        "{time}",
        new Date(failure.at).toLocaleTimeString(language, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      ),
    };
  if (failure?.reason === "token-invalid")
    return {
      id: "site-token-invalid",
      problem: true,
      text: t("The site does not accept the token"),
    };
  if (failure?.reason === "insufficient-scope")
    return {
      id: "site-insufficient-scope",
      problem: true,
      text: failure.scope
        ? withCode(
            t("The token does not have the {scope} permission").replace(
              "{scope}",
              failure.scope,
            ),
            [failure.scope],
          )
        : t("The token does not have enough permissions"),
    };
  if (site.token)
    return {
      id: "site-registered",
      problem: false,
      text: site.token.account
        ? t("Registered as {account}").replace("{account}", site.token.account)
        : t("Registered"),
    };
  return {
    id: "site-unregistered",
    problem: false,
    text: t("Not registered · reading public repositories only"),
  };
}

function rejectionMessage(rejected: Rejection | "error" | "token", t: T) {
  switch (rejected) {
    case "not-forge":
      return t("The site did not respond as Forgejo or Gitea. Check the URL.");
    case "token-invalid":
      return t("The site did not accept this token.");
    case "unreachable":
      return t("Could not connect to the site.");
    case "token":
      return t("The token contains characters that cannot be used.");
    default:
      return t("Could not save. Press the button or Enter to retry.");
  }
}

/** The token field: cleared after saving and never filled from the Host. */
function TokenField({
  t,
  value,
  onChange,
  storage,
  os,
  http,
  label,
}: {
  t: T;
  value: string;
  onChange: (value: string) => void;
  storage: ForgeSites["storage"];
  os?: string;
  http: boolean;
  label?: string;
}) {
  const id = useId();
  return (
    <FieldRow
      stacked
      label={<label htmlFor={id}>{t("Token")}</label>}
      description={withCode(
        t(
          "Enter a token with the read:repository and read:issue permissions. Add read:user to show the account name and to run automations from issues, and write:repository to let agents create pull requests.",
        ),
        scopes,
      )}
    >
      <Input
        id={id}
        type="password"
        autoComplete="off"
        aria-label={label}
        data-iori-field="site-token"
        className="font-mono [font-variant-ligatures:none]"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {(storage === "file" || http) && (
        <p
          className="m-0 text-xs leading-relaxed text-muted-foreground [word-break:auto-phrase] [text-wrap:pretty]"
          data-iori-state="site-token-note"
        >
          {storage === "file" &&
            t(
              os === "Windows"
                ? "This Host can't use Credential Manager, so the token is saved in a file in the Host's data folder that only this user can read."
                : os
                  ? "This Host has no keyring, so the token is saved in a file in the Host's data folder that only this user can read."
                  : "This Host can't use Credential Manager or a keyring, so the token is saved in a file in the Host's data folder that only this user can read.",
            )}
          {storage === "file" && http && <br />}
          {http &&
            t(
              "With an http site, the token travels over the network without encryption.",
            )}
        </p>
      )}
    </FieldRow>
  );
}

function FormActions({
  t,
  busy,
  dirty,
  error,
  action,
  label,
  onCancel,
  onSave,
}: {
  t: T;
  busy: boolean;
  dirty: boolean;
  error?: string;
  action: string;
  label: string;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {error ? (
          <SaveResult message={error} error />
        ) : dirty ? (
          <Badge variant="waiting">{t("Unsaved changes")}</Badge>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-iori-action="site-form-cancel"
          onClick={onCancel}
        >
          {t("Cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          pending={busy}
          disabled={!dirty}
          data-iori-action={action}
          onClick={onSave}
        >
          {t(label)}
        </Button>
      </div>
    </div>
  );
}

function ForgeSiteSettings({
  hostKey,
  t,
  language,
  registerEditor,
  onNestedBack,
}: {
  hostKey: string;
  t: T;
  language: string;
  registerEditor: RegisterSettingsEditor;
  onNestedBack: (close?: () => void) => void;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const os = (
    state.observedHosts[hostKey] ??
    state.initial?.hosts.find((host) => host.publicKey === hostKey)
  )?.os;
  const [list, setList] = useState<ForgeSites>();
  const [failed, setFailed] = useState(false);
  const reading = useRef(0);
  // One open form at a time: a site's token, or a new site.
  const [form, setForm] = useState<{ origin?: string }>();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [formError, setFormError] = useState<string>();
  // The open form's registration; closing the form cancels it on the Host too.
  const saving = useRef<AbortController>(undefined);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [removeBusy, setRemoveBusy] = useState(false);
  const [checking, setChecking] = useState<string>();
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const formRef = useRef({ form, url, token });
  formRef.current = { form, url, token };

  const load = useCallback(async () => {
    const revision = ++reading.current;
    try {
      const response = await connection.requestHost(hostKey, "forge.sites", {});
      if (revision !== reading.current) return;
      if (!response?.ok) throw new Error();
      setList(response.result);
      setFailed(false);
    } catch {
      if (revision === reading.current) setFailed(true);
    }
  }, [hostKey]);

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
      reading.current++;
      stop();
    };
  }, [hostKey, load]);

  const closeForm = useCallback(() => {
    saving.current?.abort();
    saving.current = undefined;
    setBusy(false);
    setForm(undefined);
    setUrl("");
    setToken("");
    setFormError(undefined);
  }, []);

  useEffect(() => () => saving.current?.abort(), []);

  const formDirty = Boolean(
    form && (form.origin ? token.length > 0 : url.trim() || token),
  );

  const open = (origin?: string) => {
    closeForm();
    setForm({ origin });
  };

  const save = async (): Promise<boolean> => {
    const current = formRef.current;
    if (busy || !current.form) return false;
    let origin: string;
    try {
      origin = current.form.origin ?? forgeSiteOrigin(current.url);
    } catch {
      setFormError(t("Enter an http or https URL."));
      return false;
    }
    let value: string;
    try {
      value = forgeToken(current.token);
    } catch {
      setFormError(
        current.token.trim()
          ? rejectionMessage("token", t)
          : t("Enter a token."),
      );
      return false;
    }
    const controller = new AbortController();
    saving.current = controller;
    setBusy(true);
    setFormError(undefined);
    try {
      const response = await connection.requestHost(
        hostKey,
        "forge.token.set",
        { origin, token: value },
        undefined,
        controller.signal,
      );
      if (!response?.ok) throw new Error();
      if ("rejected" in response.result) {
        setFormError(rejectionMessage(response.result.rejected, t));
        return false;
      }
      closeForm();
      void load();
      return true;
    } catch {
      if (!controller.signal.aborted)
        setFormError(rejectionMessage("error", t));
      return false;
    } finally {
      if (saving.current === controller) {
        saving.current = undefined;
        setBusy(false);
      }
    }
  };

  useSaveableSettingsEditor(
    formDirty,
    () =>
      Boolean(
        formRef.current.form &&
        (formRef.current.form.origin
          ? formRef.current.token.length > 0
          : formRef.current.url.trim() || formRef.current.token),
      ),
    registerEditor,
    closeForm,
    save,
  );

  useEffect(() => {
    onNestedBack(removing ? () => setRemoving(undefined) : undefined);
    return () => onNestedBack(undefined);
  }, [onNestedBack, removing]);

  const rowError = (origin: string, message?: string) =>
    setRowErrors((current) => {
      const next = { ...current };
      if (message) next[origin] = message;
      else delete next[origin];
      return next;
    });

  const check = async (origin: string) => {
    setChecking(origin);
    rowError(origin);
    try {
      const response = await connection.requestHost(
        hostKey,
        "forge.site.check",
        { origin },
      );
      if (!response?.ok) throw new Error();
      void load();
    } catch {
      rowError(origin, t("Could not check the site. Retry."));
    } finally {
      setChecking(undefined);
    }
  };

  const remove = async () => {
    const origin = removing;
    if (!origin) return;
    setRemoveBusy(true);
    try {
      const response = await connection.requestHost(
        hostKey,
        "forge.token.remove",
        { origin },
      );
      if (!response?.ok) throw new Error();
      rowError(origin);
      if (form?.origin === origin) closeForm();
      void load();
    } catch {
      rowError(origin, t("Could not remove the token. Retry."));
    } finally {
      setRemoveBusy(false);
      setRemoving(undefined);
    }
  };

  const storage = list?.storage ?? "os";
  const asyncMode =
    failed && !list
      ? "error"
      : !list
        ? "loading"
        : list.sites.length === 0 && !form
          ? "empty"
          : "ready";

  return (
    <SettingsSection
      title="Forgejo・Gitea"
      description={t(
        "Register a token for each site to also read private repositories and Issues.",
      )}
      data-iori-view="forge-sites"
      onSave={form && formDirty ? () => void save() : undefined}
    >
      <div
        data-section-flush=""
        data-iori-state={asyncMode === "empty" ? "no-forge-sites" : undefined}
      >
        <AsyncState
          mode={asyncMode}
          t={t}
          compact
          skeletonRows={2}
          emptyIcon={<Link2 className="size-4" aria-hidden="true" />}
          emptyTitle={t("No sites yet.")}
          emptyActionLabel={t("Add site")}
          onEmptyAction={() => open()}
          errorTitle={t("Could not load settings. Retry.")}
          retryLabel={t("Retry")}
          onRetry={() => void load()}
          className="border-y-0 px-0"
        >
          <div className="flex flex-col divide-y divide-border-subtle">
            {failed && list && (
              <div className="py-3.5">
                <LoadRecovery
                  message={t("Could not load settings. Retry.")}
                  retryLabel={t("Retry")}
                  onRetry={() => void load()}
                />
              </div>
            )}
            {list?.sites.map((site) => {
              const siteStatus = siteState(site, t, language);
              const unreachable = site.failure?.reason === "unreachable";
              return (
                <div
                  key={site.origin}
                  className="flex min-w-0 flex-col gap-3 py-3.5"
                  data-iori-forge-site={site.origin}
                >
                  <FieldRow
                    label={
                      <span className="[overflow-wrap:anywhere]">
                        {site.origin}
                      </span>
                    }
                    description={
                      <span
                        className={cn(
                          siteStatus.problem && "text-status-failed-text",
                        )}
                        data-iori-state={siteStatus.id}
                      >
                        {siteStatus.text}
                      </span>
                    }
                  >
                    {unreachable ? (
                      <Button
                        variant="outline"
                        size="sm"
                        pending={checking === site.origin}
                        data-iori-action="site-retry"
                        onClick={() => void check(site.origin)}
                      >
                        {t("Retry")}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        data-iori-action={
                          site.token
                            ? "site-replace-token"
                            : "site-register-token"
                        }
                        onClick={() => open(site.origin)}
                      >
                        {t(site.token ? "Replace token" : "Register token")}
                      </Button>
                    )}
                    {site.token && (
                      <Button
                        variant="outline"
                        size="sm"
                        data-iori-action="site-remove"
                        onClick={() => setRemoving(site.origin)}
                      >
                        {t("Remove")}
                      </Button>
                    )}
                  </FieldRow>
                  {site.token?.storage === "file" && list.storage === "os" && (
                    <p
                      className="m-0 text-xs leading-relaxed text-muted-foreground [word-break:auto-phrase] [text-wrap:pretty]"
                      data-iori-state="site-token-file"
                    >
                      {t(
                        os === "Windows"
                          ? "Credential Manager did not accept the token, so it is kept in a file in the Host's data folder that only this user can read."
                          : os
                            ? "The keyring did not accept the token, so it is kept in a file in the Host's data folder that only this user can read."
                            : "Credential Manager or the keyring did not accept the token, so it is kept in a file in the Host's data folder that only this user can read.",
                      )}
                    </p>
                  )}
                  {rowErrors[site.origin] && (
                    <p
                      className="m-0 text-xs text-status-failed-text"
                      role="alert"
                    >
                      {rowErrors[site.origin]}
                    </p>
                  )}
                  {form?.origin === site.origin && (
                    <div
                      className="flex flex-col gap-3 border-l-2 border-border pl-4"
                      data-iori-view="site-form"
                    >
                      <TokenField
                        t={t}
                        value={token}
                        onChange={(value) => {
                          setToken(value);
                          setFormError(undefined);
                        }}
                        storage={storage}
                        os={os}
                        http={site.origin.startsWith("http:")}
                      />
                      <FormActions
                        t={t}
                        busy={busy}
                        dirty={formDirty}
                        error={formError}
                        action="site-token-save"
                        label="Save token"
                        onCancel={closeForm}
                        onSave={() => void save()}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {list &&
              (form && !form.origin ? (
                <div
                  className="flex flex-col gap-3 py-3.5"
                  data-iori-view="site-form"
                >
                  <SiteUrlField
                    t={t}
                    value={url}
                    onChange={(value) => {
                      setUrl(value);
                      setFormError(undefined);
                    }}
                  />
                  <TokenField
                    t={t}
                    label={t("Token for the site to add")}
                    value={token}
                    onChange={(value) => {
                      setToken(value);
                      setFormError(undefined);
                    }}
                    storage={storage}
                    os={os}
                    http={url.trim().toLowerCase().startsWith("http:")}
                  />
                  <FormActions
                    t={t}
                    busy={busy}
                    dirty={formDirty}
                    error={formError}
                    action="site-add-save"
                    label="Add"
                    onCancel={closeForm}
                    onSave={() => void save()}
                  />
                </div>
              ) : (
                <div className="py-3.5">
                  <Button
                    variant="outline"
                    size="sm"
                    data-iori-action="site-add"
                    onClick={() => open()}
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    {t("Add site")}
                  </Button>
                </div>
              ))}
          </div>
        </AsyncState>
      </div>
      <Dialog
        open={Boolean(removing)}
        onOpenChange={(next) => !next && setRemoving(undefined)}
      >
        <DialogContent
          data-iori-view="site-remove-confirmation"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>
              {t("Remove the token for {site}?").replace(
                "{site}",
                removing ?? "",
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                "This removes the token for {site} from this Host. Private repositories and Issues can no longer be read. The token itself stays usable until you revoke it on the site.",
              ).replace("{site}", removing ?? "")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("Cancel")}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              pending={removeBusy}
              data-iori-action="site-remove-confirm"
              onClick={() => void remove()}
            >
              {t("Remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

function SiteUrlField({
  t,
  value,
  onChange,
}: {
  t: T;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <FieldRow stacked label={<label htmlFor={id}>{t("Site URL")}</label>}>
      <Input
        id={id}
        value={value}
        placeholder="https://forgejo.example.com"
        inputMode="url"
        data-iori-field="site-url"
        className="font-mono [font-variant-ligatures:none]"
        onChange={(event) => onChange(event.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
    </FieldRow>
  );
}
