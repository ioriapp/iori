import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  Activity,
  Clipboard,
  Image,
  Maximize2,
  Monitor,
  Send,
  Smartphone,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetClose,
  SheetTrigger,
} from "@/components/ui/sheet";

import type {
  TerminalAccessoryKey,
  TerminalShortcutModifier,
} from "./terminal-accessory-keys.ts";

// Android measurement with the keyboard open: 1 input line leaves 20 Terminal
// rows; 5 input lines leave 17, keeping output readable while writing.
const BATCH_INPUT_MAX_LINES = 5;

export type MobileInputHandle = {
  paste: (text: string) => void;
  contains: (element: HTMLElement) => boolean;
};

type Props = {
  handle: Ref<MobileInputHandle>;
  visible: boolean;
  /** The pane owns this so Android back closes it before leaving the View. */
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  keys: TerminalAccessoryKey[];
  swipeKeys: Map<string, TerminalAccessoryKey>;
  modifiers: TerminalShortcutModifier[];
  attachInput: (input: HTMLTextAreaElement) => () => void;
  showButtonNames: boolean;
  live: boolean;
  desktopWidth: boolean;
  disabled: boolean;
  pasteDisabled: boolean;
  batchText: string;
  onLive: (value: boolean) => void;
  onWidth: (value: boolean) => void;
  onBatchText: (value: string) => void;
  onBatchBlur: () => void;
  onBatchSend: () => boolean;
  onPaste: () => void;
  onImages: (files: File[]) => void;
  onKey: (key: TerminalAccessoryKey) => void;
  t: (key: string) => string;
};

