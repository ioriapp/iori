import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  forgeSiteOrigin,
  forgeToken,
  type ForgeIntegrationResults,
  type ForgeSite,
  type ForgeSites,
} from "@iori/protocol";
import { connection } from "./connection.ts";
import { GitHubSettings, withCode } from "./GitSettings.tsx";
import {
  FieldRow,
  LoadRecovery,
  SaveResult,
  SettingsSection,
} from "./components/page-layout.tsx";
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
import {
  useSettingsEditor,
  type RegisterSettingsEditor,
} from "./settings-save.ts";

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
    <div className="integrations-settings" data-iori-view="integrations">
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
  http,
  label = "token",
}: {
  t: T;
  value: string;
  onChange: (value: string) => void;
  storage: ForgeSites["storage"];
  http: boolean;
  label?: string;
}) {
  const id = useId();
  return (
    <FieldRow
      stacked
      label={<label htmlFor={id}>token</label>}
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
        className="font-mono"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {(storage === "file" || http) && (
        <p className="settings-note" data-iori-state="site-token-note">
          {storage === "file" &&
            t(
              "This Host has no OS credential store, so the token is saved in a file in the Host's data folder that only this user can read.",
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
  error,
  action,
  label,
  onCancel,
  onSave,
}: {
  t: T;
  busy: boolean;
  error?: string;
  action: string;
  label: string;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="section-save site-form-actions">
      <SaveResult message={error} error={Boolean(error)} />
      <div className="site-form-buttons">
        <Button
          variant="outline"
          data-iori-action="site-form-cancel"
          onClick={onCancel}
        >
          {t("Cancel")}
        </Button>
        <Button pending={busy} data-iori-action={action} onClick={onSave}>
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
  useSettingsEditor(
    () => Boolean(form && (url.trim() || token)),
    registerEditor,
    closeForm,
  );
  useEffect(() => {
    onNestedBack(removing ? () => setRemoving(undefined) : undefined);
    return () => onNestedBack(undefined);
  }, [onNestedBack, removing]);
  const open = (origin?: string) => {
    closeForm();
    setForm({ origin });
  };
  const save = async () => {
    if (busy || !form) return;
    let origin: string;
    try {
      origin = form.origin ?? forgeSiteOrigin(url);
    } catch {
      setFormError(t("Enter an http or https URL."));
      return;
    }
    let value: string;
    try {
      value = forgeToken(token);
    } catch {
      setFormError(
        token.trim() ? rejectionMessage("token", t) : t("Enter a token."),
      );
      return;
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
      if ("rejected" in response.result)
        setFormError(rejectionMessage(response.result.rejected, t));
      else {
        closeForm();
        void load();
      }
    } catch {
      if (!controller.signal.aborted)
        setFormError(rejectionMessage("error", t));
    } finally {
      if (saving.current === controller) {
        saving.current = undefined;
        setBusy(false);
      }
    }
  };
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
  return (
    <SettingsSection
      title="Forgejo・Gitea"
      description={t(
        "Register a token for each site to also read private repositories and Issues.",
      )}
      data-iori-view="forge-sites"
      onSave={form ? () => void save() : undefined}
    >
      {failed && (
        <div>
          <LoadRecovery
            message={t("Could not load settings. Retry.")}
            retryLabel={t("Retry")}
            onRetry={() => void load()}
          />
        </div>
      )}
      {list?.sites.length === 0 && (
        <p className="settings-note" data-iori-state="no-forge-sites">
          {t("No sites yet.")}
        </p>
      )}
      {list?.sites.map((site) => {
        const state = siteState(site, t, language);
        const unreachable = site.failure?.reason === "unreachable";
        return (
          <div
            key={site.origin}
            className="forge-site"
            data-iori-forge-site={site.origin}
          >
            <FieldRow
              label={<span className="site-url">{site.origin}</span>}
              description={
                <span
                  className={`site-state ${state.problem ? "is-problem" : ""}`}
                  data-iori-state={state.id}
                >
                  {state.text}
                </span>
              }
            >
              {unreachable ? (
                <Button
                  variant="outline"
                  pending={checking === site.origin}
                  data-iori-action="site-retry"
                  onClick={() => void check(site.origin)}
                >
                  {t("Retry")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  data-iori-action={
                    site.token ? "site-replace-token" : "site-register-token"
                  }
                  onClick={() => open(site.origin)}
                >
                  {t(site.token ? "Replace token" : "Register token")}
                </Button>
              )}
              {site.token && (
                <Button
                  variant="outline"
                  data-iori-action="site-remove"
                  onClick={() => setRemoving(site.origin)}
                >
                  {t("Remove")}
                </Button>
              )}
            </FieldRow>
            {site.token?.storage === "file" && list.storage === "os" && (
              <p className="settings-note" data-iori-state="site-token-file">
                {t(
                  "The OS credential store did not accept the token, so it is kept in a file in the Host's data folder that only this user can read.",
                )}
              </p>
            )}
            {rowErrors[site.origin] && (
              <p className="connection-error" role="alert">
                {rowErrors[site.origin]}
              </p>
            )}
            {form?.origin === site.origin && (
              <div className="site-form" data-iori-view="site-form">
                <TokenField
                  t={t}
                  value={token}
                  onChange={(value) => {
                    setToken(value);
                    setFormError(undefined);
                  }}
                  storage={storage}
                  http={site.origin.startsWith("http:")}
                />
                <FormActions
                  t={t}
                  busy={busy}
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
          <div className="site-form" data-iori-view="site-form">
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
              http={url.trim().toLowerCase().startsWith("http:")}
            />
            <FormActions
              t={t}
              busy={busy}
              error={formError}
              action="site-add-save"
              label="Add"
              onCancel={closeForm}
              onSave={() => void save()}
            />
          </div>
        ) : (
          <div>
            <Button
              variant="outline"
              data-iori-action="site-add"
              onClick={() => open()}
            >
              <Plus size={16} aria-hidden="true" />
              {t("Add site")}
            </Button>
          </div>
        ))}
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
        className="font-mono"
        onChange={(event) => onChange(event.target.value)}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
    </FieldRow>
  );
}
