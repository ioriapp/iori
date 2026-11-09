import { useState, type ReactNode } from "react";
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
  const ja = locale.startsWith("ja");
  const run = async (task: () => void | Promise<void>) => {
    try {
      await task();
      setError(false);
      setOpen(false);
    } catch {
      setError(true);
    }
  };
  const renderAction = (item: MenuAction) => (
    <ContextMenuItem
      key={item.action}
      data-iori-action={item.action}
      disabled={item.disabled}
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
                ".reading-line-text, .reading-markdown",
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
      <ContextMenuContent className="reading-context-menu" collisionPadding={8}>
        {leadingActions.map(renderAction)}
        {leadingActions.length > 0 && <ContextMenuSeparator />}
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void run(() => native.clipboardWrite(path));
          }}
          data-iori-action="copy-path"
        >
          {showIcons && <Copy />}
          {ja ? "パスをコピー" : "Copy path"}
        </ContextMenuItem>
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
            {ja ? "行番号付きのパスをコピー" : "Copy path with line"}
          </ContextMenuItem>
        )}
        {actions.length > 0 && separateActions && <ContextMenuSeparator />}
        {actions.map((item) => renderAction(item))}
        {error && (
          <p className="reading-menu-error" role="alert">
            {ja
              ? "操作できませんでした。もう一度お試しください。"
              : "That did not work. Select it again."}
          </p>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
