import { FileUploads, FilePutFailure } from "./files-writing.ts";
import { isFilesTransferMethod } from "@iori/protocol";
import { AutomationManager } from "./automations/manager.ts";
import { githubAccounts } from "./forge/github.ts";
import {
  repositoryGitSettings,
  repositoryMainPath,
} from "./repository-git-settings.ts";
import { ForgeWatcher } from "./forge-watch.ts";
import {
  ForgeSites,
  activateForgeSites,
  discoveredForgeOrigins,
} from "./forge/sites.ts";
import { TokenVault } from "./forge/token-vault.ts";
import { answerForgeIssues } from "./forge-issues.ts";
import { answerForgeCi } from "./forge-ci.ts";
import { runForgeCommand } from "./forge-commands.ts";
import type { CiLogKeep } from "./forge/ci.ts";
import { WorktreeRemover } from "./worktree-removal.ts";
import {
  WorktreeCreator,
  worktreeOptions,
  worktreeSetup,
} from "./worktree-creation.ts";
import { hookRemovalTransaction } from "./cli/hook-files.ts";
import { removeCliHooks } from "./cli/hook-install.ts";
import { loadCliDefinitions } from "./cli/definitions.ts";
import { discoverShells } from "./terminal/platform.ts";
import { TeamManager } from "./teams/manager.ts";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, isIP, type Server, type Socket } from "node:net";
import { createSocket } from "node:dgram";
import { hostname, networkInterfaces, platform } from "node:os";
import { join } from "node:path";
import {
  FrameDecoder,
  FrameError,
  decodeFrame,
  encodeFrame,
  isForgeCiMethod,
  isForgeIssueMethod,
  isReadMethod,
  parseRequest,
  terminalOpenStreamSchema,
  type Event,
  type ProtocolErrorCode,
  type Request,
  type ResultByMethod,
  type Response,
} from "@iori/protocol";
import { authorizationError } from "./authorization.ts";
import type {
  NativeAddon,
  NativeBiStream,
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
import {
  browseFolders,
  WorkspaceError,
  WorkspaceService,
} from "./workspace.ts";
import { handleFileRead } from "./files-reading.ts";
import { handleGitRead } from "./git-reading.ts";
import { configureDiffCache } from "./git-diff.ts";
import { ReadingFailure, errorCode } from "./reading-failure.ts";
import { watchReading } from "./reading-watch.ts";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

const DEFAULT_PORT = 49_171;
const MAX_HANDSHAKES = 10;
const MAX_PRE_AUTH_CONNECTIONS = 100;
// pair: UUID + 43-byte secret + 63 Unicode code points (including JSON escapes).
const MAX_PRE_AUTH_FRAME_BYTES = 1024;
const MAX_INVITE_ATTEMPTS_PER_CONNECTION = 6;
const FRAME_READ_CHUNK = 64 * 1024;
const ADDRESS_REFRESH_MS = 5_000;
const LOCAL_REQUEST_ERROR = {
  ok: false,
  error: { code: "invalid_request" },
} as const;

interface Session {
  connection: NativeConnection;
  publicKey: string;
  preAuth: boolean;
  inviteAttempts: number;
  closed: boolean;
}

interface EventSubscription {
  connection: NativeConnection;
  stream: NativeBiStream;
  pending: Promise<void>;
  inviteStatusesSent: Set<string>;
}

interface WatchedInvite extends CurrentInvite {
  expired: boolean;
}

type LocalWaiter = (event: Event) => void;

class EventHub {
  readonly #subscriptions = new Set<EventSubscription>();
  readonly #localWaiters = new Map<string, Set<LocalWaiter>>();

  addSubscription(
    connection: NativeConnection,
    stream: NativeBiStream,
  ): EventSubscription {
    const subscription: EventSubscription = {
      connection,
      stream,
      pending: Promise.resolve(),
      inviteStatusesSent: new Set(),
    };
    this.#subscriptions.add(subscription);
    return subscription;
  }

  removeConnection(connection: NativeConnection): void {
    for (const subscription of this.#subscriptions) {
      if (subscription.connection === connection) {
        this.#subscriptions.delete(subscription);
      }
    }
  }

  removeSubscription(subscription: EventSubscription): void {
    this.#subscriptions.delete(subscription);
  }

  send(subscription: EventSubscription, event: Event): Promise<void> {
    if (event.type === "invite.status") {
      const key = `${event.operationId}:${event.status}`;
      if (subscription.inviteStatusesSent.has(key)) {
        return subscription.pending;
      }
      subscription.inviteStatusesSent.add(key);
    }
    subscription.pending = subscription.pending
      .then(() => writeStreamFrame(subscription.stream, event))
      .catch(() => {
        this.#subscriptions.delete(subscription);
      });
    return subscription.pending;
  }

  waitForInvite(operationId: string, waiter: LocalWaiter): () => void {
    let waiters = this.#localWaiters.get(operationId);
    if (!waiters) {
      waiters = new Set();
      this.#localWaiters.set(operationId, waiters);
    }
    waiters.add(waiter);
    return () => {
      waiters?.delete(waiter);
      if (waiters?.size === 0) this.#localWaiters.delete(operationId);
    };
  }

  publish(event: Event): void {
    for (const subscription of this.#subscriptions) {
      void this.send(subscription, event);
    }

    const operationId =
      event.type === "device.registered"
        ? event.inviteOperationId
        : event.type === "invite.status"
          ? event.operationId
          : undefined;
    if (!operationId) return;
    for (const waiter of this.#localWaiters.get(operationId) ?? []) {
      waiter(event);
    }
  }
}

export interface HostRuntime {
  endpoint: NativeEndpoint;
  maintenanceReady(): Promise<void>;
  close(): Promise<void>;
}

function portFromEnvironment(): number | undefined {
  const value = process.env.IORI_HOST_PORT;
  if (value === undefined || value === "") return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("IORI_HOST_PORT must be a port from 1 to 65535");
  }
  return port;
}

