import { useEffect, useLayoutEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { Button } from "./components/ui/button.tsx";
import { hasWindowChrome, native } from "./native.ts";

const WINDOW_CAPTION_HEIGHT = "35px";
const WINDOW_CONTROLS_WIDTH = "138px";

export function WindowChrome({ t }: { t: (key: string) => string }) {
  const [state, setState] = useState({
    maximized: false,
    hover: false,
    pressed: false,
  });

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--window-caption-height", WINDOW_CAPTION_HEIGHT);
    if (hasWindowChrome) {
      root.style.setProperty("--window-controls-width", WINDOW_CONTROLS_WIDTH);
    }
    return () => {
      root.style.removeProperty("--window-controls-width");
    };
  }, []);

  useEffect(() => {
    if (!hasWindowChrome) return;
    const stop = native.onWindowChrome(setState);
    void stop
      .then(() => native.isWindowMaximized())
      .then((maximized) => setState((current) => ({ ...current, maximized })));
    return () => {
      void stop.then((unlisten) => unlisten());
    };
  }, []);

  if (!hasWindowChrome) return null;

  const captionButtonClass =
    "h-8 w-[46px] cursor-default rounded-none border-0 p-0 transform-none data-[hover=true]:bg-muted data-[pressed=true]:bg-muted dark:data-[hover=true]:bg-muted/50 dark:data-[pressed=true]:bg-muted/50";

  return (
    <>
      <div
        className="window-drag-strip fixed inset-x-0 top-0 right-[var(--window-controls-width,138px)] h-[var(--window-caption-height,35px)] bg-sidebar in-[body:has([data-slot=dialog-overlay],[data-slot=sheet-overlay],[data-slot=alert-dialog-overlay])]:pointer-events-auto in-[body:has([data-slot=dialog-overlay],[data-slot=sheet-overlay],[data-slot=alert-dialog-overlay])]:z-[100]"
        data-tauri-drag-region
        onPointerDownCapture={(event) => event.stopPropagation()}
      />
      <div
        className="window-controls pointer-events-auto fixed top-0 right-0 z-[100] flex h-[var(--window-caption-height,35px)] bg-sidebar text-foreground"
        data-iori-part="window-controls"
        onPointerDownCapture={(event) => event.stopPropagation()}
      >
        <Button
          tabIndex={-1}
          variant="ghost"
          className={captionButtonClass}
          aria-label={t("Minimize window")}
          data-iori-action="window-minimize"
          onClick={() => void native.minimizeWindow()}
        >
          <Minus className="size-3" />
        </Button>
        <Button
          tabIndex={-1}
          variant="ghost"
          className={captionButtonClass}
          aria-label={t(state.maximized ? "Restore window" : "Maximize window")}
          data-iori-action="window-maximize"
          data-hover={state.hover}
          data-pressed={state.pressed}
          onClick={() => void native.toggleMaximizeWindow()}
        >
          {state.maximized ? (
            <Copy className="size-3" />
          ) : (
            <Square className="size-3" />
          )}
        </Button>
        <Button
          tabIndex={-1}
          variant="ghost"
          className="window-close h-8 w-[46px] cursor-default rounded-none border-0 p-0 transform-none hover:bg-destructive hover:text-primary-foreground dark:hover:text-foreground"
          data-iori-action="window-close"
          aria-label={t("Close window")}
          onClick={() => void native.closeWindow()}
        >
          <X className="size-3" />
        </Button>
      </div>
    </>
  );
}
