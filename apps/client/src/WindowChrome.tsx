import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { Button } from "./components/ui/button.tsx";
import { native, hasWindowChrome } from "./native.ts";
import "./window-chrome.css";

export function WindowChrome({ t }: { t: (key: string) => string }) {
  const [state, setState] = useState({
    maximized: false,
    hover: false,
    pressed: false,
  });
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
  return (
    <>
      <div
        className="window-drag-strip"
        data-tauri-drag-region
        onPointerDownCapture={(event) => event.stopPropagation()}
      />
      <div
        className="window-controls"
        data-iori-part="window-controls"
        onPointerDownCapture={(event) => event.stopPropagation()}
      >
        <Button
          tabIndex={-1}
          variant="ghost"
          aria-label={t("Minimize window")}
          data-iori-action="window-minimize"
          onClick={() => void native.minimizeWindow()}
        >
          <Minus className="size-3" />
        </Button>
        <Button
          tabIndex={-1}
          variant="ghost"
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
          className="window-close"
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