async function availablePort(): Promise<number> {
  const socket = createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, "0.0.0.0", resolve);
    });
    return socket.address().port;
  } finally {
    await new Promise<void>((resolve) => socket.close(resolve));
  }
}

function hostAddresses(port: number): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      const address = entry.address.split("%", 1)[0] ?? "";
      if (entry.internal || isIP(address) === 0) continue;
      if (
        address.startsWith("169.254.") ||
        /^fe[89ab][0-9a-f]:/iu.test(address)
      ) {
        continue;
      }
      addresses.add(
        entry.family === "IPv6" ? `[${address}]:${port}` : `${address}:${port}`,
      );
    }
  }
  return [...addresses].sort();
}

function bindAddresses(port: number): string[] {
  return [`0.0.0.0:${port}`, `[::]:${port}`];
}

function responseError(code: ProtocolErrorCode): Response<never> {
  return { ok: false, error: { code } };
}

function responseBytes(value: unknown): Buffer {
  return Buffer.from(encodeFrame(value));
}

async function writeStreamFrame(
  stream: NativeBiStream,
  value: unknown,
): Promise<void> {
  try {
    await stream.write(responseBytes(value));
  } catch (error) {
    // STOP_SENDING only notifies the application. Answer with RESET_STREAM;
    // retaining the native wrapper until V8 GC must not retain QUIC credit.
    await stream.reset(0).catch(() => undefined);
    throw error;
  }
}

async function sendStreamResponse(
  stream: NativeBiStream,
  response: Response<unknown>,
): Promise<void> {
  await writeStreamFrame(stream, response);
  await stream.finish();
}

function createStreamFrameReader(
  stream: NativeBiStream,
  preAuth = false,
): () => Promise<unknown | undefined> {
  if (preAuth) {
    return async () => {
      const header = Buffer.alloc(4);
      let offset = 0;
      while (offset < 4) {
        const chunk = await stream.read(4 - offset);
        if (chunk === null) {
          if (offset === 0) return undefined;
          throw new FrameError("incomplete request header");
        }
        header.set(chunk, offset);
        offset += chunk.length;
      }
      const length = header.readUInt32BE();
      if (length > MAX_PRE_AUTH_FRAME_BYTES)
        throw new FrameError("pre-auth frame exceeds the maximum size");
      const payload = Buffer.alloc(length);
      offset = 0;
      while (offset < length) {
        const chunk = await stream.read(length - offset);
        if (chunk === null) throw new FrameError("incomplete request frame");
        payload.set(chunk, offset);
        offset += chunk.length;
      }
      return decodeFrame(payload);
    };
  }
  const decoder = new FrameDecoder();
  const frames: Uint8Array[] = [];
  let ended = false;
  return async () => {
    while (frames.length === 0 && !ended) {
      const chunk = await stream.read(FRAME_READ_CHUNK);
      if (chunk === null) {
        decoder.finish();
        ended = true;
        break;
      }
      frames.push(...decoder.push(chunk));
    }
    const payload = frames.shift();
    return payload === undefined ? undefined : decodeFrame(payload);
  };
}

function isPairRequest(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).kind === "request" &&
    (value as Record<string, unknown>).method === "pair"
  );
}

