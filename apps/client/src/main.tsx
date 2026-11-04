import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The shared tokens and Dockview base styles load before component styles.
import "./index.css";
import App from "./App";
import { FileTransferDialogs } from "./files/FileUploads.tsx";

// Let component menus handle the event first; suppress only the WebView menu.
document.addEventListener("contextmenu", (event) => {
  if (event.defaultPrevented || !(event.target instanceof Element)) return;
  const target = event.target;
  if (
    target.closest("input, textarea, [data-iori-part='terminal-viewport']") ||
    target.closest<HTMLElement>("[contenteditable]")?.isContentEditable ||
    window.getSelection()?.toString()
  )
    return;
  event.preventDefault();
});

// Keep external file drops from navigating the WebView even with no Files View.
for (const type of ["dragover", "drop"]) {
  window.addEventListener(type, (event) => {
    if ((event as DragEvent).dataTransfer?.types.includes("Files"))
      event.preventDefault();
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <FileTransferDialogs />
  </StrictMode>,
);
