import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Folder, TriangleAlert } from "lucide-react";
import type { FolderEntry, HostInfo } from "@iori/protocol";
import { cn } from "cn";
import { isWindowsHostPath } from "./host-path.ts";
import { connection } from "./connection.ts";
import { Spinner } from "./components/ui/spinner.tsx";
import { Kbd } from "./components/ui/kbd.tsx";
import { Button } from "./components/ui/button.tsx";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "./components/ui/command.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.tsx";

/** Browse the Host by completing a path, then explicitly open or select it. */
export function FolderPicker({
  t,
  hosts,
  hostKey,
  onHostChange,
  onClose,
  onOpen,
  purpose = "open",
}: {
  purpose?: "open" | "select";
  t: (key: string) => string;
  hosts: HostInfo[];
  hostKey?: string;
  onHostChange: (hostKey: string) => void;
  onClose: () => void;
  onOpen: (hostKey: string, path: string) => Promise<string | undefined>;
}) {
  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
  );
  const connectionFailure =
    "Could not connect to the Host. Check that the Host is running, then try again.";
  const browseFailure = () =>
    hostKey && !connection.getSnapshot().connectedHosts.includes(hostKey)
      ? connectionFailure
      : "Could not browse Host folders. Retry.";
  const [connecting, setConnecting] = useState(false);
  const [input, setInput] = useState("");
  const [windows, setWindows] = useState(false);
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [loadedPath, setLoadedPath] = useState<string>();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const inputEdited = useRef(false);
  const [retry, setRetry] = useState(0);
  const [homeRetry, setHomeRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const separator = windows ? "\\" : "/";
  const withSeparator = (path: string) =>
    (windows ? /[\\/]$/u : /\/$/u).test(path) ? path : path + separator;
  const lastSeparator = windows
    ? Math.max(input.lastIndexOf("/"), input.lastIndexOf("\\"))
    : input.lastIndexOf("/");
  const directory = lastSeparator < 0 ? "" : input.slice(0, lastSeparator + 1);
  const query = input.slice(lastSeparator + 1).toLowerCase();
  const candidates =
    loadedPath === directory
      ? entries
          .filter((entry) => entry.name.toLowerCase().includes(query))
          .sort(
            (a, b) =>
              (query.startsWith(".")
                ? 0
                : Number(a.name.startsWith(".")) -
                  Number(b.name.startsWith("."))) ||
              Number(b.name.toLowerCase().startsWith(query)) -
                Number(a.name.toLowerCase().startsWith(query)),
          )
      : [];

  useEffect(() => {
    inputEdited.current = false;
    setInput("");
  }, [hostKey]);

  useEffect(() => {
    let active = true;
    setReady(false);
    setConnecting(
      Boolean(
        hostKey && !connection.getSnapshot().connectedHosts.includes(hostKey),
      ),
    );
    setCanRetry(false);
    setError("");
    if (hostKey) {
      void connection
        .requestHost(hostKey, "folders.browse", {})
        .then((result) => {
          if (!active) return;
          if (!result?.ok) {
            setError(browseFailure());
            setCanRetry(true);
            return;
          }
          const home = result.result.homePath;
          const isWindows = isWindowsHostPath(home);
          setWindows(isWindows);
          if (!inputEdited.current)
            setInput(
              home.replace(isWindows ? /[\\/]+$/u : /\/+$/u, "") +
                (isWindows ? "\\" : "/"),
            );
          setReady(true);
          inputRef.current?.focus();
        })
        .catch(() => {
          if (active) {
            setError(browseFailure());
            setCanRetry(true);
          }
        })
        .finally(() => {
          if (active) setConnecting(false);
        });
    }
    return () => {
      active = false;
    };
  }, [hostKey, homeRetry]);

  useEffect(() => {
    let active = true;
    setLoadedPath(undefined);
    if (!hostKey || !ready) return;
    setError("");
    setCanRetry(false);
    if (!directory) {
      setBusy(false);
      return;
    }
    setBusy(true);
    setConnecting(!connection.getSnapshot().connectedHosts.includes(hostKey));
    void connection
      .requestHost(hostKey, "folders.browse", { path: directory })
      .then((result) => {
        if (!active) return;
        if (result?.ok) {
          setEntries(result.result.entries);
          setLoadedPath(directory);
        } else {
          const failure =
            (!connection.getSnapshot().connectedHosts.includes(hostKey)
              ? connectionFailure
              : result?.error.code) ?? "Could not browse Host folders. Retry.";
          setError(failure);
          setCanRetry(
            ![
              "path_not_found",
              "not_a_directory",
              "permission_denied",
            ].includes(failure),
          );
        }
      })
      .catch(() => {
        if (active) {
          setError(browseFailure());
          setCanRetry(true);
        }
      })
      .finally(() => {
        if (active) {
          setBusy(false);
          setConnecting(false);
        }
      });
    return () => {
      active = false;
    };
  }, [hostKey, directory, ready, retry]);

  useEffect(() => {
    setSelected(candidates[0]?.path ?? "");
  }, [input, entries, loadedPath]);

  const descend = (path: string) => {
    setInput(withSeparator(path));
    inputRef.current?.focus();
  };
  const open = async () => {
    if (!hostKey || !input || opening) return;
    // Preserve filesystem roots: '/' and 'C:\\' must not become empty or drive-relative.
    const trimmed = input.replace(windows ? /[\\/]+$/u : /\/+$/u, "");
    const path =
      !trimmed || (windows && /^[A-Za-z]:$/u.test(trimmed))
        ? trimmed + separator
        : trimmed;
    setOpening(true);
    setError("");
    setCanRetry(false);
    try {
      const failure = await onOpen(hostKey, path);
      if (failure) setError(failure);
    } finally {
      setOpening(false);
    }
  };

  return (
    <Dialog
      open={Boolean(hostKey)}
      onOpenChange={(value) => !value && onClose()}
    >
      <DialogContent
        className="w-[min(35rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover shadow-md sm:max-w-[35rem] max-md:[&_button]:min-h-11 max-md:[&_[data-slot=select-trigger]]:min-h-11 [@media(pointer:coarse)]:[&_button]:min-h-11 [@media(pointer:coarse)]:[&_[data-slot=select-trigger]]:min-h-11"
        data-iori-view="folder-picker"
        onEscapeKeyDown={(event) => {
          if (composing.current || event.isComposing) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t(purpose === "select" ? "Choose folder" : "Add folder")}
          </DialogTitle>
          <DialogDescription>
            {t("Type a path to find a folder.")}
          </DialogDescription>
        </DialogHeader>
        {hosts.length > 1 && (
          <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
            <span>{t("Host")}</span>
            <Select value={hostKey} onValueChange={onHostChange}>
              <SelectTrigger
                className="min-w-0 flex-1 [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:overflow-hidden"
                data-iori-host-key={hostKey}
                aria-label={t("Host")}
                title={
                  hosts.find((host) => host.publicKey === hostKey)?.hostName
                }
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[90] w-(--radix-select-trigger-width) min-w-0 max-w-[calc(100vw-1.5rem)] [&_[data-radix-select-viewport]]:w-full [&_[data-radix-select-viewport]]:min-w-0">
                {hosts.map((host) => (
                  <SelectItem
                    key={host.publicKey}
                    className="min-w-0 pr-8 [@media(pointer:coarse)]:min-h-11 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:overflow-hidden"
                    data-iori-host-key={host.publicKey}
                    value={host.publicKey}
                    title={host.hostName}
                  >
                    <span className="flex w-full min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "inline-block size-2 shrink-0 rounded-full",
                          state.connectedHosts.includes(host.publicKey)
                            ? "bg-status-running"
                            : "bg-status-stopped",
                        )}
                        data-connected={state.connectedHosts.includes(
                          host.publicKey,
                        )}
                        role="img"
                        aria-label={t(
                          state.connectedHosts.includes(host.publicKey)
                            ? "Connected"
                            : "Disconnected",
                        )}
                      />
                      <span
                        className="min-w-0 flex-1 truncate text-left"
                        title={host.hostName}
                      >
                        {host.hostName}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Command
          className="min-w-0"
          shouldFilter={false}
          value={selected}
          onValueChange={setSelected}
          onKeyDownCapture={(event) => {
            if (event.target !== inputRef.current) return;
            if (event.key === "Home" || event.key === "End") {
              event.stopPropagation();
              return;
            }
            if (event.key !== "Enter") return;
            event.stopPropagation();
            if (
              composing.current ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            )
              return;
            event.preventDefault();
            if (event.ctrlKey) void open();
            else if (candidates.some((entry) => entry.path === selected))
              descend(selected);
          }}
        >
          <CommandInput
            ref={inputRef}
            autoFocus
            value={input}
            onValueChange={(value) => {
              inputEdited.current = true;
              setInput(value);
              if (loadedPath === directory) setError("");
            }}
            aria-label={t("Folder path")}
            data-iori-field="folder-path"
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
          />
          <CommandList
            className="h-[min(20rem,45dvh)] min-h-[min(20rem,45dvh)] max-h-[min(20rem,45dvh)] border-y border-border"
            aria-busy={busy || connecting}
          >
            {connecting ? (
              <div
                className="flex min-h-full items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground"
                role="status"
              >
                <Spinner aria-hidden="true" />
                <span>{t("Connecting")}</span>
              </div>
            ) : error ? (
              <div
                className={
                  error === connectionFailure
                    ? "flex min-h-full items-center justify-center px-3 py-6"
                    : "p-2"
                }
              >
                <div
                  className={cn(
                    "grid w-full items-start gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/35 p-3 text-sm text-foreground",
                    error === connectionFailure &&
                      "grid-cols-[1rem_minmax(0,1fr)]",
                  )}
                  role="alert"
                >
                  {error === connectionFailure && (
                    <TriangleAlert
                      className="mt-0.5 size-4 text-status-failed-text"
                      aria-hidden="true"
                    />
                  )}
                  <div className="grid min-w-0 gap-2">
                    <p
                      className={cn(
                        "m-0 [overflow-wrap:anywhere]",
                        error !== connectionFailure &&
                          "text-status-failed-text",
                      )}
                    >
                      {t(error)}
                    </p>
                    {canRetry && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-self-start"
                        onClick={() =>
                          ready
                            ? setRetry((value) => value + 1)
                            : setHomeRetry((value) => value + 1)
                        }
                      >
                        {t("Retry")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : !directory ? (
              <p className="m-2 text-sm text-muted-foreground">
                {t("Enter a folder path.")}
              </p>
            ) : busy && candidates.length === 0 ? (
              <div
                className="flex min-h-full items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground"
                role="status"
              >
                <Spinner aria-hidden="true" />
                <span>{t("Loading")}</span>
              </div>
            ) : (
              candidates.map((entry) => (
                <CommandItem
                  key={entry.path}
                  value={entry.path}
                  title={entry.path}
                  className="flex h-8 w-full justify-start gap-2 px-2 text-sm font-normal [@media(pointer:coarse)]:min-h-11 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
                  data-iori-folder-path={entry.path}
                  onSelect={() => descend(entry.path)}
                >
                  <Folder size={14} />
                  <span className="min-w-0 truncate">{entry.name}</span>
                </CommandItem>
              ))
            )}
            {!busy &&
              !connecting &&
              !error &&
              ready &&
              directory &&
              candidates.length === 0 && (
                <p className="m-2 text-sm text-muted-foreground">
                  {t("No matching folders")}
                </p>
              )}
          </CommandList>
        </Command>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={!input}
            pending={opening}
            data-iori-action="folder-open"
            onClick={() => void open()}
          >
            {t(purpose === "select" ? "Use this folder" : "Add")}{" "}
            <Kbd className="[@media(pointer:coarse)]:hidden">Ctrl+Enter</Kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