async function readOneSocketFrame(socket: Socket): Promise<unknown> {
  const decoder = new FrameDecoder();
  let payload: Uint8Array | undefined;
  await new Promise<void>((resolve, reject) => {
    const clean = () => {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onData = (chunk: Buffer) => {
      try {
        const frames = decoder.push(chunk);
        if (
          frames.length > 1 ||
          (payload !== undefined && frames.length !== 0)
        ) {
          throw new FrameError("local request contains more than one frame");
        }
        if (frames.length === 1) payload = frames[0];
      } catch (error) {
        clean();
        reject(error);
      }
    };
    const onEnd = () => {
      try {
        decoder.finish();
        if (payload === undefined)
          throw new FrameError("local request has no frame");
        clean();
        resolve();
      } catch (error) {
        clean();
        reject(error);
      }
    };
    const onError = (error: Error) => {
      clean();
      reject(error);
    };
    const onClose = () => {
      clean();
      reject(new FrameError("local request connection closed"));
    };
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
  if (payload === undefined) throw new FrameError("local request has no frame");
  return decodeFrame(payload);
}

function localTokenMatches(value: unknown, token: Buffer): boolean {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value))
    return false;
  const actual = Buffer.from(value, "base64url");
  if (actual.byteLength !== 32 || actual.toString("base64url") !== value)
    return false;
  return timingSafeEqual(actual, token);
}

async function writeSocketFrame(socket: Socket, value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(responseBytes(value), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function listenLocal(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Local control server did not bind to TCP");
  }
  return address.port;
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

  let endpoint: NativeEndpoint;
  try {
    const bind = () =>
      addon.Endpoint.bind(
        storage.identity.secretKey,
        bindAddresses(port),
        relay?.url,
        relay?.token,
      );
    try {
      endpoint = await bind();
    } catch (error) {
      if (specifiedPort !== undefined || savedPort !== undefined) throw error;
      port = await availablePort();
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
          (event) => events.publish(event),
          storage.root,
          forgeCommand,
        );
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
  // A first instruction from the worktree screen is delivered as a file that
  // the CLI reads, as Automations deliver theirs (worktrees.md).
  const withInstruction = async <T>(
    instruction: string | undefined,
    launch: (file?: string) => Promise<T>,
  ): Promise<T> => {
    if (instruction === undefined) return launch();
    const directory = join(storage.root, "launch-instructions");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `${randomUUID()}.md`);
    await writeFile(file, instruction, { mode: 0o600 });
    try {
      return await launch(file);
    } finally {
      // The CLI reads the copy delivered to its session; this one is done.
      await rm(file, { force: true });
    }
  };
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
      relay?.url,
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

  const currentAddresses = () => hostAddresses(port);
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

  async function sendRequestResponse(
    session: Session,
    request: Request,
    stream: NativeBiStream,
    signal?: AbortSignal,
  ): Promise<void> {
    const denied = authorizationError(
      store.isRegistered(session.publicKey),
      request,
    );
    if (denied) {
      await sendStreamResponse(stream, responseError(denied));
      return;
    }

    if (request.kind === "subscribe" && request.method === "reading.watch") {
      let stopWatch: (() => void) | undefined;
      let active = true;
      const stop = () => {
        active = false;
        stopWatch?.();
        stopWatch = undefined;
      };
      try {
        stopWatch = await watchReading(
          request.params.root,
          request.params.scope,
          async (paths) => {
            if (!active) return;
            try {
              await writeStreamFrame(stream, {
                type: "reading.changed",
                operationId: request.operationId,
                root: request.params.root,
                ...(paths ? { paths } : {}),
              });
            } catch {
              stop();
            }
          },
          (error) => {
            if (!active) return;
            stop();
            const code = errorCode(error);
            void sendStreamResponse(
              stream,
              responseError(
                code === "EACCES" || code === "EPERM"
                  ? "permission_denied"
                  : "read_failed",
              ),
            ).catch(() => undefined);
          },
        );
      } catch (error) {
        await sendStreamResponse(
          stream,
          responseError(
            error instanceof ReadingFailure ? error.code : "internal_error",
          ),
        );
        return;
      }
      try {
        await stream.stopped();
      } catch {
        // Closing or cancelling a view releases its filesystem watchers.
      } finally {
        stop();
        await stream.reset(0).catch(() => undefined);
      }
      return;
    }

    if (request.kind === "subscribe") {
      const info = await hostInfo();
      const subscription = events.addSubscription(session.connection, stream);
      try {
        await events.send(subscription, {
          ...store.snapshot(identity, currentAddresses(), session.publicKey),
          host: {
            ...info,
            ...store.hostInfo(identity, currentAddresses()),
            relay,
          },
        } as Extract<Event, { type: "snapshot" }>);
        expireWatchedInvite();
        if (watchedInvite?.expired) {
          await events.send(
            subscription,
            inviteStatus(watchedInvite, "expired"),
          );
        }
        await stream.stopped();
      } catch {
        // The subscription ended or the connection closed.
      } finally {
        events.removeSubscription(subscription);
        await stream.reset(0).catch(() => undefined);
      }
      return;
    }

    if (
      uninstalling &&
      ![
        "host.info",
        "host.maintenance.status",
        "host.uninstall",
        "host.uninstall.prepare",
        "host.restart",
        "host.restart.prepare",
      ].includes(request.method)
    ) {
      await sendStreamResponse(stream, responseError("host_uninstalling"));
      return;
    }
    if (isFilesTransferMethod(request.method)) {
      try {
        const result = await fileUploads.request(
          session.publicKey,
          request.method,
          request.params as never,
        );
        await sendStreamResponse(stream, { ok: true, result });
      } catch (error) {
        await sendStreamResponse(
          stream,
          responseError(
            error instanceof FilePutFailure ? error.code : "put_failed",
          ),
        );
      }
      return;
    }
    if (isReadMethod(request.method)) {
      try {
        const result = request.method.startsWith("files.")
          ? await handleFileRead(
              request.method,
              request.params as never,
              signal,
            )
          : await handleGitRead(
              request.method,
              request.params as never,
              signal,
            );
        await sendStreamResponse(stream, { ok: true, result });
      } catch (error) {
        if (signal?.aborted) return;
        await sendStreamResponse(
          stream,
          responseError(
            error instanceof ReadingFailure ? error.code : "internal_error",
          ),
        );
      }
      return;
    }

    if (isForgeIssueMethod(request.method)) {
      const answer = await answerForgeIssues(
        request,
        store,
        forge.detection,
        signal,
      );
      if (!signal?.aborted) await sendStreamResponse(stream, answer);
      return;
    }

    let mutationEvent: Event | undefined;
    let revokedPublicKey: string | undefined;
    let response: Response<unknown>;
    switch (request.method) {
      case "automation.list":
        response = { ok: true, result: automationManager!.list() };
        break;
      case "automation.history":
        response = {
          ok: true,
          result: { runs: store.automationRuns(request.params.id) },
        };
        break;
      case "automation.save":
        response = await automationManager!.save(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.id,
          request.params.definition,
        );
        break;
      case "automation.delete":
        response = await automationManager!.remove(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.id,
        );
        break;
      case "automation.run":
        response = await automationManager!.run(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.id,
        );
        break;
      case "automation.regenerateToken":
        response = await automationManager!.regenerateToken(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.id,
        );
        break;
      case "automation.received":
        response = await automationManager!.received(request.params.id);
        break;
      case "pair": {
        const mutation = store.pair(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          identity,
          currentAddresses(),
          request.params.deviceName,
          request.params.secret,
          Date.now(),
        );
        if (mutation.response.ok) mutation.response.result.host.relay = relay;
        response = mutation.response;
        mutationEvent = mutation.event;
        if (response.ok && session.preAuth) {
          session.preAuth = false;
          unauthenticated.delete(session);
        }
        break;
      }
      case "devices.list":
        response = store.devices(session.publicKey);
        break;
      case "invite.create":
        response = createInvite(request.operationId, session.publicKey);
        break;
      case "devices.revoke": {
        const mutation = store.revoke(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.publicKey,
        );
        response = mutation.response;
        mutationEvent = mutation.event;
        revokedPublicKey = mutation.revokedPublicKey;
        break;
      }
      case "host.relay.set":
        store.saveRelayCredentials(
          addon.protectUserData(
            Buffer.from(JSON.stringify(request.params.relay ?? null)),
          ),
        );
        relay = request.params.relay;
        mutationEvent = { type: "host.relay", relay };
        response = { ok: true, result: { relay } };
        break;
      case "host.info":
        response = { ok: true, result: await hostInfo() };
        break;
      case "host.update.prepare":
        response = {
          ok: true,
          result: await maintenance.plan("update", request.params.version),
        };
        break;
      case "host.uninstall.prepare":
        response = { ok: true, result: await maintenance.plan("uninstall") };
        break;
      case "host.restart.prepare":
        response = { ok: true, result: await maintenance.plan("restart") };
        break;
      case "host.maintenance.status":
        response = {
          ok: true,
          result: await maintenance.lookup(
            session.publicKey,
            request.params.operationId,
          ),
        };
        break;
      case "host.uninstall":
      case "host.update":
      case "host.restart":
        response = {
          ok: true,
          result: await maintenance.execute(
            session.publicKey,
            request.operationId,
            request.method === "host.uninstall"
              ? "uninstall"
              : request.method === "host.update"
                ? "update"
                : "restart",
            request.params,
          ),
        };
        break;
      case "teams.boards":
        response = { ok: true, result: teamManager!.boards() };
        break;
      case "teams.board":
        response = {
          ok: true,
          result: await teamManager!.board(request.params.cwd),
        };
        break;
      case "teams.records":
        response = { ok: true, result: teamManager!.records(request.params) };
        break;
      case "teams.task.history":
        response = {
          ok: true,
          result: await teamManager!.taskHistory(request.params.taskId),
        };
        break;
      case "teams.children":
        response = {
          ok: true,
          result: teamManager!.listChildren(request.params),
        };
        break;
      case "teams.child.stop":
        response = await teamManager!.stopChild(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.childId,
        );
        break;
      case "teams.list":
      case "teams.read":
      case "teams.create":
      case "teams.save":
      case "teams.memo":
      case "teams.restore":
      case "teams.duplicate":
      case "teams.hidden.set":
      case "teams.delete":
      case "teams.settings":
        response = store.teamOperation(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.method,
          request.params,
        );
        if (response.ok) teamManager?.conditionsChanged();
        break;
      case "cli.models":
        response = await terminalManager.cliModels(request.params.cliId);
        break;
      case "cli.help":
        response = await terminalManager.cliHelp(request.params.command);
        break;
      case "cli.list":
        response = await terminalManager.listClis(request.params.refreshUsage);
        break;
      case "cli.usage.refresh":
        await terminalManager.requestCliUsageRefresh(request.params.cliId);
        response = { ok: true, result: {} };
        break;
      case "cli.order.set": {
        const context = {
          clientPublicKey: session.publicKey,
          operationId: request.operationId,
        };
        const previous = store.terminalOperationResult<{ order: string[] }>(
          context,
        );
        if (previous) {
          response = { ok: true, result: previous };
          break;
        }
        const list = await terminalManager.listClis();
        if (!list.ok) {
          response = list;
          break;
        }
        const known = new Set(list.result.clis.map((cli) => cli.id));
        const order = [
          ...new Set(request.params.order.filter((id) => known.has(id))),
        ];
        store.saveCliOrder(order);
        const result = { order };
        store.saveTerminalOperationResult(context, result);
        events.publish({ type: "cli.order.changed", order });
        response = { ok: true, result };
        break;
      }
      case "cli.definition.file.write":
        response = {
          ok: true,
          result: await terminalManager.writeDefinitionFile(
            session.publicKey,
            request.params,
          ),
        };
        break;
      case "cli.definition.files.discard":
        response = {
          ok: true,
          result: await terminalManager.discardDefinitionFiles(
            session.publicKey,
            request.params.uploadIds,
          ),
        };
        break;
      case "cli.icon.read":
        response = {
          ok: true,
          result: terminalManager.readCliIcon(
            request.params.hash,
            request.params.offset,
          ),
        };
        break;
      case "cli.icon.set":
        response = await terminalManager.setCliIcon(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params,
        );
        break;
      case "cli.definition.check":
        response = await terminalManager.checkCliDefinition(
          request.params.definition,
          request.params.cliId,
          request.params.files,
          session.publicKey,
        );
        break;
      case "cli.definition.save":
        response = await terminalManager.saveCliDefinition(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.definition,
          request.params.cliId,
          request.params.files,
        );
        if (response.ok) teamManager?.conditionsChanged();
        break;
      case "cli.definition.simple":
        response = await terminalManager.saveSimpleCliDefinition(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.simple,
          request.params.cliId,
        );
        if (response.ok) teamManager?.conditionsChanged();
        break;
      case "cli.hidden.set": {
        const context = {
          clientPublicKey: session.publicKey,
          operationId: request.operationId,
        };
        const previous = store.terminalOperationResult<{
          cliId: string;
          hidden: boolean;
        }>(context);
        if (previous) {
          response = { ok: true, result: previous };
          break;
        }
        const list = await terminalManager.listClis();
        if (
          !list.ok ||
          !list.result.clis.some((cli) => cli.id === request.params.cliId)
        ) {
          response = { ok: false, error: { code: "invalid_request" } };
          break;
        }
        store.saveCliHidden(request.params.cliId, request.params.hidden);
        store.saveTerminalOperationResult(context, request.params);
        response = { ok: true, result: request.params };
        break;
      }
      case "cli.arguments.set": {
        const context = {
          clientPublicKey: session.publicKey,
          operationId: request.operationId,
        };
        const previous = store.terminalOperationResult<{
          cliId: string;
          arguments: string;
        }>(context);
        if (previous) {
          response = { ok: true, result: previous };
          break;
        }
        store.saveCliStartupArguments(
          request.params.cliId,
          request.params.arguments,
        );
        store.saveTerminalOperationResult(context, request.params);
        response = { ok: true, result: request.params };
        break;
      }
      case "cli.definition.remove":
        response = await terminalManager.removeCliDefinition(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.cliId,
        );
        if (response.ok) teamManager?.conditionsChanged();
        break;
      case "team.launch": {
        const { teamId, cwd, setupWorktree, instruction } = request.params;
        const setup = setupWorktree
          ? await worktreeSetup(cwd, store)
          : undefined;
        response = await withInstruction(instruction, (file) =>
          teamManager!.launch(
            {
              clientPublicKey: session.publicKey,
              operationId: request.operationId,
            },
            teamId,
            cwd,
            setup,
            file,
          ),
        );
        break;
      }
      case "cli.launch": {
        const { cliId, cwd, setupWorktree, instruction } = request.params;
        const setup = setupWorktree
          ? await worktreeSetup(cwd, store)
          : undefined;
        response = await withInstruction(instruction, (file) =>
          terminalManager.createTerminal(
            {
              clientPublicKey: session.publicKey,
              operationId: request.operationId,
            },
            cwd,
            undefined,
            cliId,
            undefined,
            setup,
            file
              ? {
                  // The user's own launch of this CLI: no model, effort or
                  // permission of a team's candidate is added.
                  candidate: {
                    id: cliId,
                    cli: cliId,
                    model: "",
                    tools: [],
                    minimum: "",
                  },
                  instructionFile: file,
                }
              : undefined,
          ),
        );
        break;
      }
      case "terminal.list":
        response = terminalManager.list();
        break;
      case "terminal.create":
        response = await terminalManager.createTerminal(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.cwd,
          request.params.shell,
        );
        break;
      case "terminal.setup":
        response = await terminalManager.resolveSetup(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.terminalId,
          request.params.action,
        );
        break;
      case "cli.resume":
        response = await terminalManager.resumeCli(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.terminalId,
        );
        break;
      case "terminal.image.write":
        response = await terminalManager.writeImage(request.params);
        break;
      case "terminal.close":
        response = await terminalManager.closeTerminal(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.terminalId,
          request.params.confirm ?? false,
        );
        break;
      case "terminal.defaultShell.set":
        response = await terminalManager.setDefaultShell(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.shell,
        );
        break;
      case "github.accounts":
        try {
          response = { ok: true, result: await githubAccounts(store, true) };
        } catch {
          response = responseError("read_failed");
        }
        break;
      case "repository.git.settings":
        try {
          response = {
            ok: true,
            result: await repositoryGitSettings(
              request.params.path,
              store,
              forge.detection,
            ),
          };
        } catch {
          response = responseError("git_failed");
        }
        break;
      case "repository.git.set":
        try {
          const mainPath = await repositoryMainPath(request.params.path);
          const mutation = store.saveRepositoryGitSettings(
            {
              clientPublicKey: session.publicKey,
              operationId: request.operationId,
            },
            mainPath,
            request.params,
          );
          response = mutation.response;
          if (mutation.changed) {
            if (request.params.githubAccount !== undefined)
              forge.repositoryChanged(mainPath);
            else events.publish({ type: "forge.settings.changed" });
          }
        } catch {
          response = responseError("git_failed");
        }
        break;
      case "forge.mapping.set": {
        const { remoteHost, webUrl } = request.params;
        const mutation = store.setForgeMapping(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          { remoteHost, webUrl },
        );
        response = mutation.response;
        if (mutation.changed) forge.mappingsChanged([remoteHost]);
        break;
      }
      case "forge.mapping.remove": {
        const mutation = store.removeForgeMapping(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.remoteHost,
        );
        response = mutation.response;
        if (mutation.changed)
          forge.mappingsChanged([request.params.remoteHost]);
        break;
      }
      case "forge.watch":
        forge.watch(session, request.params);
        await sendStreamResponse(stream, { ok: true, result: {} });
        return;
      case "forge.sites":
        try {
          response = {
            ok: true,
            result: await forgeSites.list(
              await discoveredForgeOrigins(store, forge.detection),
            ),
          };
        } catch {
          response = responseError("read_failed");
        }
        break;
      case "forge.token.set":
        try {
          const result = await forgeSites.register(
            request.params.origin,
            request.params.token,
            signal,
          );
          response = { ok: true, result };
          if ("site" in result) {
            forge.siteChanged(request.params.origin, true);
            mutationEvent = {
              type: "forge.token.changed",
              origin: request.params.origin,
            };
          }
        } catch (error) {
          // The Client cancelled: nothing was saved and nothing is answered.
          if (signal?.aborted) throw error;
          response = responseError("internal_error");
        }
        break;
      case "forge.token.remove":
        try {
          await forgeSites.remove(request.params.origin);
          response = { ok: true, result: { origin: request.params.origin } };
          forge.siteChanged(request.params.origin, true);
          mutationEvent = {
            type: "forge.token.changed",
            origin: request.params.origin,
          };
        } catch {
          response = responseError("internal_error");
        }
        break;
      case "forge.site.check":
        try {
          response = {
            ok: true,
            result: { site: await forgeSites.check(request.params.origin) },
          };
          forge.siteChanged(request.params.origin, false);
        } catch {
          response = responseError("read_failed");
        }
        break;
      case "forge.ci":
      case "forge.ci.log":
        response = await answerForgeCi(
          request,
          store,
          forge.detection,
          signal,
          ciLogKeep(session),
        );
        // The Client stopped the stream: the read and its gh child stopped too.
        if (signal?.aborted) return;
        break;
      case "worktrees.preview":
      case "worktrees.cleanup":
        try {
          response = {
            ok: true,
            result: await worktreeRemover.preview(
              request.params.path,
              request.method === "worktrees.cleanup",
            ),
          };
        } catch {
          response = responseError("git_failed");
        }
        break;
      case "worktrees.remove":
        try {
          response = {
            ok: true,
            result: await worktreeRemover.remove(
              {
                clientPublicKey: session.publicKey,
                operationId: request.operationId,
              },
              request.params.previewId,
              request.params.paths,
              request.params.branches,
            ),
          };
          mutationEvent = { type: "folders.changed" };
        } catch {
          response = responseError("git_failed");
        }
        break;
      case "worktrees.options":
        try {
          response = {
            ok: true,
            result: await worktreeOptions(request.params.path).then(
              (options) => ({
                ...options,
                setupCommand: store.worktreeSetupCommand(options.mainPath),
              }),
            ),
          };
        } catch {
          response = responseError("git_failed");
        }
        break;
      case "worktrees.create":
        response = {
          ok: true,
          result: await worktreeCreator.create(
            {
              clientPublicKey: session.publicKey,
              operationId: request.operationId,
            },
            request.params.path,
            request.params.name,
            request.params.baseBranch,
            request.params.setupCommand,
          ),
        };
        mutationEvent = { type: "folders.changed" };
        break;
      case "worktrees.creation":
        response = {
          ok: true,
          result: {
            creation: await worktreeCreator.status({
              clientPublicKey: session.publicKey,
              operationId: request.params.creationId,
            }),
          },
        };
        break;
      case "folders.browse":
        try {
          response = {
            ok: true,
            result: await browseFolders(request.params.path),
          };
        } catch (error) {
          response = responseError(
            error instanceof WorkspaceError ? error.code : "internal_error",
          );
        }
        break;
      case "folders.history":
        response = { ok: true, result: await workspaces.history() };
        break;
      case "folders.open": {
        const mutation = await workspaces.open(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.path,
        );
        response = mutation.response;
        if (mutation.changed) mutationEvent = { type: "folders.changed" };
        break;
      }
      case "folders.sidebar.reorder": {
        const mutation = workspaces.reorderSidebar(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.paths,
        );
        response = mutation.response;
        if (mutation.changed) mutationEvent = { type: "folders.changed" };
        break;
      }
      case "folders.sidebar.remove": {
        const mutation = workspaces.removeSidebarTarget(
          {
            clientPublicKey: session.publicKey,
            operationId: request.operationId,
          },
          request.params.path,
        );
        response = mutation.response;
        if (mutation.changed) mutationEvent = { type: "folders.changed" };
        break;
      }
    }

    try {
      await sendStreamResponse(stream, response);
    } finally {
      if (
        (request.method === "host.restart" ||
          request.method === "host.uninstall") &&
        response.ok
      )
        await maintenance.afterResponse(
          response.result as import("@iori/protocol").MaintenanceStatus,
        );
      if (mutationEvent) {
        events.publish(mutationEvent);
        if (
          mutationEvent.type === "device.registered" &&
          mutationEvent.inviteOperationId === watchedInvite?.operationId
        ) {
          stopWatchingInvite();
        }
      }
      if (request.method === "host.relay.set" && response.ok) {
        // Wait for the response bytes to reach the Client before rebinding.
        // The normal accept-loop recovery keeps Host work and its identity.
        await stream.stopped().catch(() => undefined);
        await endpoint.close();
      }
      if (revokedPublicKey) {
        for (const revoked of sessionsByKey.get(revokedPublicKey) ?? []) {
          revoked.connection.close(1, Buffer.from("not_registered"));
        }
      }
    }
  }

  async function handleStream(
    session: Session,
    stream: NativeBiStream,
  ): Promise<void> {
    const readFrame = createStreamFrameReader(
      stream,
      !store.isRegistered(session.publicKey),
    );
    let frame: unknown | undefined;
    try {
      frame = await readFrame();
    } catch {
      session.connection.close(1, Buffer.from("invalid request frame"));
      return;
    }
    if (
      typeof frame === "object" &&
      frame !== null &&
      !Array.isArray(frame) &&
      (frame as Record<string, unknown>).kind === "terminal"
    ) {
      let open;
      try {
        open = terminalOpenStreamSchema.parse(frame);
      } catch {
        await writeStreamFrame(stream, {
          kind: "terminal.error",
          message: "Invalid terminal stream request",
        }).catch(() => undefined);
        await stream.finish().catch(() => undefined);
        await stream.stop(0).catch(() => undefined);
        return;
      }
      const denied = authorizationError(store.isRegistered(session.publicKey), {
        kind: "request",
        operationId: open.operationId,
        method: "terminal.list",
        params: {},
      });
      if (denied) {
        await writeStreamFrame(stream, {
          kind: "terminal.error",
          message: denied,
        }).catch(() => undefined);
        await stream.finish().catch(() => undefined);
        await stream.stop(0).catch(() => undefined);
        return;
      }
      await terminalManager.openStream(
        session.connection,
        stream,
        open,
        readFrame,
      );
      return;
    }
    if (frame === undefined) {
      session.connection.close(1, Buffer.from("invalid request frame"));
      return;
    }
    try {
      if ((await readFrame()) !== undefined) {
        if (!store.isRegistered(session.publicKey)) {
          session.connection.close(1, Buffer.from("invalid request frame"));
          return;
        }
        await stream.stop(0).catch(() => undefined);
        await stream.reset(0).catch(() => undefined);
        return;
      }
    } catch {
      session.connection.close(1, Buffer.from("invalid request frame"));
      return;
    }
    if (isPairRequest(frame)) {
      session.inviteAttempts += 1;
      if (session.inviteAttempts > MAX_INVITE_ATTEMPTS_PER_CONNECTION) {
        session.connection.close(1, Buffer.from("invite attempt limit"));
        return;
      }
    }
    let request: Request;
    try {
      request = parseRequest(frame);
    } catch {
      await sendStreamResponse(stream, responseError("invalid_request")).catch(
        () => undefined,
      );
      return;
    }
    const controller = new AbortController();
    let responseComplete = false;
    // Reads and a token registration stop when the Client cancels them.
    const monitorStop =
      request.kind === "request" &&
      (isReadMethod(request.method) ||
        isForgeIssueMethod(request.method) ||
        isForgeCiMethod(request.method) ||
        request.method === "forge.token.set")
        ? stream
            .stopped()
            .then(() => {
              if (!responseComplete) controller.abort();
            })
            .catch(() => {
              if (!responseComplete) controller.abort();
            })
        : Promise.resolve();
    try {
      await sendRequestResponse(session, request, stream, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      const code =
        error instanceof ReadingFailure ? error.code : "internal_error";
      await sendStreamResponse(stream, responseError(code)).catch(
        () => undefined,
      );
    } finally {
      responseComplete = true;
      void monitorStop;
      if (controller.signal.aborted)
        await stream.reset(0).catch(() => undefined);
    }
  }

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
    if (peerSessions?.size === 0) sessionsByKey.delete(session.publicKey);
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
        void handleStream(activeSession, stream).catch(() => undefined);
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
      (event) => events.publish(event),
      storage.root,
      forgeCommand,
    );
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
        replacement = await addon.Endpoint.bind(
          storage.identity.secretKey,
          bindAddresses(port),
          relay?.url,
          relay?.token,
        );
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
