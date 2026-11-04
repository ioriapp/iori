import { useEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";
import type { FolderEntry, HostInfo } from "@iori/protocol";
import { isWindowsHostPath } from "./host-path.ts";
import { connection } from "./connection.ts";
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
    setCanRetry(false);
    setError("");
    if (hostKey) {
      void connection
        .requestHost(hostKey, "folders.browse", {})
        .then((result) => {
          if (!active) return;
          if (!result?.ok) {
            setError("Could not browse Host folders. Retry.");
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
            setError("Could not browse Host folders. Retry.");
            setCanRetry(true);
          }
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
    void connection
      .requestHost(hostKey, "folders.browse", { path: directory })
      .then((result) => {
        if (!active) return;
        if (result?.ok) {
          setEntries(result.result.entries);
          setLoadedPath(directory);
        } else {
          const failure =
            result?.error.code ?? "Could not browse Host folders. Retry.";
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
          setError("Could not browse Host folders. Retry.");
          setCanRetry(true);
        }
      })
      .finally(() => {
        if (active) setBusy(false);
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
        className="folder-dialog"
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
          <div className="folder-dialog-row">
            <span>{t("Host")}</span>
            <Select value={hostKey} onValueChange={onHostChange}>
              <SelectTrigger aria-label={t("Host")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hosts.map((host) => (
                  <SelectItem key={host.publicKey} value={host.publicKey}>
                    {host.hostName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Command
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
          <CommandList className="folder-dialog-list" aria-busy={busy}>
            {error ? (
              <div className="folder-dialog-note" role="alert">
                <p>{t(error)}</p>
                {canRetry && (
                  <Button
                    variant="outline"
                    size="sm"
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
            ) : !directory ? (
              <p className="folder-dialog-note">{t("Enter a folder path.")}</p>
            ) : (
              candidates.map((entry) => (
                <CommandItem
                  key={entry.path}
                  value={entry.path}
                  title={entry.path}
                  className="folder-dialog-item"
                  data-iori-folder-path={entry.path}
                  onSelect={() => descend(entry.path)}
                >
                  <Folder size={14} />
                  <span>{entry.name}</span>
                </CommandItem>
              ))
            )}
            {!busy &&
              !error &&
              ready &&
              directory &&
              candidates.length === 0 && (
                <p className="folder-dialog-note">{t("No matching folders")}</p>
              )}
          </CommandList>
        </Command>
        <div className="folder-dialog-actions">
          <Button variant="outline" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={!input}
            pending={opening}
            data-iori-action="folder-open"
            onClick={() => void open()}
          >
            {t(purpose === "select" ? "Use this folder" : "Open this folder")}{" "}
            <Kbd className="folder-dialog-shortcut">Ctrl+Enter</Kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
