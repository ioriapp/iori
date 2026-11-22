import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Check, Terminal } from "lucide-react";
import { relayUrl, type HostInfo, type TerminalShell } from "@iori/protocol";
import { connection } from "../connection.ts";
import { AsyncState } from "../components/AsyncState.tsx";
import {
  FieldRow,
  SectionSave,
  SettingsSection as Section,
} from "../components/page-layout.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import { Input } from "../components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import { LocalHostConnections } from "../host-setup/HostSetupDialog.tsx";
import type { RegisterSettingsEditor } from "../settings-save.ts";
import {
  ErrorMessage,
  useSaveableSettingsEditor,
  type Translate,
} from "./shared.tsx";

function AddressSettings({
  t,
  registerEditor,
}: {
  t: Translate;
  registerEditor: RegisterSettingsEditor;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const [address, setAddress] = useState(
    state.host?.addresses.join("\n") ?? "",
  );
  const saved = useRef(address);
  const draft = useRef(address);
  draft.current = address;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState(false);

  const dirty = address !== saved.current;

  const discard = () => {
    draft.current = saved.current;
    setAddress(saved.current);
    setMessage(undefined);
    setError(false);
  };

  const save = async (): Promise<boolean> => {
    if (busy) return false;
    const submitted = draft.current;
    const addresses = submitted
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!addresses.length && !state.host?.relay) {
      setError(true);
      setMessage(t("Enter an address and port."));
      return false;
    }
    setBusy(true);
    setMessage(undefined);
    setError(false);
    try {
      if (JSON.stringify(addresses) !== JSON.stringify(state.host?.addresses))
        await connection.updateAddresses(addresses);
      saved.current = submitted;
      setMessage(t("Settings saved"));
      return true;
    } catch {
      setError(true);
      setMessage(t("Could not update the Host address. Retry saving."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  useSaveableSettingsEditor(
    dirty,
    () => draft.current !== saved.current,
    registerEditor,
    discard,
    save,
  );

  return (
    <Section
      title={t("Address")}
      data-iori-view="connection"
      onSave={() => {
        if (dirty || error) void save();
      }}
    >
      <FieldRow
        stacked
        label={t("Address")}
        hideLabel
        description={t(
          "IP address or name, including port. One address per line.",
        )}
      >
        <Textarea
          data-iori-field="address"
          rows={3}
          className="font-mono [font-variant-ligatures:none]"
          value={address}
          onChange={(event) => {
            draft.current = event.target.value;
            setAddress(event.target.value);
            setMessage(undefined);
            setError(false);
          }}
          placeholder={t("Example: my-host:49171")}
        />
      </FieldRow>
      <SectionSave
        t={t}
        busy={busy}
        dirty={dirty}
        error={error}
        message={message}
        action="save-address"
        onDiscard={discard}
        onSave={() => void save()}
      />
    </Section>
  );
}

function RelaySettings({
  t,
  registerEditor,
}: {
  t: Translate;
  registerEditor: RegisterSettingsEditor;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const [url, setUrl] = useState(state.host?.relay?.url ?? "");
  const [token, setToken] = useState(state.host?.relay?.token ?? "");
  const [status, setStatus] = useState<"saved" | "error" | "url-required">();
  const [busy, setBusy] = useState(false);
  const saved = useRef({ url, token });
  const draft = useRef({ url, token });
  draft.current = { url, token };

  const dirty = url !== saved.current.url || token !== saved.current.token;

  useEffect(() => {
    const next = {
      url: state.host?.relay?.url ?? "",
      token: state.host?.relay?.token ?? "",
    };
    const clean =
      draft.current.url === saved.current.url &&
      draft.current.token === saved.current.token;
    saved.current = next;
    if (clean) {
      draft.current = next;
      setUrl(next.url);
      setToken(next.token);
    }
  }, [state.host?.relay?.url, state.host?.relay?.token]);

  const discard = () => {
    draft.current = saved.current;
    setUrl(saved.current.url);
    setToken(saved.current.token);
    setStatus(undefined);
  };

  const save = async (): Promise<boolean> => {
    if (busy) return false;
    const currentUrl = draft.current.url;
    const currentToken = draft.current.token;
    if (
      !currentUrl.trim() &&
      currentToken &&
      currentToken !== saved.current.token
    ) {
      setStatus("url-required");
      return false;
    }
    const submitted = { url: currentUrl, token: currentToken };
    setBusy(true);
    setStatus(undefined);
    try {
      const relay = currentUrl.trim()
        ? {
            url: relayUrl(currentUrl.trim()),
            ...(currentToken ? { token: currentToken } : {}),
          }
        : undefined;
      const next = { url: relay?.url ?? "", token: relay?.token ?? "" };
      if (
        (next.url !== saved.current.url ||
          next.token !== saved.current.token) &&
        !(await connection.updateRelay(relay))
      )
        throw new Error("save failed");
      saved.current = next;
      if (
        draft.current.url === submitted.url &&
        draft.current.token === submitted.token
      ) {
        draft.current = saved.current;
        setUrl(saved.current.url);
        setToken(saved.current.token);
      }
      setStatus("saved");
      return true;
    } catch {
      setStatus("error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  useSaveableSettingsEditor(
    dirty,
    () =>
      draft.current.url !== saved.current.url ||
      draft.current.token !== saved.current.token,
    registerEditor,
    discard,
    save,
  );

  return (
    <Section
      title="Relay"
      description={t(
        "Use a Relay you provide to connect outside your LAN or VPN. Clear the URL to use direct connections only.",
      )}
      data-iori-view="relay"
      onSave={() => {
        if (dirty || status === "error" || status === "url-required")
          void save();
      }}
    >
      <FieldRow stacked label={t("Relay URL")}>
        <Input
          data-iori-field="relay-url"
          className="font-mono [font-variant-ligatures:none]"
          value={url}
          onChange={(event) => {
            draft.current = { ...draft.current, url: event.target.value };
            setUrl(event.target.value);
            setStatus(undefined);
          }}
          placeholder="https://relay.example.com"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </FieldRow>
      <FieldRow stacked label={t("Relay access token (only if required)")}>
        <Input
          data-iori-field="relay-token"
          type="password"
          className="font-mono [font-variant-ligatures:none]"
          value={token}
          onChange={(event) => {
            draft.current = { ...draft.current, token: event.target.value };
            setToken(event.target.value);
            setStatus(undefined);
          }}
          autoComplete="off"
        />
      </FieldRow>
      {state.host?.relay &&
        state.connected &&
        state.routes[state.host.publicKey] && (
          <p
            className="m-0 text-xs leading-relaxed text-muted-foreground"
            data-iori-state="connection-route"
            data-iori-route={state.routes[state.host.publicKey] ?? undefined}
          >
            {t(
              state.routes[state.host.publicKey] === "relay"
                ? "Connection: Relay"
                : "Connection: Direct",
            )}
          </p>
        )}
      <SectionSave
        t={t}
        busy={busy}
        dirty={dirty}
        action="save-relay"
        onDiscard={discard}
        onSave={() => void save()}
        error={status === "error" || status === "url-required"}
        state={status === "saved" ? "relay-saved" : undefined}
        message={
          status === "saved"
            ? t("Settings saved")
            : status === "url-required"
              ? t("Enter a Relay URL to use an access token.")
              : status === "error"
                ? t(
                    "Could not save Relay settings. Check the URL and token, then save again.",
                  )
                : undefined
        }
      />
    </Section>
  );
}

function DefaultShellSettings({
  hostKey,
  t,
  onDefaultShellChange,
}: {
  hostKey: string;
  t: Translate;
  onDefaultShellChange: (hostKey: string) => void;
}) {
  const [shells, setShells] = useState<TerminalShell[]>([]);
  const [defaultShellId, setDefaultShellId] = useState<string>();
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(false);
    try {
      const response = await connection.requestHost(
        hostKey,
        "terminal.list",
        {},
      );
      if (!response?.ok) {
        setStatus("error");
        return;
      }
      setShells(response.result.shells);
      setDefaultShellId(response.result.defaultShell);
      setStatus("loaded");
    } catch {
      setStatus("error");
    }
  }, [hostKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeDefault = async (shellId: string) => {
    setSaving(true);
    setError(false);
    try {
      const response = await connection.requestHost(
        hostKey,
        "terminal.defaultShell.set",
        { shell: shellId },
      );
      if (!response?.ok) {
        setError(true);
        return;
      }
      setDefaultShellId(response.result.shell);
      onDefaultShellChange(hostKey);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const mode =
    status === "loading"
      ? "loading"
      : status === "error"
        ? "error"
        : shells.length === 0
          ? "empty"
          : "ready";

  return (
    <div data-section-flush="">
      <AsyncState
        mode={mode}
        t={t}
        compact
        skeletonRows={1}
        loadingLabel={t("Loading available shells")}
        emptyIcon={<Terminal className="size-4" aria-hidden="true" />}
        emptyTitle={t("No shells were returned by this Host")}
        errorTitle={t("Could not load shells. Retry.")}
        retryLabel={t("Retry")}
        onRetry={() => void load()}
        className="border-y-0 px-0"
      >
        <FieldRow
          className="py-3.5"
          label={
            <label htmlFor="default-shell-select">{t("Default shell")}</label>
          }
          error={
            error ? (
              <ErrorMessage
                message={t(
                  "Could not change the default shell. Choose it again to retry.",
                )}
              />
            ) : undefined
          }
        >
          <Select
            value={defaultShellId ?? ""}
            onValueChange={(value) => void changeDefault(value)}
            disabled={saving}
          >
            <SelectTrigger
              id="default-shell-select"
              className="w-56 max-w-full max-sm:w-full"
              data-iori-action="default-shell-select"
            >
              <SelectValue placeholder={t("Select a shell")} />
            </SelectTrigger>
            <SelectContent>
              {shells.map((shell) => (
                <SelectItem
                  key={shell.id}
                  value={shell.id}
                  data-iori-shell-id={shell.id}
                >
                  {shell.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
      </AsyncState>
    </div>
  );
}

export function ConnectionSettings({
  host,
  state,
  disconnectedSeconds,
  onDefaultShellChange,
  registerEditor,
  forgettingHost,
  setForgettingHost,
  t,
}: {
  host: HostInfo;
  state: ReturnType<typeof connection.getSnapshot>;
  disconnectedSeconds: number;
  onDefaultShellChange: (hostKey: string) => void;
  registerEditor: RegisterSettingsEditor;
  forgettingHost?: { publicKey: string; hostName: string };
  setForgettingHost: (next?: { publicKey: string; hostName: string }) => void;
  t: Translate;
}) {
  const [forgetBusy, setForgetBusy] = useState(false);
  const [forgetError, setForgetError] = useState(false);

  return (
    <>
      <Section data-iori-view="terminal-settings">
        <FieldRow
          label={t("Status")}
          data-iori-row="connection-status"
          data-iori-state={
            state.connected
              ? "connected"
              : state.revoked
                ? "revoked"
                : "disconnected"
          }
        >
          {state.connected ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-status-running-text">
              <Check className="size-3.5" aria-hidden="true" />
              {t("Connected")}
            </span>
          ) : !state.revoked && disconnectedSeconds >= 5 ? (
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              {t("Reconnecting…")}
              <Button
                variant="outline"
                size="sm"
                data-iori-action="reconnect"
                onClick={() => void connection.reconnect()}
              >
                {t("Reconnect")}
              </Button>
            </span>
          ) : (
            <span />
          )}
        </FieldRow>
        <DefaultShellSettings
          key={`shell:${host.publicKey}`}
          hostKey={host.publicKey}
          t={t}
          onDefaultShellChange={onDefaultShellChange}
        />
      </Section>
      <AddressSettings
        key={host.publicKey}
        t={t}
        registerEditor={registerEditor}
      />
      <RelaySettings
        key={`relay:${host.publicKey}`}
        t={t}
        registerEditor={registerEditor}
      />
      {state.initial?.canSetupHost && (
        <LocalHostConnections
          key={`local-connections:${host.publicKey}`}
          hostKey={host.publicKey}
          connectionScope={host.connectionScope}
          t={t}
        />
      )}
      <div className="mt-7 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          data-iori-action="host-forget"
          onClick={() => {
            setForgetError(false);
            setForgettingHost(host);
          }}
        >
          {t("Remove from list")}
        </Button>
      </div>
      <Dialog
        open={Boolean(forgettingHost)}
        onOpenChange={(open) => {
          if (!open) setForgettingHost(undefined);
        }}
      >
        <DialogContent data-iori-view="host-forget-confirmation">
          <DialogHeader>
            <DialogTitle>
              {t("Remove “{name}” from the list?").replace(
                "{name}",
                forgettingHost?.hostName ?? "",
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                "This removes only this Client’s list entry and connection information. Device registrations, data and programs on the Host stay unchanged. To use this Host again, connect with an invitation.",
              )}
            </DialogDescription>
          </DialogHeader>
          {forgetError && (
            <ErrorMessage
              message={t("Could not remove this Host from the list. Retry.")}
            />
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("Cancel")}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              pending={forgetBusy}
              data-iori-action="host-forget-confirm"
              onClick={() => {
                if (!forgettingHost) return;
                setForgetBusy(true);
                setForgetError(false);
                void connection
                  .forgetHost(forgettingHost.publicKey)
                  .then(() => setForgettingHost(undefined))
                  .catch(() => setForgetError(true))
                  .finally(() => setForgetBusy(false));
              }}
            >
              {t("Remove from list")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
