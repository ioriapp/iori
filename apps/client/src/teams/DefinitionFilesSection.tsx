import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CliSummary } from "@iori/protocol";
import { connection } from "../connection.ts";
import { Button } from "../components/ui/button.tsx";
import { Textarea } from "../components/ui/textarea.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs.tsx";
import { useI18n } from "./context.tsx";

export type DefinitionFile =
  | NonNullable<CliSummary["files"]>[number]
  | { name: "definition.json"; kind: "json" };

const jsonFile: DefinitionFile = { name: "definition.json", kind: "json" };
export const definitionFileKey = (file: DefinitionFile) =>
  `${file.kind}:${encodeURIComponent(file.name)}`;
export const definitionJsonKey = definitionFileKey(jsonFile);

export function definitionFiles(cli: CliSummary): DefinitionFile[] {
  return cli.simple || cli.definition === undefined
    ? []
    : [jsonFile, ...(cli.files ?? [])];
}

const definitionFileLabels = {
  json: "Definition JSON",
  usage: "Usage script",
  tokens: "Tokens script",
  plugin: "CLI plugin",
} satisfies Record<DefinitionFile["kind"], string>;

type FileReadStatus =
  { unsupported: true } | { loading: true } | { failed: true };
type FileRead = { text: string } | FileReadStatus;

export function useDefinitionFileReads(host: string) {
  const [reads, setReads] = useState(
    () => new Map<string, ReadonlyMap<string, FileRead>>(),
  );
  const keyOf = (cliId: string) => JSON.stringify([host, cliId]);
  const get = (cliId: string, name: string) =>
    reads.get(keyOf(cliId))?.get(name);
  const load = async (cliId: string, name: string, refresh = false) => {
    const previous = get(cliId, name);
    if (!refresh && previous && "loading" in previous) return;
    const key = keyOf(cliId);
    const pending = { loading: true } as const;
    setReads((current) =>
      new Map(current).set(key, new Map(current.get(key)).set(name, pending)),
    );
    const response = await connection
      .requestHost(host, "cli.definition.file.read", { cliId, name })
      .catch(() => undefined);
    const result: FileRead = response?.ok ? response.result : { failed: true };
    setReads((current) => {
      const files = current.get(key);
      // A save can clear these reads while a request is in flight.
      if (files?.get(name) !== pending) return current;
      return new Map(current).set(key, new Map(files).set(name, result));
    });
  };
  const clear = (cliId: string) => {
    setReads((current) => {
      const next = new Map(current);
      next.delete(keyOf(cliId));
      return next;
    });
  };
  return { get, load, clear };
}

export function DefinitionFileStatus({
  read,
  onRetry,
}: {
  read: FileReadStatus | undefined;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  if (read && "failed" in read) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-3 py-2 text-xs text-foreground"
      >
        <p>{t("Could not load the file.")}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("Retry")}
        </Button>
      </div>
    );
  }
  if (read && "unsupported" in read) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        {t("This file can't be displayed.")}
      </p>
    );
  }
  return (
    <p className="py-2 text-xs text-muted-foreground" role="status">
      {t("Loading")}
    </p>
  );
}

export function DefinitionTextField({
  kind,
  value,
  onChange,
  invalid,
  children,
}: {
  kind: DefinitionFile["kind"];
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const label = t(definitionFileLabels[kind]);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <Textarea
        className="max-h-96 min-h-40 overflow-auto whitespace-pre font-mono text-xs [field-sizing:fixed] [font-variant-ligatures:none]"
        aria-label={label}
        aria-invalid={invalid}
        data-iori-field={kind === "json" ? "cli-definition-json" : undefined}
        spellCheck={false}
        wrap="off"
        rows={14}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {children}
    </div>
  );
}

export function DefinitionFileDisclosure({
  file,
  read,
  open,
  onOpenChange,
  onRetry,
}: {
  file: DefinitionFile;
  read: FileRead | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="flex h-auto min-h-9 w-full items-center justify-between gap-2 rounded-sm px-2 py-2 text-left text-xs font-normal whitespace-normal [@media(pointer:coarse)]:min-h-11"
        >
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <code className="font-mono text-foreground [overflow-wrap:anywhere]">
              {file.name}
            </code>
            <span className="text-xs text-muted-foreground">
              {t(definitionFileLabels[file.kind])}
            </span>
          </span>
          {open ? (
            <ChevronDown
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0 px-2 pt-1 pb-2.5">
        {read && "text" in read ? (
          <pre
            role="region"
            tabIndex={0}
            aria-label={file.name}
            className="max-h-80 overflow-auto whitespace-pre rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-foreground outline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [font-variant-ligatures:none]"
          >
            <code>{read.text}</code>
          </pre>
        ) : (
          <DefinitionFileStatus read={read} onRetry={onRetry} />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DefinitionFileTabs({
  files,
  selected,
  onSelect,
  changed,
  renderFile,
  children,
}: {
  files: DefinitionFile[];
  selected: string;
  onSelect: (file: DefinitionFile) => void;
  changed: (file: DefinitionFile) => boolean;
  renderFile: (file: DefinitionFile) => ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const tabsScroll = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scroller = tabsScroll.current;
    const active = scroller?.querySelector('[data-state="active"]');
    if (!scroller || !active) return;
    const bounds = scroller.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    if (tab.left < bounds.left) scroller.scrollLeft += tab.left - bounds.left;
    if (tab.right > bounds.right)
      scroller.scrollLeft += tab.right - bounds.right;
  }, [selected]);

  return (
    <Tabs
      className="min-w-0 gap-3"
      value={selected}
      onValueChange={(key) => {
        const file = files.find((entry) => definitionFileKey(entry) === key);
        if (file) onSelect(file);
      }}
    >
      <div ref={tabsScroll} className="max-w-full overflow-x-auto pb-0.5">
        <TabsList
          variant="line"
          aria-label={t("Definition")}
          className="w-full justify-start [@media(pointer:coarse)]:min-h-11"
        >
          {files.map((file) => (
            <TabsTrigger
              key={definitionFileKey(file)}
              value={definitionFileKey(file)}
              className="flex-none px-2.5 font-mono text-xs"
            >
              {file.name}
              {changed(file) && (
                <>
                  <span className="text-2xs text-primary" aria-hidden="true">
                    ●
                  </span>
                  <span className="sr-only">{t("Unsaved changes")}</span>
                </>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {files.map((file) => (
        <TabsContent
          key={definitionFileKey(file)}
          value={definitionFileKey(file)}
        >
          {selected === definitionFileKey(file) && renderFile(file)}
        </TabsContent>
      ))}
      {children}
    </Tabs>
  );
}
