import { invoke, listen, onBackButtonPress } from "#native-platform";
export { hasWindowChrome } from "#native-platform";
import type { HostInfo as ProtocolHostInfo } from "@iori/protocol";

export type HostInfo = ProtocolHostInfo & { sshDestination?: string };

export type InitialState = {
  publicKey: string;
  deviceName: string;
  language: string;
  canScanQr: boolean;
  mobile: boolean;
  canSetupHost: boolean;
  canCloseToExit: boolean;
  hosts: HostInfo[];
  activeHostKey: string | null;
};
let mobile = false;
export const native = {
  fileSaveBegin: (name: string) =>
    invoke<string | null>("native_file_save_begin", { name }),
  fileSaveWrite: (id: string, data: string) =>
    invoke<void>("native_file_save_write", { id, data }),
  fileSaveFinish: (id: string) =>
    invoke<void>("native_file_save_finish", { id }),
  fileSaveCancel: (id: string) =>
    invoke<void>("native_file_save_cancel", { id }),
  hostUninstallResult: (hostKey: string, operationId: string, remove = false) =>
    invoke<unknown>("native_host_uninstall_result", {
      hostKey,
      operationId,
      remove,
    }),
  sshUninstallResult: (session: string, receiptPath: string, remove = false) =>
    invoke<unknown>("native_ssh_uninstall_result", {
      session,
      receiptPath,
      remove,
    }),
  sshCandidates: () => invoke<string[]>("native_ssh_candidates"),
  sshConnect: (destination: string, session: string) =>
    invoke<import("./host-setup/SshSetup.tsx").SshMachine>(
      "native_ssh_connect",
      { destination, session },
    ),
  sshInstall: (session: string, installed: boolean, running: boolean) =>
    invoke<{ invite: unknown }>("native_ssh_install", {
      session,
      installed,
      running,
    }),
  sshCancel: (session: string) =>
    invoke<void>("native_ssh_cancel", { session }),
  sshAnswer: (prompt: string, answer: string | null) =>
    invoke<void>("native_ssh_answer", { prompt, answer }),
  onSshSetup: (
    fn: (event: import("./host-setup/SshSetup.tsx").SshEvent) => void,
  ) =>
    listen<import("./host-setup/SshSetup.tsx").SshEvent>(
      "native://ssh-setup",
      ({ payload }) => fn(payload),
    ),
  hostSetupStatus: () =>
    invoke<import("./host-setup/HostSetupDialog.tsx").LocalHost | null>(
      "native_host_setup_status",
    ),
  hostSetupInstall: (allowConnections: boolean) =>
    invoke<boolean>("native_host_setup_install", { allowConnections }),
  hostSetupInvite: () =>
    invoke<{ invite: unknown }>("native_host_setup_invite"),
  hostFirewallStatus: () =>
    invoke<boolean | null>("native_host_firewall_status"),
  hostFirewall: () => invoke<boolean>("native_host_firewall"),
  onHostSetupStage: (fn: (stage: string) => void) =>
    listen<string>("native://host-setup-stage", ({ payload }) => fn(payload)),
  onHostSetupLinger: (fn: () => void) =>
    listen<null>("native://host-setup-linger", () => fn()),
  updateOptions: () =>
    invoke<import("./updates/controller.ts").UpdateOptions | null>(
      "native_update_options",
    ),
  updateCheck: (development = false) =>
    invoke<import("./updates/controller.ts").Available | null>(
      "native_update_check",
      { development },
    ),
  updateDownload: () => invoke<void>("native_update_download"),
  updateInstall: (resume = false) =>
    invoke<string>("native_update_install", { resume }),
  updateResumeInstallation: () =>
    invoke<void>("native_update_resume_installation"),
  onUpdateConfirmation: (fn: (available: boolean) => void) =>
    listen<boolean>("native://update-confirmation", ({ payload }) =>
      fn(payload),
    ),
  onUpdateProgress: (
    fn: (progress: { received: number; total: number }) => void,
  ) =>
    listen<{ received: number; total: number }>(
      "native://update-progress",
      ({ payload }) => fn(payload),
    ),
  isWindowMaximized: () => invoke<boolean>("plugin:window|is_maximized"),
  minimizeWindow: () => invoke<void>("plugin:window|minimize"),
  toggleMaximizeWindow: () => invoke<void>("plugin:window|toggle_maximize"),
  closeWindow: () => invoke<void>("plugin:window|close"),
  onWindowChrome: (
    fn: (state: {
      maximized: boolean;
      hover: boolean;
      pressed: boolean;
    }) => void,
  ) =>
    listen<{ maximized: boolean; hover: boolean; pressed: boolean }>(
      "native://window-chrome",
      ({ payload }) => fn(payload),
    ),
  clientOptions: (closeToExit: boolean, open: string, exit: string) =>
    invoke<void>("native_client_options", { closeToExit, open, exit }),
  notificationPermission: () =>
    invoke<string>("native_notification_permission"),
  requestNotificationPermission: () =>
    invoke<string>("native_notification_request_permission"),
  notify: (notification: import("@iori/protocol").CliNotification) => {
    if (!mobile) return invoke<void>("native_notify", { notification });
    const options = {
      id: notification.id,
      title: notification.title,
      body: notification.body,
      icon: "ic_stat_iori",
      extra: { target: notification.target },
    };
    // Android's official plugin uses sourceJson for notification click intents.
    // Its Rust builder currently omits that field; use the plugin's show command.
    return invoke<void>("plugin:notification|show", {
      ...options,
      sourceJson: JSON.stringify(options),
    });
  },
  backgroundConnection: (enabled: boolean, title: string, body: string) =>
    invoke<void>("native_background_connection", { enabled, title, body }),
  onNotification: (
    fn: (target: import("@iori/protocol").CliNotificationTarget) => void,
  ) => {
    const receive = async () => {
      const targets = await invoke<
        import("@iori/protocol").CliNotificationTarget[]
      >("native_take_notifications");
      for (const target of targets) fn(target);
    };
    return listen("native://notification-pending", () => void receive()).then(
      async (stop) => {
        await receive();
        return stop;
      },
    );
  },
  terminalOpen: (connectionId: string, streamId: string, json: string) =>
    invoke<void>("native_terminal_open", { connectionId, streamId, json }),
  terminalWrite: (streamId: string, json: string) =>
    invoke<void>("native_terminal_write", { streamId, json }),
  terminalAcknowledge: (streamId: string) =>
    invoke<void>("native_terminal_acknowledge", { streamId }),
  terminalDetach: (streamId: string) =>
    invoke<void>("native_terminal_detach", { streamId }),
  onTerminalFrame: (
    fn: (value: {
      connectionId: string;
      streamId: string;
      json: string;
    }) => void,
  ) =>
    listen<{ connectionId: string; streamId: string; json: string }>(
      "native://terminal-frame",
      ({ payload }) => fn(payload),
    ),
  onTerminalEnded: (
    fn: (value: {
      connectionId: string;
      streamId: string;
      reason?: string | null;
    }) => void,
  ) =>
    listen<{ connectionId: string; streamId: string; reason?: string | null }>(
      "native://terminal-ended",
      ({ payload }) => fn(payload),
    ),
  clipboardContent: async (): Promise<
    | { text: string }
    | { image: Blob; extension: "png" | "jpg" | "webp" | "gif" }
  > => {
    const content = await invoke<
      { text: string } | { png: Blob } | ArrayBuffer
    >("native_clipboard_content");
    if (!(content instanceof ArrayBuffer) && "text" in content) return content;
    // The browser bridge supplies a Blob; native Clients return encoded bytes.
    const bytes =
      content instanceof ArrayBuffer
        ? content
        : await content.png.arrayBuffer();
    const header = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
    const matches = (signature: number[], offset = 0) =>
      signature.every((byte, index) => header[offset + index] === byte);
    let extension: "png" | "jpg" | "webp" | "gif";
    let type: string;
    if (matches([137, 80, 78, 71, 13, 10, 26, 10])) {
      extension = "png";
      type = "image/png";
    } else if (matches([255, 216, 255])) {
      extension = "jpg";
      type = "image/jpeg";
    } else if (matches([82, 73, 70, 70]) && matches([87, 69, 66, 80], 8)) {
      extension = "webp";
      type = "image/webp";
    } else if (
      matches([71, 73, 70, 56, 55, 97]) ||
      matches([71, 73, 70, 56, 57, 97])
    ) {
      extension = "gif";
      type = "image/gif";
    } else {
      throw new Error("Unknown image format");
    }
    return { image: new Blob([bytes], { type }), extension };
  },
  clipboardRead: () => invoke<string>("native_clipboard_read"),
  clipboardWrite: (text: string) =>
    invoke<void>("native_clipboard_write", { text }),
  showKeyboard: () => invoke<void>("native_show_keyboard"),
  openUrl: (url: string) => invoke<void>("native_open_url", { url }),
  onBack: async (fn: () => boolean): Promise<() => void> => {
    let disposed = false;
    let listener: Awaited<ReturnType<typeof onBackButtonPress>> | undefined;
    const register = async () => {
      listener = await onBackButtonPress(() => {
        if (fn()) return;
        // Remove our listener before forwarding to Android's normal back handling.
        void (async () => {
          try {
            await listener?.unregister();
            listener = undefined;
            await invoke<void>("native_back_default");
          } finally {
            // The next back press is handled here again, also after a failure.
            if (!disposed && !listener) await register();
          }
        })();
      });
      if (disposed) await listener.unregister();
    };
    await register();
    return () => {
      disposed = true;
      void listener?.unregister();
    };
  },
  /** A View's own saved state, such as the reading position in a file. */
  loadView: <T>(scope: string) =>
    invoke<T | null>("native_load_view", { scope }),
  saveView: (scope: string, value: unknown) =>
    invoke<void>("native_save_view", { scope, value }),
  loadWorkspaceLayout: <T>(scopeKey: string) =>
    invoke<T | null>("native_load_workspace_layout", { scopeKey }),
  saveWorkspaceLayout: (scopeKey: string, layout: unknown) =>
    invoke<void>("native_save_workspace_layout", { scopeKey, layout }),
  loadClientPreferences: <T>() =>
    invoke<T | null>("native_load_client_preferences"),
  saveClientPreferences: (preferences: unknown) =>
    invoke<void>("native_save_client_preferences", { preferences }),
  initial: async () => {
    const state = await invoke<InitialState>("native_initial_state");
    mobile = state.mobile;
    return state;
  },
  saveHost: (host: HostInfo, select = false) =>
    invoke<void>("native_save_host", { host, select }),
  connect: (host: HostInfo) =>
    invoke<{ connectionId: string }>("native_connect", {
      publicKey: host.publicKey,
      addresses: host.addresses,
      relay: host.relay ?? null,
    }),
  request: (connectionId: string, json: string, cancelKey?: string) =>
    invoke<string>("native_request", { connectionId, json, cancelKey }),
  cancelStream: (streamId: string) =>
    invoke<void>("native_cancel_stream", { streamId }),
  subscribe: (connectionId: string, json: string, cancelKey?: string) =>
    invoke<{ subscriptionId: string }>("native_subscribe", {
      connectionId,
      json,
      cancelKey,
    }),
  disconnect: (connectionId: string) =>
    invoke<void>("native_disconnect", { connectionId }),
  scan: () => invoke<string>("native_scan_qr"),
  onStream: (
    fn: (value: {
      connectionId: string;
      subscriptionId: string;
      json: string;
    }) => void,
  ) =>
    listen<{ connectionId: string; subscriptionId: string; json: string }>(
      "native://stream",
      ({ payload }) => fn(payload),
    ),
  onConnectionRoute: (
    fn: (value: {
      hostKey: string;
      connectionId: string;
      route: "direct" | "relay" | null;
    }) => void,
  ) =>
    listen<{
      hostKey: string;
      connectionId: string;
      route: "direct" | "relay" | null;
    }>("native://connection-route", (event) => fn(event.payload)),
  onDisconnected: (
    fn: (value: { connectionId: string; reason: string }) => void,
  ) =>
    listen<{ connectionId: string; reason: string }>(
      "native://disconnected",
      ({ payload }) => fn(payload),
    ),
  onSubscriptionEnded: (
    fn: (value: { connectionId: string; subscriptionId: string }) => void,
  ) =>
    listen<{ connectionId: string; subscriptionId: string }>(
      "native://subscription-ended",
      ({ payload }) => fn(payload),
    ),
  onForeground: (fn: (foreground: boolean) => void) =>
    listen<{ foreground: boolean }>("native://foreground", ({ payload }) =>
      fn(payload.foreground),
    ),
};
