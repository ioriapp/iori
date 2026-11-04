export { invoke } from "@tauri-apps/api/core";
export { listen } from "@tauri-apps/api/event";
export { onBackButtonPress } from "@tauri-apps/api/app";

// Only the Windows plugin injects this capability before application scripts.
export const hasWindowChrome = "__IORI_WINDOW_CHROME__" in window;
