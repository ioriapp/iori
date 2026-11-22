import { PushNotifications } from "./push-notifications.ts";
import {
  readConnectionScope,
  allowNetworkConnections,
} from "./connection-scope.ts";
import { FileUploads } from "./files-writing.ts";
import { AutomationManager } from "./automations/manager.ts";
import { ForgeWatcher } from "./forge-watch.ts";
import { ForgeSites, activateForgeSites } from "./forge/sites.ts";
import { TokenVault } from "./forge/token-vault.ts";
import { runForgeCommand } from "./forge-commands.ts";
import type { CiLogKeep } from "./forge/ci.ts";
import { WorktreeRemover } from "./worktree-removal.ts";
import { WorktreeCreator } from "./worktree-creation.ts";
import { hookRemovalTransaction } from "./cli/hook-files.ts";
import { removeCliHooks } from "./cli/hook-install.ts";
import { loadCliDefinitions } from "./cli/definitions.ts";
import { discoverShells } from "./terminal/platform.ts";
import { TeamManager } from "./teams/manager.ts";
import { randomBytes } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { hostname, platform } from "node:os";
import { join } from "node:path";
import { parseRequest, type Event, type Response } from "@iori/protocol";
import type {
  NativeAddon,
  NativeConnection,
  NativeEndpoint,
  NativeIncoming,
} from "./native.ts";
import { loadNativeAddon } from "./native.ts";
import { openHostStorage } from "./storage.ts";
import { HostStore, type CurrentInvite } from "./store.ts";
import {
  TerminalManager,
  type ForgeCommandRunner,
} from "./terminal/manager.ts";
import { WorkspaceService } from "./workspace.ts";
import { configureDiffCache } from "./git-diff.ts";
import { readFile, rm } from "node:fs/promises";
import {
  MaintenanceManager,
  type MaintenanceService,
} from "./maintenance/manager.ts";
import { terminalDaemonCanContinue } from "./terminal/daemon/launch.ts";
import {
  diagnosticError,
  HostDiagnostics,
  startHostDiagnostics,
  writeDiagnostic,
} from "./diagnostics.ts";
import { EventHub } from "./event-hub.ts";
import { handleStream } from "./handlers/dispatch.ts";
import type { HostServices } from "./handlers/context.ts";
import {
  availablePort,
  bindAddresses,
  hostAddresses,
  portFromEnvironment,
  listenLocal,
  readOneSocketFrame,
  localTokenMatches,
  writeSocketFrame,
  type Session,
} from "./host-transport.ts";

const DEFAULT_PORT = 49_171;
const MAX_HANDSHAKES = 10;
const MAX_PRE_AUTH_CONNECTIONS = 100;
const ADDRESS_REFRESH_MS = 5_000;
const LOCAL_REQUEST_ERROR = {
  ok: false,
  error: { code: "invalid_request" },
} as const;

interface WatchedInvite extends CurrentInvite {
  expired: boolean;
}

export interface HostRuntime {
  endpoint: NativeEndpoint;
  maintenanceReady(): Promise<void>;
  close(): Promise<void>;
}

