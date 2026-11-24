import { translator } from "../i18n.ts";
import { Fragment, useState, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "../components/ui/context-menu";
import { flushSync } from "react-dom";
import { Copy, ListTree } from "lucide-react";
import { native } from "../native.ts";

export type MenuAction = {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  action: string;
  run: () => void | Promise<void>;
};

/**
 * The right-click (long-press) menu of a path: copy the path, the path with
 * its line or line range, and any actions of the surface it is on.
 */
export function PathMenu({
  children,
  path,
  relativePath,
  lines,
  actions = [],
  leadingActions = [],
  separateActions = true,
  locale = "en",
  selectable = false,
  showIcons = true,
}: {
  children: ReactNode;
  path: string;
  /** Path relative to the open folder, for "Copy relative path". */
  relativePath?: string;
  /** 1-based line or line range for "Copy path with line"; omitted for a whole file. */
  lines?: { start: number; end: number };
  actions?: MenuAction[];
  leadingActions?: MenuAction[];
  separateActions?: boolean;
  locale?: string;
  /** Text surfaces leave touch long-press and selection to the OS. */
  selectable?: boolean;
  showIcons?: boolean;
}) {
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [touch, setTouch] = useState(false);
  const t = translator(locale);
  const run = async (task: () => void | Promise<void>) => {
    try {
      await task();
      setError(false);
      setOpen(false);
    } catch {
      setError(true);
    }
  };
  const renderAction = (item: MenuAction, index: number) => (
    <Fragment key={item.action}>
      {item.separatorBefore && index > 0 && <ContextMenuSeparator />}
      <ContextMenuItem
        data-iori-action={item.action}
        disabled={item.disabled}
        variant={item.destructive ? "destructive" : "default"}
        onSelect={(event) => {
          event.preventDefault();
          void run(item.run);
        }}
      >
        {showIcons && item.icon}
        {item.label}
        {item.shortcut && (
          <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>
        )}
      </ContextMenuItem>
    </Fragment>
  );
  return (
    <ContextMenu
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setError(false);
      }}
    >
      <ContextMenuTrigger
        asChild
        selectable={selectable}
        disabled={selectable && touch}
        style={selectable ? { WebkitTouchCallout: "default" } : undefined}
        onPointerDownCapture={(event) => {
          if (!selectable) return;
          const nativeSelection =
            event.pointerType !== "mouse" &&
            Boolean(
              (event.target as Element).closest(
                ".reading-line-text, .reading-markdown, .cm-content",
              ),
            );
          // The trigger must know before this pointerdown bubbles whether Radix
          // or the OS owns its long press, including the first touch on a gutter.
          if (nativeSelection !== touch)
            flushSync(() => setTouch(nativeSelection));
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent collisionPadding={8}>
        {leadingActions.map((item, index) => renderAction(item, index))}
        {leadingActions.length > 0 && <ContextMenuSeparator />}
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void run(() => native.clipboardWrite(path));
          }}
          data-iori-action="copy-path"
        >
          {showIcons && <Copy />}
          {t("Copy path")}
        </ContextMenuItem>
        {relativePath && (
          <ContextMenuItem
            onSelect={(event) => {
              event.preventDefault();
              void run(() => native.clipboardWrite(relativePath));
            }}
            data-iori-action="copy-relative-path"
          >
            {showIcons && <Copy />}
            {t("Copy relative path")}
          </ContextMenuItem>
        )}
        {lines && (
          <ContextMenuItem
            onSelect={(event) => {
              event.preventDefault();
              void run(() =>
                native.clipboardWrite(
                  `${path}:${lines.start}${lines.end !== lines.start ? `-${lines.end}` : ""}`,
                ),
              );
            }}
            data-iori-action="copy-line-path"
          >
            {showIcons && <ListTree />}
            {t("Copy path with line")}
          </ContextMenuItem>
        )}
        {actions.length > 0 && separateActions && <ContextMenuSeparator />}
        {actions.map((item, index) => renderAction(item, index))}
        {error && (
          <p className="mx-2 my-1 text-xs text-status-failed-text" role="alert">
            {t("That did not work. Select it again.")}
          </p>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