export function MobileInputControls({
  handle,
  visible,
  expanded,
  setExpanded,
  keys,
  swipeKeys,
  modifiers,
  attachInput,
  showButtonNames,
  live,
  desktopWidth,
  disabled,
  batchText,
  onLive,
  onWidth,
  onBatchText,
  onBatchBlur,
  onBatchSend,
  onPaste,
  pasteDisabled,
  onImages,
  onKey,
  t,
}: Props) {
  const imagePicker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const expandedField = useRef<HTMLTextAreaElement>(null);
  const expandedContent = useRef<HTMLDivElement>(null);
  const bindField = useCallback(
    (input: HTMLTextAreaElement | null) => {
      field.current = input;
      if (!input) return;
      const detach = attachInput(input);
      return () => {
        detach();
        field.current = null;
      };
    },
    [attachInput],
  );
  const bindExpandedField = useCallback(
    (input: HTMLTextAreaElement | null) => {
      expandedField.current = input;
      if (!input) return;
      const detach = attachInput(input);
      return () => {
        detach();
        expandedField.current = null;
      };
    },
    [attachInput],
  );
  useImperativeHandle(handle, () => ({
    contains(element) {
      // The expanded sheet is rendered in a portal outside the Terminal pane.
      return expandedContent.current?.contains(element) ?? false;
    },
    paste(text) {
      const textarea = expandedField.current ?? field.current;
      if (!textarea) return;
      textarea.setRangeText(
        text,
        textarea.selectionStart,
        textarea.selectionEnd,
        "end",
      );
      onBatchText(textarea.value);
    },
  }));
  const resizeField = useCallback(() => {
    const textarea = field.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  }, []);
  useLayoutEffect(() => {
    if (visible) resizeField();
  }, [batchText, live, expanded, visible, resizeField]);
  useLayoutEffect(() => {
    const textarea = field.current;
    if (!visible || !textarea) return;
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      const nextWidth = textarea.clientWidth;
      if (nextWidth === width) return;
      width = nextWidth;
      resizeField();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [live, visible, resizeField]);
  const send = () => {
    if (onBatchSend()) setExpanded(false);
  };
  const sendButton = (
    <Button
      type="button"
      variant="secondary"
      size="icon-sm"
      onPointerDown={(event) => event.preventDefault()}
      onClick={send}
      aria-label={t("Send")}
      data-iori-action="terminal-batch-send"
      disabled={disabled || !batchText}
    >
      <Send />
    </Button>
  );
  return (
    <div
      className="mobile-terminal-controls terminal-mobile-controls"
      data-iori-panel="terminal-mobile-controls"
    >
      <div className="mobile-toolbar-row">
        <div className="mobile-key-band terminal-mobile-toggles">
          <Button
            variant={live ? "secondary" : "ghost"}
            size={showButtonNames ? "sm" : "icon-sm"}
            className="mobile-key-button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onLive(!live)}
            aria-pressed={live}
            aria-label={
              live ? t("Switch to batch input") : t("Switch to live input")
            }
            title={
              live ? t("Switch to batch input") : t("Switch to live input")
            }
            data-iori-action={
              live ? "terminal-input-live" : "terminal-input-batch"
            }
          >
            <Activity aria-hidden="true" />
            {showButtonNames && t(live ? "Live" : "Batch")}
          </Button>
          <Button
            variant="ghost"
            size={showButtonNames ? "sm" : "icon-sm"}
            className="mobile-key-button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onWidth(!desktopWidth)}
            aria-label={desktopWidth ? t("Device width") : t("Desktop width")}
            aria-pressed={desktopWidth}
            data-iori-action="terminal-width-toggle"
          >
            {desktopWidth ? <Monitor /> : <Smartphone />}
            {showButtonNames && t(desktopWidth ? "Desktop" : "Phone")}
          </Button>
          <Button
            variant="ghost"
            size={showButtonNames ? "sm" : "icon-sm"}
            className="mobile-paste"
            onPointerDown={(event) => event.preventDefault()}
            onClick={onPaste}
            disabled={pasteDisabled}
            aria-label={t("Paste")}
            data-iori-action="terminal-paste"
          >
            <Clipboard />
            {showButtonNames && t("Paste")}
          </Button>
          <input
            ref={imagePicker}
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={disabled}
            data-iori-field="terminal-images"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              if (files.length) onImages(files);
            }}
          />
          <Button
            variant="ghost"
            size={showButtonNames ? "sm" : "icon-sm"}
            className="mobile-paste"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => imagePicker.current?.click()}
            disabled={disabled}
            aria-label={t("Image")}
            data-iori-action="terminal-images"
          >
            <Image />
            {showButtonNames && t("Image")}
          </Button>
          {keys.map((key) => (
            <AccessoryButton
              key={key.id}
              accessory={key}
              swipeKey={swipeKeys.get(key.id)}
              pressed={
                key.modifier ? modifiers.includes(key.modifier) : undefined
              }
              disabled={disabled}
              onKey={onKey}
              t={t}
            />
          ))}
        </div>
      </div>
      {!live && (
        <Sheet open={expanded} onOpenChange={setExpanded}>
          <div className="mobile-command-input terminal-batch-input">
            <Textarea
              ref={bindField}
              rows={1}
              style={{ maxHeight: `calc(${BATCH_INPUT_MAX_LINES}lh + 16px)` }}
              value={batchText}
              onChange={(event) => onBatchText(event.target.value)}
              onBlur={onBatchBlur}
              placeholder={t("Type a command…")}
              aria-label={t("Type a command…")}
              data-iori-field="terminal-batch-input"
            />
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onPointerDown={(event) => event.preventDefault()}
                aria-label={t("Expand input")}
                data-iori-action="terminal-batch-expand"
              >
                <Maximize2 />
              </Button>
            </SheetTrigger>
            {sendButton}
          </div>
          <SheetContent
            ref={expandedContent}
            side="bottom"
            className="terminal-expanded-input"
            showCloseButton={false}
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              expandedField.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              onBatchBlur();
              event.preventDefault();
              field.current?.focus();
            }}
          >
            <div className="terminal-expanded-header">
              <SheetTitle>{t("Input")}</SheetTitle>
              <SheetClose asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("Close")}
                  data-iori-action="terminal-batch-collapse"
                >
                  <X />
                </Button>
              </SheetClose>
            </div>
            <Textarea
              ref={bindExpandedField}
              value={batchText}
              onChange={(event) => onBatchText(event.target.value)}
              onBlur={onBatchBlur}
              placeholder={t("Type a command…")}
              aria-label={t("Type a command…")}
              data-iori-field="terminal-expanded-input"
            />
            <div className="terminal-expanded-footer">{sendButton}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function AccessoryButton({
  accessory,
  swipeKey,
  pressed,
  disabled,
  onKey,
  t,
}: {
  accessory: TerminalAccessoryKey;
  swipeKey?: TerminalAccessoryKey;
  pressed?: boolean;
  disabled: boolean;
  onKey: (key: TerminalAccessoryKey) => void;
  t: (key: string) => string;
}) {
  const start = useRef<{ x: number; y: number; top: number } | null>(null);
  const suppressClick = useRef(false);
  const [swiping, setSwiping] = useState(false);
  const isSwipe = (x: number, y: number) => {
    const from = start.current;
    // Like Termux's popup, crossing the key's upper edge selects its alternate.
    // Horizontal movement stays with the browser's pan-x scrolling.
    return Boolean(
      from && swipeKey && y < from.top && from.y - y > Math.abs(x - from.x),
    );
  };
  return (
    <Button
      type="button"
      variant={pressed || swiping ? "secondary" : "ghost"}
      size="sm"
      className={`mobile-key-button${swipeKey ? " mobile-key-with-swipe" : ""}`}
      data-iori-key={accessory.id}
      aria-label={t(accessory.accessibilityLabel ?? accessory.label)}
      aria-description={
        swipeKey ? `${t("Swipe up")}: ${swipeKey.label}` : undefined
      }
      aria-pressed={pressed}
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault();
        suppressClick.current = false;
        start.current = {
          x: event.clientX,
          y: event.clientY,
          top: event.currentTarget.getBoundingClientRect().top,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) =>
        setSwiping(isSwipe(event.clientX, event.clientY))
      }
      onPointerUp={(event) => {
        if (isSwipe(event.clientX, event.clientY) && swipeKey) {
          suppressClick.current = true;
          onKey(swipeKey);
        }
        start.current = null;
        setSwiping(false);
      }}
      onPointerCancel={() => {
        start.current = null;
        setSwiping(false);
      }}
      onClick={() => {
        if (!suppressClick.current) onKey(accessory);
      }}
    >
      {swipeKey && (
        <span className="mobile-key-swipe-label" aria-hidden="true">
          {swipeKey.label}
        </span>
      )}
      <span>{accessory.label}</span>
    </Button>
  );
}