export async function startHost(
  addon: NativeAddon = loadNativeAddon(),
  service?: MaintenanceService,
  bundle?: string,
): Promise<HostRuntime> {
  const specifiedPort = portFromEnvironment();
  const storage = await openHostStorage(addon);
  await configureDiffCache(join(storage.root, "reading-cache"));
  const identity = {
    publicKey: storage.identity.publicKeyHex,
    hostName: hostname(),
    // The OS name shown next to the Host in the Client's sidebar.
    os:
      platform() === "win32"
        ? "Windows"
        : platform() === "darwin"
          ? "macOS"
          : "Linux",
  };
  const store = new HostStore(storage.databasePath);
  const savedPort = store.listeningPort();
  let port = specifiedPort ?? savedPort ?? DEFAULT_PORT;
  const fileUploads = new FileUploads(storage.root);
  try {
    await storage.secureFile(storage.databasePath);
  } catch (error) {
    store.close();
    storage.identity.secretKey.fill(0);
    throw error;
  }

  let relay: import("@iori/protocol").RelaySettings | undefined;
  try {
    const savedRelay = store.relayCredentials();
    if (savedRelay)
      relay =
        JSON.parse(addon.unprotectUserData(savedRelay).toString("utf8")) ??
        undefined;
  } catch {
    console.error(
      "iori-host relay-settings-unavailable: using direct connections",
    );
  }

  let connectionScope = await readConnectionScope(storage.root);
  const bind = async () => {
    const addresses = bindAddresses(port, connectionScope);
    const relayUrl = connectionScope === "network" ? relay?.url : undefined;
    const relayToken = connectionScope === "network" ? relay?.token : undefined;
    try {
      return await addon.Endpoint.bind(
        storage.identity.secretKey,
        addresses,
        relayUrl,
        relayToken,
      );
    } catch (error) {
      if (connectionScope !== "loopback") throw error;
      // An OS with IPv6 disabled has no ::1 interface. Keep IPv4 local only.
      return addon.Endpoint.bind(
        storage.identity.secretKey,
        [addresses[0]!],
        relayUrl,
        relayToken,
      );
    }
  };
  let endpoint: NativeEndpoint;
  try {
    try {
      endpoint = await bind();
    } catch (error) {
      if (specifiedPort !== undefined || savedPort !== undefined) throw error;
      port = await availablePort(connectionScope);
      endpoint = await bind();
    }
    if (specifiedPort === undefined && savedPort === undefined)
      store.saveListeningPort(port);
  } catch (error) {
    store.close();
    storage.identity.secretKey.fill(0);
    throw error;
  }
  // Keep the same identity available while rebuilding the transport.

  // A stopped Host can leave a temporary copy before the session receives it.
  await rm(join(storage.root, "launch-instructions"), {
    recursive: true,
    force: true,
  }).catch(() => console.error("iori-host launch-instructions cleanup failed"));

  const events = new EventHub();
  let terminalManager!: TerminalManager;
  let teamManager: TeamManager | undefined;
  let automationManager: AutomationManager | undefined;
  const { version } = JSON.parse(
    await readFile(
      bundle
        ? join(bundle, "release-version.json")
        : new URL("../../../release-version.json", import.meta.url),
      "utf8",
    ),
  ) as { version: string };
  let uninstalling = false;
  const maintenance = new MaintenanceManager(
    storage.root,
    version,
    service,
    () => {
      const result = terminalManager.list();
      return result.ok ? result.result.terminals : [];
    },
    (status) => events.publish({ type: "host.maintenance.changed", status }),
    {
      shellActivity: (id) => terminalManager.shellActivity(id),
      workGeneration: (id) => terminalManager.workGeneration(id),
      child: (id) => store.teamChildren().find((child) => child.id === id),
    },
    {
      hostKey: identity.publicKey,
      stopTerminals: async () => {
        uninstalling = true;
        await automationManager?.close();
        await teamManager?.close();
        await terminalManager.stopForUninstall();
      },
      restoreTerminals: async () => {
        await terminalManager.close();
        terminalManager = await TerminalManager.create(
          store,
          publishTerminalEvent,
          storage.root,
          forgeCommand,
        );
        terminalManager.onCliNotification = (terminal) =>
          pushNotifications.notify(terminal);
        teamManager = await TeamManager.create(
          store,
          terminalManager,
          storage.root,
          (event) => events.publish(event),
        );
        automationManager = new AutomationManager(
          store,
          () => terminalManager,
          () => teamManager!,
          (event) => events.publish(event),
          storage.root,
          port,
          forge.detection,
          worktreeCreator,
        );
        await automationManager.start();
      },
      removeForgeTokens: () => forgeSites.removeStoredTokens(),
      cancel: () => {
        uninstalling = false;
      },
      removeHooks: async (registerRestore) => {
        uninstalling = true;
        const { shells, preferred } = await discoverShells();
        const shell = shells.find((value) => value.id === preferred);
        if (!shell)
          throw new Error("A login shell is required to remove CLI hooks");
        const transaction = hookRemovalTransaction();
        registerRestore(transaction.restore);
        await transaction.run(() => removeCliHooks(shell, storage.root));
      },
    },
  );
  async function hostInfo() {
    await maintenance.waitReady();
    return {
      ...store.hostInfo(identity, currentAddresses()),
      connectionScope,
      relay,
      version,
      instanceId: maintenance.instanceId,
      terminalDaemonCanContinue: await terminalDaemonCanContinue(storage.root),
      maintenanceAvailable: Boolean(service),
    };
  }
  const worktreeCreator = new WorktreeCreator(store);
  const worktreeRemover = new WorktreeRemover(
    store,
    () => terminalManager,
    () => teamManager!,
    (path) => workspaces.stopRepositoryWatches(path),
    (paths, removing) => workspaces.setRemoving(paths, removing),
  );
  // Each connection keeps the whole log of the done GitHub job it reads.
  const ciLogKeeps = new WeakMap<Session, CiLogKeep>();
  const ciLogKeep = (session: Session) => {
    let keep = ciLogKeeps.get(session);
    if (!keep) ciLogKeeps.set(session, (keep = {}));
    return keep;
  };
  const forge = new ForgeWatcher(
    store,
    (path, status) => events.publish({ type: "forge.changed", path, status }),
    () => events.publish({ type: "forge.settings.changed" }),
  );
  // `iori issue` and `iori ci` read as the CI and Issues screens do.
  const forgeCommand: ForgeCommandRunner = (path, command) =>
    runForgeCommand(command, path, store, forge.detection);
  const forgeSites = new ForgeSites(
    store,
    new TokenVault({
      hostKey: identity.publicKey,
      root: storage.root,
      secureFile: (path) => storage.secureFile(path),
      protect: (data) => addon.protectUserData(data),
      unprotect: (data) => addon.unprotectUserData(data),
    }),
    () => events.publish({ type: "forge.settings.changed" }),
  );
  activateForgeSites(forgeSites);
  const workspaces = new WorkspaceService(
    store,
    (event) => events.publish(event),
    (paths) => forge.changed(paths),
  );
  const sessions = new Set<Session>();
  const sessionsByKey = new Map<string, Set<Session>>();
  const pushNotifications = new PushNotifications(
    store,
    identity.publicKey,
    (publicKey) => (sessionsByKey.get(publicKey)?.size ?? 0) > 0,
    () => workspaces.history(),
  );
  const publishTerminalEvent = (event: Event) => {
    if (event.type === "terminal.closed")
      pushNotifications.forget(event.terminalId);
    events.publish(event);
  };
  const unauthenticated = new Set<Session>();
  const handshakes = new Set<NativeIncoming>();
  let stopping = false;
  const diagnostics = new HostDiagnostics();
  let addressUpdate = Promise.resolve();
  let lastAddresses: string[] = [];
  let addressesInitialized = false;
  const localToken = randomBytes(32);
  const localSockets = new Set<Socket>();
  let watchedInvite: WatchedInvite | undefined;
  let inviteExpiry: ReturnType<typeof setTimeout> | undefined;

  function stopWatchingInvite(): void {
    if (inviteExpiry) clearTimeout(inviteExpiry);
    inviteExpiry = undefined;
    watchedInvite = undefined;
  }

  function inviteStatus(
    invite: CurrentInvite,
    status: "expired" | "invalidated",
  ): Event {
    return {
      type: "invite.status",
      operationId: invite.operationId,
      status,
    };
  }

  function watchInvite(invite: CurrentInvite | undefined): void {
    if (inviteExpiry) clearTimeout(inviteExpiry);
    inviteExpiry = undefined;
    if (!invite) {
      watchedInvite = undefined;
      return;
    }

    watchedInvite = {
      ...invite,
      expired: invite.expiresAt <= Date.now(),
    };
    if (watchedInvite.expired) return;

    inviteExpiry = setTimeout(
      () => {
        expireWatchedInvite();
      },
      Math.max(0, invite.expiresAt - Date.now()),
    );
    inviteExpiry.unref();
  }

  function expireWatchedInvite(): Event | undefined {
    if (!watchedInvite || watchedInvite.expired) return undefined;
    if (Date.now() < watchedInvite.expiresAt) {
      watchInvite(watchedInvite);
      return undefined;
    }
    watchedInvite.expired = true;
    const event = inviteStatus(watchedInvite, "expired");
    events.publish(event);
    return event;
  }

  function createInvite(
    operationId: string,
    clientPublicKey: string,
  ): Response<unknown> {
    const previous = store.currentInvite();
    const response = store.createInvite(
      { clientPublicKey, operationId },
      identity,
      currentAddresses(),
      randomBytes(32).toString("base64url"),
      Date.now(),
      connectionScope === "network" ? relay?.url : undefined,
    );
    const current = store.currentInvite();
    if (
      response.ok &&
      current?.operationId === operationId &&
      current.operationId !== previous?.operationId
    ) {
      if (previous) {
        const alreadyExpired =
          watchedInvite?.operationId === previous.operationId &&
          watchedInvite.expired;
        if (!alreadyExpired) {
          events.publish(
            inviteStatus(
              previous,
              previous.expiresAt <= Date.now() ? "expired" : "invalidated",
            ),
          );
        }
      }
      watchInvite(current);
    }
    return response;
  }

  watchInvite(store.currentInvite());

  const currentAddresses = () =>
    connectionScope === "loopback"
      ? endpoint.boundSockets
      : hostAddresses(port);
  const refreshAddresses = async () => {
    const currentEndpoint = endpoint;
    const addresses = currentAddresses();
    if (
      addresses.length === lastAddresses.length &&
      addresses.every((address, index) => address === lastAddresses[index])
    ) {
      return;
    }
    for (const address of addresses) {
      await currentEndpoint.addExternalAddr(address);
    }
    if (currentEndpoint !== endpoint) return;
    const changed = addressesInitialized;
    lastAddresses = addresses;
    addressesInitialized = true;
    if (changed) events.publish({ type: "host.addresses", addresses });
  };
  await refreshAddresses().catch(() => undefined);

  const server = createServer({ allowHalfOpen: true }, (socket) => {
    socket.setNoDelay(true);
    localSockets.add(socket);
    socket.once("close", () => localSockets.delete(socket));
    void handleLocalControl(socket).catch(() => socket.destroy());
  });

  async function handleLocalControl(socket: Socket): Promise<void> {
    try {
      const input = await readOneSocketFrame(socket);
      if (
        typeof input !== "object" ||
        input === null ||
        Array.isArray(input) ||
        !localTokenMatches((input as Record<string, unknown>).token, localToken)
      ) {
        socket.destroy();
        return;
      }
      const fields = input as Record<string, unknown>;
      if (fields.method === "host.connections.allow") {
        const changed = connectionScope !== "network";
        await allowNetworkConnections(storage.root);
        connectionScope = "network";
        await writeSocketFrame(socket, { ok: true, result: {} });
        socket.end();
        if (changed) await endpoint.close();
        return;
      }
      const request = parseRequest({
        kind: "request",
        operationId: fields.operationId,
        method: fields.method,
        params: fields.params,
      });
      if (request.kind === "request" && request.method === "host.info") {
        await writeSocketFrame(socket, { ok: true, result: await hostInfo() });
        socket.end();
        return;
      }
      if (request.kind !== "request" || request.method !== "invite.create") {
        await writeSocketFrame(socket, LOCAL_REQUEST_ERROR);
        socket.end();
        return;
      }

      const removeWaiter = events.waitForInvite(
        request.operationId,
        (event) => {
          void writeSocketFrame(socket, event)
            .then(() => new Promise<void>((resolve) => socket.end(resolve)))
            .catch(() => socket.destroy());
        },
      );
      socket.once("close", removeWaiter);
      const response = createInvite(request.operationId, "local-control");
      await writeSocketFrame(socket, response);
    } catch {
      if (!socket.destroyed) {
        try {
          await writeSocketFrame(socket, LOCAL_REQUEST_ERROR);
          socket.end();
        } catch {
          socket.destroy();
        }
      }
    }
  }

  const services: HostServices = {
    store,
    identity,
    events,
    root: storage.root,
    hostInfo,
    currentAddresses,
    createInvite,
    get relay() {
      return relay;
    },
    get connectionScope() {
      return connectionScope;
    },
    expiredInviteStatus() {
      expireWatchedInvite();
      if (watchedInvite?.expired) return inviteStatus(watchedInvite, "expired");
    },
    registered(event) {
      if (event.inviteOperationId === watchedInvite?.operationId)
        stopWatchingInvite();
    },
    setRelay(settings) {
      store.saveRelayCredentials(
        addon.protectUserData(Buffer.from(JSON.stringify(settings ?? null))),
      );
      relay = settings;
    },
    rebind: () => endpoint.close(),
    unauthenticated,
    sessionsByKey,
    get uninstalling() {
      return uninstalling;
    },
    get terminalManager() {
      return terminalManager;
    },
    get teamManager() {
      return teamManager!;
    },
    get automationManager() {
      return automationManager!;
    },
    maintenance,
    fileUploads,
    forge,
    forgeSites,
    ciLogKeep,
    worktreeCreator,
    worktreeRemover,
    workspaces,
  };

  function closeSession(session: Session): void {
    if (session.closed) return;
    session.closed = true;
    if (session.preAuth) {
      session.preAuth = false;
      unauthenticated.delete(session);
    }
    sessions.delete(session);
    forge.remove(session);
    ciLogKeeps.delete(session);
    events.removeConnection(session.connection);
    terminalManager.detachConnection(session.connection);
    const peerSessions = sessionsByKey.get(session.publicKey);
    peerSessions?.delete(session);
    if (peerSessions?.size === 0) {
      sessionsByKey.delete(session.publicKey);
      if (!stopping) pushNotifications.disconnected(session.publicKey);
    }
  }

  async function handleAccepted(incoming: NativeIncoming): Promise<void> {
    handshakes.add(incoming);
    let connection: NativeConnection | undefined;
    try {
      connection = await incoming.handshake();
      if (!handshakes.has(incoming) || stopping) {
        connection.close(1, Buffer.from("handshake retired"));
        return;
      }
    } catch (error) {
      if (!stopping && handshakes.has(incoming))
        diagnostics.record("handshake-failed", {
          message: error instanceof Error ? error.message : String(error),
          activeHandshakes: handshakes.size,
          pendingUnauthenticated: unauthenticated.size,
        });
      return;
    } finally {
      handshakes.delete(incoming);
    }

    let session: Session | undefined;
    try {
      const publicKey = connection.remotePublicKeyHex.toLowerCase();
      const registered = store.isRegistered(publicKey);
      const openedAt = performance.now();
      const peer = publicKey.slice(0, 8);
      if (!stopping)
        diagnostics.record(
          "connection-opened",
          { peer, registered },
          `connection-opened:${publicKey}`,
        );
      const activeSession: Session = {
        connection,
        publicKey,
        preAuth: !registered,
        inviteAttempts: 0,
        closed: false,
      };
      session = activeSession;
      if (!registered) {
        if (unauthenticated.size >= MAX_PRE_AUTH_CONNECTIONS) {
          const oldest = unauthenticated.values().next().value!;
          oldest.connection.close(1, Buffer.from("pre-auth connection limit"));
          closeSession(oldest);
          diagnostics.record("pre-auth-limit-reached", {
            pendingUnauthenticated: unauthenticated.size,
          });
        }
        unauthenticated.add(activeSession);
      }
      sessions.add(activeSession);
      let peerSessions = sessionsByKey.get(publicKey);
      if (!peerSessions) {
        peerSessions = new Set();
        sessionsByKey.set(publicKey, peerSessions);
      }
      peerSessions.add(activeSession);
      void connection
        .closed()
        .then((reason) => {
          if (!stopping)
            diagnostics.record(
              "connection-closed",
              {
                peer,
                registered: store.isRegistered(publicKey),
                reason,
                seconds: Math.round((performance.now() - openedAt) / 1_000),
              },
              `connection-closed:${publicKey}`,
            );
          closeSession(activeSession);
        })
        .catch(() => closeSession(activeSession));

      while (!stopping && !activeSession.closed) {
        const stream = await connection.acceptBi();
        void handleStream(services, activeSession, stream).catch(
          () => undefined,
        );
      }
    } catch {
      if (connection) connection.close(1, Buffer.from("connection failed"));
      if (session) closeSession(session);
    }
  }

  let localPort: number;
  try {
    localPort = await listenLocal(server);
    await storage.persistLocalConfig(
      localPort,
      localToken.toString("base64url"),
    );
  } catch (error) {
    localToken.fill(0);
    for (const socket of localSockets) socket.destroy();
    storage.identity.secretKey.fill(0);
    await endpoint.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    workspaces.close();
    store.close();
    throw error;
  }

  try {
    // Restored CLI terminals use the user's definitions from the start.
    await loadCliDefinitions(storage.root);
    terminalManager = await TerminalManager.create(
      store,
      publishTerminalEvent,
      storage.root,
      forgeCommand,
    );
    terminalManager.onCliNotification = (terminal) =>
      pushNotifications.notify(terminal);
    await maintenance.initialize();
    teamManager = await TeamManager.create(
      store,
      terminalManager,
      storage.root,
      (event) => events.publish(event),
    );
    automationManager = new AutomationManager(
      store,
      () => terminalManager,
      () => teamManager!,
      (event) => events.publish(event),
      storage.root,
      port,
      forge.detection,
      worktreeCreator,
    );
    await automationManager.start();
  } catch (error) {
    await automationManager?.close();
    maintenance.close();
    await terminalManager?.close();
    localToken.fill(0);
    for (const socket of localSockets) socket.destroy();
    storage.identity.secretKey.fill(0);
    await endpoint.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await storage.removeLocalConfig();
    store.close();
    throw error;
  }

  const stopDiagnostics = await startHostDiagnostics(
    storage.root,
    endpoint.boundSockets,
    diagnostics,
  );
  writeDiagnostic("started", {
    version,
    pid: process.pid,
    sockets: endpoint.boundSockets.join(","),
  });
  let cancelRebindWait: (() => void) | undefined;
  let retrySeconds = 1;
  let awaitingIncomingAfterRestore = false;
  const waitBeforeRebind = async () => {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, retrySeconds * 1_000);
      cancelRebindWait = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    cancelRebindWait = undefined;
    retrySeconds = Math.min(retrySeconds * 2, 30);
  };
  const restoreEndpoint = async (error: unknown) => {
    const lostAt = performance.now();
    diagnostics.record("endpoint-lost", diagnosticError(error));
    await endpoint.close().catch((closeError: unknown) => {
      diagnostics.record("endpoint-close-failed", diagnosticError(closeError));
    });
    if (stopping) return;
    if (awaitingIncomingAfterRestore) await waitBeforeRebind();
    while (!stopping) {
      let replacement: NativeEndpoint;
      try {
        replacement = await bind();
      } catch (bindError) {
        if (stopping) return;
        diagnostics.record("endpoint-rebind-failed", {
          ...diagnosticError(bindError),
          retrySeconds,
        });
        await waitBeforeRebind();
        continue;
      }
      // close() can start while the native bind is in flight.
      if (stopping) {
        await replacement.close();
        return;
      }
      endpoint = replacement;
      awaitingIncomingAfterRestore = true;
      lastAddresses = [];
      addressUpdate = addressUpdate
        .then(refreshAddresses)
        .catch(() => undefined);
      await addressUpdate;
      if (!stopping)
        diagnostics.record("endpoint-restored", {
          sockets: endpoint.boundSockets.join(","),
          seconds: Math.round((performance.now() - lostAt) / 1_000),
        });
      return;
    }
  };
  const acceptLoop = (async () => {
    while (!stopping) {
      let incoming: NativeIncoming | null;
      try {
        incoming = await endpoint.accept();
      } catch (error) {
        if (!stopping) await restoreEndpoint(error);
        continue;
      }
      if (incoming === null) {
        if (!stopping)
          await restoreEndpoint(new Error("accept() returned null"));
        continue;
      }
      retrySeconds = 1;
      awaitingIncomingAfterRestore = false;
      if (handshakes.size >= MAX_HANDSHAKES) {
        const oldest = handshakes.values().next().value!;
        handshakes.delete(oldest);
        await oldest.refuse().catch(() => undefined);
        diagnostics.record("handshake-limit-reached", {
          activeHandshakes: handshakes.size,
          pendingUnauthenticated: unauthenticated.size,
        });
      }
      void handleAccepted(incoming).catch(() => undefined);
    }
  })();
  const addressRefresh = setInterval(() => {
    addressUpdate = addressUpdate.then(refreshAddresses).catch(() => undefined);
  }, ADDRESS_REFRESH_MS);
  addressRefresh.unref();

  return {
    get endpoint() {
      return endpoint;
    },
    maintenanceReady: () => maintenance.ready(),
    async close() {
      if (stopping) return;
      stopping = true;
      pushNotifications.close();
      stopDiagnostics();
      maintenance.close();
      cancelRebindWait?.();
      clearInterval(addressRefresh);
      if (inviteExpiry) clearTimeout(inviteExpiry);
      localToken.fill(0);
      for (const socket of localSockets) socket.destroy();
      await automationManager?.close();
      await teamManager?.close();
      await terminalManager.close();
      await fileUploads.close();
      for (const session of sessions) {
        session.connection.close(0, Buffer.from("Host stopped"));
      }
      await endpoint.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await acceptLoop.catch(() => undefined);
      storage.identity.secretKey.fill(0);
      await addressUpdate;
      forge.close();
      activateForgeSites(undefined);
      workspaces.close();
      await storage.removeLocalConfig();
      store.close();
    },
  };
}
