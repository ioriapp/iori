// Development only: Vite never resolves this module for a product build.
import { isTauri } from "@tauri-apps/api/core";
import * as tauri from "./native-platform-tauri.ts";

declare const __IORI_WEB_BRIDGE_URL__: string;

type Receiver = (event: { payload: unknown }) => void;
const listeners = new Map<string, Set<Receiver>>();
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let nextId = 0;
const fileSaves = new Map<string, FileSystemWritableFileStream>();
declare global {
  interface Window {
    showSaveFilePicker: (options: {
      suggestedName: string;
    }) => Promise<FileSystemFileHandle>;
  }
}
let socket: WebSocket | undefined;
let opening: Promise<WebSocket> | undefined;

// Development counterpart of the OS click queue, consumed by the same controller.
const notificationClicks: unknown[] = [];
window.addEventListener("iori:notification-click", (event) => {
  notificationClicks.push((event as CustomEvent<unknown>).detail);
  deliver("native://notification-pending", undefined);
});

function deliver(event: string, payload: unknown) {
  for (const fn of [...(listeners.get(event) ?? [])]) fn({ payload });
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  if (opening) return opening;
  const ws = new WebSocket(__IORI_WEB_BRIDGE_URL__);
  socket = ws;
  opening = new Promise<WebSocket>((resolve, reject) => {
    ws.addEventListener("open", () => {
      opening = undefined;
      resolve(ws);
    });
    ws.addEventListener("error", () => {
      reject(new Error("開発用bridgeへ接続できません。起動し直してください。"));
    });
    ws.addEventListener("close", () => {
      opening = undefined;
      const error = new Error(
        "開発用bridgeとの接続が閉じました。読み直してください。",
      );
      reject(error);
      for (const call of pending.values()) call.reject(error);
      pending.clear();
      // No requests are replayed. A page reload opens a fresh bridge session.
    });
    ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data)) as {
        id?: number;
        event?: string;
        payload?: unknown;
        result?: unknown;
        error?: string;
      };
      if (message.event) deliver(message.event, message.payload);
      else if (message.id !== undefined) {
        const call = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) call?.reject(new Error(message.error));
        else call?.resolve(message.result);
      }
    });
  });
  return opening;
}

export async function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (isTauri()) return tauri.invoke<T>(command, args);
  if (command === "native_file_save_begin") {
    try {
      const target = await window.showSaveFilePicker({
        suggestedName: String(args.name),
      });
      const stream = await target.createWritable();
      const id = crypto.randomUUID();
      fileSaves.set(id, stream);
      return id as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        return null as T;
      throw error;
    }
  }
  if (command === "native_file_save_write") {
    const stream = fileSaves.get(String(args.id));
    if (!stream) throw new Error("Save closed");
    await stream.write(
      Uint8Array.from(atob(String(args.data)), (value) => value.charCodeAt(0)),
    );
    return undefined as T;
  }
  if (
    command === "native_file_save_finish" ||
    command === "native_file_save_cancel"
  ) {
    const id = String(args.id),
      stream = fileSaves.get(id);
    fileSaves.delete(id);
    if (stream) {
      if (command === "native_file_save_finish") await stream.close();
      else await stream.abort();
    }
    return undefined as T;
  }
  // Browser/OS gestures stay in Chromium, rather than changing this LXC's clipboard.
  if (command === "native_clipboard_content") {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!item.types.includes("text/plain")) continue;
      const text = await (await item.getType("text/plain")).text();
      if (text) return { text } as T;
    }
    for (const item of items) {
      if (!item.types.includes("image/png")) continue;
      return { png: await item.getType("image/png") } as T;
    }
    return { text: "" } as T;
  }
  if (command === "native_clipboard_read")
    return (await navigator.clipboard.readText()) as T;
  if (command === "native_clipboard_write") {
    await navigator.clipboard.writeText(String(args.text));
    return undefined as T;
  }
  if (command === "native_open_url") {
    const url = new URL(String(args.url));
    if (!["https:", "http:", "mailto:"].includes(url.protocol))
      throw new Error("unsupported link");
    window.open(url.href, "_blank", "noopener,noreferrer");
    return undefined as T;
  }
  if (
    command === "native_notification_permission" ||
    command === "native_notification_request_permission"
  )
    return "granted" as T;
  if (command === "native_notify") {
    // E2E observes the request at the same boundary as OS delivery. No browser
    // notification is presented or claimed as native acceptance.
    window.dispatchEvent(
      new CustomEvent("iori:notification-request", {
        detail: args.notification,
      }),
    );
    return undefined as T;
  }
  if (
    command === "native_background_connection" ||
    command === "native_client_options"
  )
    return undefined as T;
  if (command === "native_take_notifications")
    return notificationClicks.splice(0) as T;
  if (command === "native_initial_state")
    args = {
      language: navigator.language,
      mobile: matchMedia("(max-width: 767px)").matches,
    };
  const ws = await connect();
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (value) => resolve(value as T), reject });
    try {
      ws.send(JSON.stringify({ id, command, args }));
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

export async function listen<T>(
  event: string,
  fn: (event: { payload: T }) => void,
): Promise<() => void> {
  if (isTauri()) return tauri.listen<T>(event, fn);
  const receiver: Receiver = ({ payload }) => fn({ payload: payload as T });
  const receivers = listeners.get(event) ?? new Set<Receiver>();
  receivers.add(receiver);
  listeners.set(event, receivers);
  const foreground = () =>
    receiver({
      payload: { foreground: document.visibilityState === "visible" },
    });
  if (event === "native://foreground")
    document.addEventListener("visibilitychange", foreground);
  return () => {
    receivers.delete(receiver);
    document.removeEventListener("visibilitychange", foreground);
  };
}

export async function onBackButtonPress(fn: () => void) {
  if (isTauri()) return tauri.onBackButtonPress(fn);
  // The development browser uses Alt+Left for the Android back callback.
  const back = (event: KeyboardEvent) => {
    if (event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      fn();
    }
  };
  window.addEventListener("keydown", back);
  return {
    unregister: async () => window.removeEventListener("keydown", back),
  };
}

export const hasWindowChrome = isTauri() && tauri.hasWindowChrome;
