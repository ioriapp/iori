import { useEffect, useState } from "react";
import { FileCode } from "lucide-react";
import type { FileEntry } from "@iori/protocol";
import { translator } from "../i18n.ts";
import {
  isAbort,
  readErrorCopy,
  type ReadingTransport,
} from "../reading/transport.ts";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "../components/ui/command";

const parentOf = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};

const isOpenableFile = (entry: FileEntry) =>
  entry.kind === "file" ||
  (entry.kind === "symlink" &&
    entry.targetKind === "file" &&
    entry.symlinkTarget === "inside_root");

export type QuickOpenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transport: ReadingTransport;
  root: string;
  locale: string;
  onSelect: (path: string) => void;
};

export function QuickOpenDialog({
  open,
  onOpenChange,
  transport,
  root,
  locale,
  onSelect,
}: QuickOpenDialogProps) {
  const t = translator(locale);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) {
      setQuery("");
      setError(undefined);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void (async () => {
      try {
        const result = await transport.request(
          "files.find",
          { root, query, start: 0, count: 50 },
          controller.signal,
        );
        if (!controller.signal.aborted) setEntries(result.entries);
      } catch (cause) {
        if (controller.signal.aborted || isAbort(cause)) return;
        if (query === "") {
          try {
            const list = await transport.request(
              "files.list",
              { root, path: "", start: 0, count: 50 },
              controller.signal,
            );
            if (!controller.signal.aborted)
              setEntries(list.entries.filter(isOpenableFile));
            return;
          } catch (fallbackCause) {
            if (controller.signal.aborted || isAbort(fallbackCause)) return;
            setEntries([]);
            setError(readErrorCopy(fallbackCause, locale));
            return;
          }
        }
        setEntries([]);
        setError(readErrorCopy(cause, locale));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, transport, root, query, locale]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Go to file")}
      description={t("Type a file name to open…")}
    >
      <Command shouldFilter={false} data-iori-view="quick-open">
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("Type a file name to open…")}
          data-iori-field="quick-open-input"
        />
        <CommandList>
          {error ? (
            <p
              className="px-3 py-4 text-center text-xs text-status-failed-text"
              role="alert"
            >
              {error}
            </p>
          ) : !loading && entries.length === 0 ? (
            <CommandEmpty>{t("No matches")}</CommandEmpty>
          ) : (
            entries.map((entry) => {
              const parent = parentOf(entry.path);
              return (
                <CommandItem
                  key={entry.path}
                  value={entry.path}
                  data-iori-file={entry.path}
                  className="[@media(pointer:coarse)]:min-h-10"
                  onSelect={() => {
                    onSelect(entry.path);
                    onOpenChange(false);
                  }}
                >
                  <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 shrink-0 font-medium text-foreground">
                    {entry.name}
                  </span>
                  {parent && (
                    <span className="min-w-0 truncate text-muted-foreground">
                      {parent}
                    </span>
                  )}
                </CommandItem>
              );
            })
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
