import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CliSummary } from "@iori/protocol";
import { connection } from "../connection.ts";
import { FieldRow, LoadRecovery } from "../components/page-layout.tsx";
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
  if (read && "failed" in read)
    return (
      <LoadRecovery
        message={t("Could not load the file.")}
        retryLabel={t("Retry")}
        onRetry={onRetry}
      />
    );
  if (read && "unsupported" in read)
    return (
      <p className="definition-file-message">
        {t("This file can't be displayed.")}
      </p>
    );
  return (
    <p className="definition-file-message" role="status">
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
    <FieldRow stacked label={label} className="field-code">
      <Textarea
        className="cli-def-json"
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
    </FieldRow>
  );
}

function useScrollEdges<T extends HTMLElement>() {
  return useCallback((element: T | null) => {
    if (!element) return;
    let mounted = true;
    const update = () => {
      if (!mounted) return;
      element.dataset.overflow = String(
        element.scrollTop + element.clientHeight < element.scrollHeight - 1,
      );
      element.dataset.right = String(
        element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
      );
      element.dataset.left = String(element.scrollLeft > 1);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener("scroll", update);
    void document.fonts.ready.then(update);
    update();
    return () => {
      mounted = false;
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, []);
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
  const measureScroll = useScrollEdges<HTMLPreElement>();
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="definition-file-trigger">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <code>{file.name}</code>
            <span className="definition-file-kind">
              {t(definitionFileLabels[file.kind])}
            </span>
          </span>
          {open ? (
            <ChevronDown aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="definition-read-panel">
        {read && "text" in read ? (
          <pre
            ref={measureScroll}
            role="region"
            tabIndex={0}
            aria-label={file.name}
            className="definition-read-code rounded-md border px-3 py-2 text-xs outline-offset-2"
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
  const measureTabs = useScrollEdges<HTMLDivElement>();
  const setTabsScroll = useCallback(
    (element: HTMLDivElement | null) => {
      tabsScroll.current = element;
      return measureTabs(element);
    },
    [measureTabs],
  );
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
      className="definition-tabs"
      value={selected}
      onValueChange={(key) => {
        const file = files.find((entry) => definitionFileKey(entry) === key);
        if (file) onSelect(file);
      }}
    >
      <div className="definition-tabs-scroll" ref={setTabsScroll}>
        <TabsList variant="line" aria-label={t("Definition")}>
          {files.map((file) => (
            <TabsTrigger
              key={definitionFileKey(file)}
              value={definitionFileKey(file)}
            >
              {file.name}
              {changed(file) && (
                <>
                  <span className="text-[0.625rem]" aria-hidden="true">
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
