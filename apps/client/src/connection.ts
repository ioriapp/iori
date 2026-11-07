import {
  hostReconnectPaused,
  loadHostRemovals,
  saveHostRemoval,
  type HostRemoval,
} from "./updates/host-lifecycle.ts";
import {
  eventSchema,
  parseResult,
  responseSchema,
  type Device,
  type Event as HostEvent,
  type ForgeReadFailure,
  type Invite,
  type RelaySettings,
  type RequestByMethod,
  type RequestMethod,
  type RequestParamsByMethod,
  type ResultByMethod,
  type Request,
} from "@iori/protocol";
import { native, type InitialState, type HostInfo } from "./native.ts";

function mergeAddresses(...groups: string[][]) {
  return [
    ...new Set(
      groups
        .flat()
        .map((address) => address.trim())
        .filter(Boolean),
    ),
  ];
}

export type ConnectionState = {
  initial?: InitialState;
  host?: HostInfo;
  /** Hosts whose connection is currently established, for per-Host marks. */
  connectedHosts: string[];
  routes: Record<string, "direct" | "relay" | null>;
  removals: Record<string, HostRemoval>;
  observedHosts: Record<string, HostInfo>;
  connectionId?: string;
  connected: boolean;
  foreground: boolean;
  revoked: boolean;
  devices: Device[];
  disconnectedAt?: number;
  invitation?: Invite;
  invitationStatus?: "expired" | "invalidated";
  invitedDevice?: Device;
  registrationReadHostKey?: string;
  error?: string;
  storageError: boolean;
};

const errorCopy: Record<string, string> = {
  invalid_request: "The Host could not read this request. Retry.",
  invite_rejected:
    "This invitation cannot be used. Create a new invitation on the Host.",
  internal_error: "The Host could not complete this operation. Retry.",
  host_uninstalling: "iori Host is being uninstalled. Wait for it to finish.",
};

export class ConnectionController {
  private state: ConnectionState = {
    connectedHosts: [],
    routes: {},
    removals: {},
    observedHosts: {},
    connected: false,
    foreground: true,
    revoked: false,
    devices: [],
    storageError: false,
  };
  private listeners = new Set<() => void>();
  private initialized?: Promise<void>;
  private forgottenHosts: string[] = [];
  private reconnecting?: Promise<void>;
  private pairing = false;
  private eventStops: (() => void)[] = [];
  private hostEventListeners = new Set<
    (hostKey: string, event: HostEvent) => void
  >();
  private foreground = true;
  private backgroundConnection = false;
  setBackgroundConnection = (enabled: boolean) => {
    this.backgroundConnection = enabled;
    if (enabled)
      for (const record of this.connections.values())
        if (!record.connected)
          this.scheduleHostReconnect(record.host.publicKey);
  };
  private retry?: ReturnType<typeof setTimeout>;
  private connection?: { hostKey: string; promise: Promise<string> };
  private connections = new Map<
    string,
    {
      host: HostInfo;
      connectionId?: string;
      promise?: Promise<string>;
      ready?: Promise<string>;
      connected: boolean;
      revoked: boolean;
      devices: Device[];
      disconnectedAt?: number;
      retry?: ReturnType<typeof setTimeout>;
      backoff: number;
      eventSubscriptionId?: string;
    }
  >();
  private connectionHosts = new Map<string, string>();
  private invitationOperationId?: string;
  private pendingInvitationOperationId?: string;
  private pendingInvitationStatus?: "expired" | "invalidated";
  private pairOperation?: { secret: string; id: string };
  private pendingHost?: HostInfo;
  private pendingHostSelected = false;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private setConnected(
    record: { host: HostInfo; connected: boolean },
    value: boolean,
  ) {
    record.connected = value;
    const key = record.host.publicKey;
    if (this.state.connectedHosts.includes(key) === value) return;
    this.update({
      connectedHosts: value
        ? [...this.state.connectedHosts, key]
        : this.state.connectedHosts.filter((item) => item !== key),
    });
  }
  private update(patch: Partial<ConnectionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  initialize = () => {
    if (this.initialized) return this.initialized;
    this.initialized = this.start();
    return this.initialized;
  };
  private async start() {
    try {
      this.eventStops.push(
        await native.onStream(({ connectionId, subscriptionId, json }) => {
          try {
            const hostKey = this.connectionHosts.get(connectionId);
            if (!hostKey) return;
            const record = this.connections.get(hostKey);
            // Files and Git own their watch subscriptions on the same connection.
            if (subscriptionId !== record?.eventSubscriptionId) return;
            const event = eventSchema.parse(JSON.parse(json));
            if (!event) return;
            for (const listener of this.hostEventListeners) {
              try {
                listener(hostKey, event);
              } catch {
                /* One receiver owns its exception. */
              }
            }
            if (event.type === "snapshot") {
              const knownHost = record?.host;
              const host: HostInfo = {
                ...knownHost,
                ...event.host,
                relay: event.host.relay,
                publicKey: hostKey,
                addresses: mergeAddresses(
                  knownHost?.addresses ?? [],
                  event.host.addresses,
                ),
              };
              this.update({
                observedHosts: { ...this.state.observedHosts, [hostKey]: host },
              });
              if (record) {
                record.host = host;
                record.devices = event.devices;
                this.setConnected(record, true);
                record.revoked = false;
                record.disconnectedAt = undefined;
                record.backoff = 1000;
              }
              if (this.state.host?.publicKey === hostKey)
                this.update({
                  host,
                  devices: event.devices,
                  connected: true,
                  revoked: false,
                  disconnectedAt: undefined,
                  error: undefined,
                });
              void this.saveHost(host);
            } else if (event.type === "host.relay" && record) {
              const host = { ...record.host, relay: event.relay };
              record.host = host;
              if (this.state.host?.publicKey === hostKey) this.update({ host });
              void this.saveHost(host);
            } else if (event.type === "device.registered") {
              const devices = [
                ...(record?.devices ?? []).filter(
                  (d) => d.publicKey !== event.device.publicKey,
                ),
                event.device,
              ];
              if (record) record.devices = devices;
              if (this.state.host?.publicKey === hostKey)
                this.update({
                  devices,
                  ...(event.inviteOperationId === this.invitationOperationId
                    ? { invitedDevice: event.device }
                    : {}),
                });
            } else if (event.type === "device.revoked") {
              const devices = (record?.devices ?? []).filter(
                (d) => d.publicKey !== event.publicKey,
              );
              if (record) record.devices = devices;
              if (this.state.host?.publicKey === hostKey)
                this.update({ devices });
              if (event.publicKey === this.state.initial?.publicKey && record) {
                record.revoked = true;
                this.setConnected(record, false);
                record.connectionId = undefined;
                record.promise = undefined;
                if (record.retry) clearTimeout(record.retry);
                record.retry = undefined;
                this.connectionHosts.delete(connectionId);
                if (this.state.host?.publicKey === hostKey) this.revoked();
                else
                  void native.disconnect(connectionId).catch(() => undefined);
              }
            } else if (event.type === "invite.status") {
              if (this.state.host?.publicKey !== hostKey) return;
              if (event.operationId === this.invitationOperationId)
                this.update({ invitationStatus: event.status });
              else if (event.operationId === this.pendingInvitationOperationId)
                this.pendingInvitationStatus = event.status;
            } else if (event.type === "host.addresses" && record) {
              const host = {
                ...record.host,
                publicKey: hostKey,
                addresses: mergeAddresses(
                  record.host.addresses,
                  event.addresses,
                ),
              };
              record.host = host;
              if (this.state.host?.publicKey === hostKey) this.update({ host });
              void this.saveHost(host);
            }
          } catch {
            // Discard only this event; later events and other streams stay usable.
          }
        }),
      );
      this.eventStops.push(
        await native.onConnectionRoute(({ hostKey, connectionId, route }) => {
          const record = this.connections.get(hostKey);
          if (record?.connectionId && record.connectionId !== connectionId)
            return;
          this.update({ routes: { ...this.state.routes, [hostKey]: route } });
        }),
      );
      this.eventStops.push(
        await native.onDisconnected(({ connectionId, reason }) => {
          const hostKey = this.connectionHosts.get(connectionId);
          if (!hostKey) return;
          const record = this.connections.get(hostKey);
          this.connectionHosts.delete(connectionId);
          if (record) {
            record.connectionId = undefined;
            record.promise = undefined;
            this.setConnected(record, false);
            record.disconnectedAt = record.disconnectedAt ?? Date.now();
            if (reason === "not_registered") {
              record.revoked = true;
              if (record.retry) clearTimeout(record.retry);
              record.retry = undefined;
            }
          }
          if (this.state.host?.publicKey !== hostKey) {
            if (record && reason !== "not_registered")
              this.scheduleHostReconnect(hostKey);
            return;
          }
          this.connection = undefined;
          if (reason === "not_registered") {
            this.revoked(false);
            return;
          }
          this.update({
            connectionId: undefined,
            connected: false,
            disconnectedAt: this.state.disconnectedAt ?? Date.now(),
          });
          this.scheduleReconnect();
        }),
      );
      this.eventStops.push(
        await native.onSubscriptionEnded(({ connectionId, subscriptionId }) => {
          const hostKey = this.connectionHosts.get(connectionId);
          if (!hostKey) return;
          const record = this.connections.get(hostKey);
          if (subscriptionId !== record?.eventSubscriptionId) return;
          if (record) this.setConnected(record, false);
          if (this.state.host?.publicKey === hostKey && !this.state.revoked)
            this.update({
              connected: false,
              disconnectedAt: this.state.disconnectedAt ?? Date.now(),
            });
          if (record && !this.pairing && !record.revoked)
            this.scheduleHostReconnect(hostKey);
        }),
      );
      this.eventStops.push(
        await native.onForeground((foreground) =>
          this.setForeground(foreground),
        ),
      );
      const removals = await loadHostRemovals();
      this.forgottenHosts =
        (await native.loadView<string[]>("forgotten-hosts")) ?? [];
      const initial = await native.initial();
      initial.hosts = initial.hosts.filter(
        (host) => !this.forgottenHosts.includes(host.publicKey),
      );
      this.update({ removals });
      this.update({ initial, error: undefined });
      for (const host of initial.hosts) this.recordFor(host);
      const activeHostKey = initial.activeHostKey;
      const host =
        initial.hosts.find((host) => host.publicKey === activeHostKey) ??
        initial.hosts[0];
      if (host) {
        this.recordFor(host);
        this.update({ host, disconnectedAt: Date.now() });
        void this.reconnect();
      }
    } catch (error) {
      this.update({
        error:
          typeof error === "string" &&
          [
            "Cannot store iori's key in the system keyring (Secret Service). Turn on a keyring such as GNOME Keyring or KWallet, then open iori again.",
            "Unlocking the keyring was cancelled. You can try again.",
            "Cannot read iori's key from the system keyring.",
          ].includes(error)
            ? error
            : "Could not load this device’s key and registrations. Retry.",
      });
      for (const stop of this.eventStops) stop();
      this.eventStops = [];
      this.initialized = undefined;
    }
  }
  clearError = () => this.update({ error: undefined });
  async setRemoval(key: string, value: HostRemoval) {
    await saveHostRemoval(key, value).catch((error) => {
      this.update({ storageError: true });
      throw error;
    });
    const record = this.connections.get(key);
    if (record?.retry) clearTimeout(record.retry);
    if (record) record.retry = undefined;
    this.update({ removals: { ...this.state.removals, [key]: value } });
  }
  async clearRemoval(key: string) {
    await saveHostRemoval(key).catch((error) => {
      this.update({ storageError: true });
      throw error;
    });
    const removals = { ...this.state.removals };
    delete removals[key];
    this.update({ removals });
  }
  async forgetHost(key: string) {
    if (!this.forgottenHosts.includes(key)) {
      this.forgottenHosts = [...this.forgottenHosts, key];
      await native
        .saveView("forgotten-hosts", this.forgottenHosts)
        .catch((error) => {
          this.forgottenHosts = this.forgottenHosts.filter(
            (item) => item !== key,
          );
          this.update({ storageError: true });
          throw error;
        });
    }
    const record = this.connections.get(key);
    if (record?.retry) clearTimeout(record.retry);
    this.connections.delete(key);
    if (record?.connectionId) {
      this.connectionHosts.delete(record.connectionId);
      await native.disconnect(record.connectionId).catch(() => {});
    }
    const initial = this.state.initial!;
    const hosts = initial.hosts.filter((host) => host.publicKey !== key);
    const active = this.state.host?.publicKey === key;
    const observedHosts = { ...this.state.observedHosts };
    delete observedHosts[key];
    this.update({
      initial: { ...initial, hosts },
      observedHosts,
      connectedHosts: this.state.connectedHosts.filter((item) => item !== key),
      ...(active
        ? {
            host: undefined,
            connectionId: undefined,
            connected: false,
            devices: [],
          }
        : {}),
    });
    if (active && hosts[0]) await this.selectHost(hosts[0].publicKey);
  }
  /** The open connection to a Host, for streams such as Terminals. */
  connectionIdOf = (hostKey: string) =>
    this.connections.get(hostKey)?.connectionId;
  subscribeHostEvents = (
    listener: (hostKey: string, event: HostEvent) => void,
  ) => {
    this.hostEventListeners.add(listener);
    return () => this.hostEventListeners.delete(listener);
  };
  private recordFor(host: HostInfo) {
    let record = this.connections.get(host.publicKey);
    if (!record) {
      record = {
        host,
        connected: false,
        revoked: false,
        devices: [],
        backoff: 1000,
      };
      this.connections.set(host.publicKey, record);
    } else {
      record.host = host;
    }
    return record;
  }
  selectHost = async (publicKey: string) => {
    const host = this.state.initial?.hosts.find(
      (candidate) => candidate.publicKey === publicKey,
    );
    if (!host) return;
    if (this.state.host?.publicKey !== publicKey) {
      this.invitationOperationId = undefined;
      this.pendingInvitationOperationId = undefined;
      this.pendingInvitationStatus = undefined;
    }
    const record = this.recordFor(host);
    if (record.connectionId && record.promise)
      this.connection = { hostKey: publicKey, promise: record.promise };
    else this.connection = undefined;
    this.update({
      host,
      connectionId: record.connectionId,
      connected: record.connected,
      revoked: record.revoked,
      devices: record.devices,
      disconnectedAt: record.disconnectedAt ?? Date.now(),
      error: undefined,
      ...(this.state.host?.publicKey !== publicKey
        ? {
            invitation: undefined,
            invitationStatus: undefined,
            invitedDevice: undefined,
          }
        : {}),
    });
    await this.saveHost(host, true);
    if (!record.connected && !hostReconnectPaused(publicKey))
      void this.reconnectHost(publicKey);
  };
  requestHost = async <M extends RequestMethod>(
    hostKey: string,
    method: M,
    params: RequestParamsByMethod[M],
    operationId = crypto.randomUUID(),
    /** Stops the request's stream, as reads are cancelled; the Host stops too. */
    signal?: AbortSignal,
  ): Promise<
    | { ok: true; result: ResultByMethod[M] }
    | { ok: false; error: { code: string; forge?: ForgeReadFailure } }
    | undefined
  > => {
    const record = this.connections.get(hostKey);
    if (!record) return undefined;
    let id = record.connectionId;
    if (!id || !record.connected) {
      try {
        id = await this.reconnectHost(hostKey);
      } catch {
        return undefined;
      }
    }
    const request = {
      kind: "request",
      method,
      operationId,
      params,
    } as RequestByMethod;
    signal?.throwIfAborted();
    const cancel = () => {
      void native.cancelStream(operationId).catch(() => undefined);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await this.send(
        id,
        request,
        false,
        signal ? operationId : undefined,
      );
      signal?.throwIfAborted();
      if (!response.ok) return response;
      return { ok: true, result: parseResult(method, response.result) };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  };
  private revoked(disconnect = true) {
    const connectionId = this.state.connectionId;
    const record = this.state.host
      ? this.connections.get(this.state.host.publicKey)
      : undefined;
    if (record) {
      record.revoked = true;
      this.setConnected(record, false);
      record.connectionId = undefined;
      record.promise = undefined;
      record.ready = undefined;
      if (record.retry) clearTimeout(record.retry);
      if (this.retry === record.retry) this.retry = undefined;
      record.retry = undefined;
    }
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    this.connection = undefined;
    this.update({
      connected: false,
      revoked: true,
      connectionId: undefined,
      error: undefined,
    });
    if (connectionId) this.connectionHosts.delete(connectionId);
    if (disconnect && connectionId)
      void native.disconnect(connectionId).catch(() => undefined);
  }
  private canReconnect() {
    return (
      !this.state.initial?.mobile ||
      this.foreground ||
      this.backgroundConnection
    );
  }
  setForeground = (foreground: boolean) => {
    if (this.foreground !== foreground) {
      this.foreground = foreground;
      this.update({ foreground });
    }
    if (!this.canReconnect()) {
      for (const record of this.connections.values()) {
        if (record.retry) clearTimeout(record.retry);
        record.retry = undefined;
      }
      this.retry = undefined;
    } else if (!this.pairing) {
      for (const record of this.connections.values())
        if (!record.connected && !record.revoked)
          void this.reconnectHost(record.host.publicKey).catch(() => undefined);
    }
  };
  private scheduleReconnect() {
    const hostKey = this.state.host?.publicKey;
    if (hostKey) this.scheduleHostReconnect(hostKey);
  }
  private scheduleHostReconnect(hostKey: string) {
    const record = this.connections.get(hostKey);
    if (
      !record ||
      record.retry ||
      this.pairing ||
      !this.canReconnect() ||
      record.revoked ||
      hostReconnectPaused(hostKey)
    )
      return;
    const delay = Math.min(10000, record.backoff * (0.8 + Math.random() * 0.4));
    record.backoff = Math.min(10000, record.backoff * 1.6);
    const retry = setTimeout(() => {
      record.retry = undefined;
      if (this.retry === retry) this.retry = undefined;
      void this.reconnectHost(hostKey).catch(() => undefined);
    }, delay);
    record.retry = retry;
    if (this.state.host?.publicKey === hostKey) this.retry = retry;
  }
  private async connect(host: HostInfo) {
    const record = this.recordFor(host);
    if (record.connectionId) return record.connectionId;
    if (record.promise) return record.promise;
    const promise = native.connect(host).then(({ connectionId }) => {
      record.connectionId = connectionId;
      record.disconnectedAt = undefined;
      this.connectionHosts.set(connectionId, host.publicKey);
      if (this.state.host?.publicKey === host.publicKey)
        this.update({ connectionId });
      return connectionId;
    });
    record.promise = promise;
    if (this.state.host?.publicKey === host.publicKey)
      this.connection = { hostKey: host.publicKey, promise };
    try {
      return await promise;
    } catch (error) {
      record.promise = undefined;
      if (this.connection?.hostKey === host.publicKey)
        this.connection = undefined;
      throw error;
    }
  }
  private reconnectHost = async (hostKey: string) => {
    const record = this.connections.get(hostKey);
    if (
      !record ||
      record.revoked ||
      hostReconnectPaused(hostKey) ||
      !this.canReconnect()
    )
      throw new Error("Host is unavailable");
    if (record.retry) clearTimeout(record.retry);
    record.retry = undefined;
    if (this.state.host?.publicKey === hostKey) this.retry = undefined;
    if (record.ready) return record.ready;
    // A retry scheduled while connecting can fire after the connection is ready.
    // Keep its live event subscription instead of opening a gap in delivery.
    if (record.connected && record.connectionId) return record.connectionId;
    record.ready = (async () => {
      try {
        const id = await this.connect(record.host);
        const response = await this.send(
          id,
          {
            kind: "request",
            method: "host.info",
            operationId: crypto.randomUUID(),
            params: {},
          },
          false,
        );
        if (!response?.ok) throw new Error("Host info unavailable");
        await this.subscribeEvents(record, id);
        this.setConnected(record, true);
        record.disconnectedAt = undefined;
        if (this.state.host?.publicKey === hostKey)
          this.update({
            connectionId: id,
            connected: true,
            disconnectedAt: undefined,
            error: undefined,
          });
        return id;
      } catch (error) {
        this.setConnected(record, false);
        record.disconnectedAt ??= Date.now();
        if (this.state.host?.publicKey === hostKey)
          this.update({
            connected: false,
            disconnectedAt: record.disconnectedAt,
          });
        this.scheduleHostReconnect(hostKey);
        throw error;
      } finally {
        record.ready = undefined;
      }
    })();
    return record.ready;
  };
  reconnect = () => {
    if (this.reconnecting) return this.reconnecting;
    this.reconnecting = this.attemptReconnect().finally(() => {
      this.reconnecting = undefined;
    });
    return this.reconnecting;
  };
  private attemptReconnect = async () => {
    if (!this.state.host || this.state.revoked || !this.canReconnect()) return;
    try {
      await this.reconnectHost(this.state.host.publicKey);
    } catch {
      // Reconnect scheduling is owned by the Host record.
    }
  };
  private async send(
    id: string,
    request: Request,
    showError = true,
    cancelKey?: string,
  ) {
    const response = responseSchema.parse(
      JSON.parse(await native.request(id, JSON.stringify(request), cancelKey)),
    );
    if (!response.ok) {
      const hostKey = this.connectionHosts.get(id);
      const record = hostKey ? this.connections.get(hostKey) : undefined;
      if (response.error.code === "not_registered") {
        if (record) {
          record.revoked = true;
          this.setConnected(record, false);
          record.connectionId = undefined;
          record.promise = undefined;
          if (record.retry) clearTimeout(record.retry);
          record.retry = undefined;
        }
        if (this.state.host?.publicKey === hostKey) this.revoked();
        else void native.disconnect(id).catch(() => undefined);
      } else if (response.error.code === "device_not_found") {
        if (request.method === "devices.revoke" && record) {
          record.devices = record.devices.filter(
            (device) => device.publicKey !== request.params.publicKey,
          );
          if (this.state.host?.publicKey === hostKey)
            this.update({ devices: record.devices });
        }
      } else if (
        showError &&
        (this.state.host?.publicKey === hostKey || request.method === "pair")
      )
        this.update({ error: errorCopy[response.error.code] });
    }
    return response;
  }
  pair = async (
    invite: Invite,
    deviceName: string,
    sshDestination?: string,
  ) => {
    const previousHost = this.state.host;
    this.pairing = true;
    let registered = false;
    try {
      registered = await this.useInvite(invite, deviceName, sshDestination);
      return registered;
    } finally {
      this.pairing = false;
      if (registered && !this.state.connected) this.scheduleReconnect();
      else if (!registered && previousHost && !this.state.revoked)
        void this.reconnect();
    }
  };
  private useInvite = async (
    invite: Invite,
    deviceName: string,
    sshDestination?: string,
  ) => {
    this.clearError();
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    const host = {
      publicKey: invite.hostKey,
      hostName: invite.hostName,
      addresses: invite.addresses,
      relay: invite.relayUrl ? { url: invite.relayUrl } : undefined,
    };
    if (this.pairOperation?.secret !== invite.secret)
      this.pairOperation = { secret: invite.secret, id: crypto.randomUUID() };
    let id: string;
    try {
      id = await this.connect(host);
    } catch {
      this.update({
        error:
          "Could not reach the Host. Retry with this invitation or check that the Host is running.",
      });
      return false;
    }
    try {
      const response = await this.send(id, {
        kind: "request",
        method: "pair",
        operationId: this.pairOperation.id,
        params: { secret: invite.secret, deviceName },
      });
      if (!response.ok) return false;
      const result = parseResult("pair", response.result);
      const host: HostInfo = {
        ...result.host,
        sshDestination,
        publicKey: invite.hostKey,
        addresses: mergeAddresses(invite.addresses, result.host.addresses),
      };
      const record = this.recordFor(host);
      record.devices = [result.device];
      record.revoked = false;
      this.setConnected(record, false);
      record.disconnectedAt = Date.now();
      record.connectionId = id;
      this.connectionHosts.set(id, host.publicKey);
      this.connection = {
        hostKey: host.publicKey,
        promise: Promise.resolve(id),
      };
      this.update({
        connectionId: id,
        host,
        revoked: false,
        connected: false,
        disconnectedAt: Date.now(),
        devices: [result.device],
        invitation: undefined,
        invitationStatus: undefined,
        invitedDevice: undefined,
        registrationReadHostKey: invite.hostKey,
      });
      this.invitationOperationId = undefined;
      this.pendingInvitationOperationId = undefined;
      this.pendingInvitationStatus = undefined;
      this.forgottenHosts = this.forgottenHosts.filter(
        (key) => key !== host.publicKey,
      );
      await native.saveView("forgotten-hosts", this.forgottenHosts);
      await this.clearRemoval(host.publicKey);
      await this.saveHost(host, true);
      await this.subscribeEvents(record, id);
      this.pairOperation = undefined;
      return true;
    } catch {
      // The stream was lost: do not declare the operation failed or replay it.
      return false;
    }
  };
  /** The id is chosen first so that no event is missed before the reply. */
  private async subscribeEvents(
    record: { eventSubscriptionId?: string },
    id: string,
  ) {
    const subscriptionId = crypto.randomUUID();
    record.eventSubscriptionId = subscriptionId;
    await native.subscribe(
      id,
      JSON.stringify({
        kind: "subscribe",
        method: "events",
        operationId: subscriptionId,
        params: {},
      }),
      subscriptionId,
    );
  }
  private async saveHost(host: HostInfo, select = false) {
    this.recordFor(host).host = host;
    const selectHost =
      select ||
      (this.pendingHost?.publicKey === host.publicKey &&
        this.pendingHostSelected);
    try {
      await native.saveHost(host, selectHost);
      this.pendingHost = undefined;
      this.pendingHostSelected = false;
      this.update({
        storageError: false,
        initial: this.state.initial
          ? (() => {
              const hosts = this.state.initial!.hosts;
              const exists = hosts.some(
                (item) => item.publicKey === host.publicKey,
              );
              const updated = exists
                ? hosts.map((item) =>
                    item.publicKey === host.publicKey ? host : item,
                  )
                : [...hosts, host];
              return {
                ...this.state.initial,
                activeHostKey: selectHost
                  ? host.publicKey
                  : this.state.initial!.activeHostKey,
                hosts: updated,
              };
            })()
          : undefined,
      });
    } catch {
      this.pendingHost = host;
      this.pendingHostSelected = selectHost;
      this.update({ storageError: true });
    }
  }
  retrySave = async () => {
    if (this.pendingHost)
      await this.saveHost(this.pendingHost, this.pendingHostSelected);
  };
  markRegistrationDevicesRead = (hostKey: string) => {
    if (this.state.registrationReadHostKey === hostKey)
      this.update({ registrationReadHostKey: undefined });
  };
  createInvite = async () => {
    const { connectionId, host } = this.state;
    if (!connectionId || !host) return;
    this.clearError();
    const operationId = crypto.randomUUID();
    this.pendingInvitationOperationId = operationId;
    this.pendingInvitationStatus = undefined;
    try {
      const response = await this.send(connectionId, {
        kind: "request",
        method: "invite.create",
        operationId,
        params: {},
      });
      if (
        response.ok &&
        this.state.host?.publicKey === host.publicKey &&
        this.pendingInvitationOperationId === operationId
      ) {
        const { invite } = parseResult("invite.create", response.result);
        this.invitationOperationId = operationId;
        this.update({
          invitation: invite,
          invitationStatus: this.pendingInvitationStatus,
          invitedDevice: undefined,
        });
      }
    } catch {
      /* A lost response does not establish a failed invitation. */
    } finally {
      if (this.pendingInvitationOperationId === operationId) {
        this.pendingInvitationOperationId = undefined;
        this.pendingInvitationStatus = undefined;
      }
    }
  };
  revoke = async (publicKey: string) => {
    const { connectionId, host } = this.state;
    if (!connectionId || !host) return false;
    const record = this.connections.get(host.publicKey);
    try {
      const response = await this.send(
        connectionId,
        {
          kind: "request",
          method: "devices.revoke",
          operationId: crypto.randomUUID(),
          params: { publicKey },
        },
        false,
      );
      if (response.ok) {
        if (record)
          record.devices = record.devices.filter(
            (d) => d.publicKey !== publicKey,
          );
        if (this.state.host?.publicKey === host.publicKey) {
          this.update({
            devices: this.state.devices.filter(
              (d) => d.publicKey !== publicKey,
            ),
          });
          if (publicKey === this.state.initial?.publicKey) this.revoked();
        } else if (publicKey === this.state.initial?.publicKey && record) {
          record.revoked = true;
          this.setConnected(record, false);
          const id = record.connectionId;
          record.connectionId = undefined;
          record.promise = undefined;
          record.ready = undefined;
          if (record.retry) clearTimeout(record.retry);
          record.retry = undefined;
          if (id) {
            this.connectionHosts.delete(id);
            void native.disconnect(id).catch(() => undefined);
          }
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };
  updateRelay = async (relay?: RelaySettings) => {
    const host = this.state.host;
    if (!host) return false;
    const result = await this.requestHost(host.publicKey, "host.relay.set", {
      relay,
    });
    if (!result?.ok) return false;
    const updated = {
      ...this.recordFor(host).host,
      relay: result.result.relay,
    };
    if (this.state.host?.publicKey === host.publicKey)
      this.update({ host: updated });
    await this.saveHost(updated);
    return true;
  };
  updateAddresses = async (addresses: string[]) => {
    if (!this.state.host) return;
    const host = { ...this.state.host, addresses };
    const hostKey = host.publicKey;
    const record = this.connections.get(hostKey);
    const id = record?.connectionId ?? this.state.connectionId;
    if (record) {
      record.host = host;
      this.setConnected(record, false);
      record.connectionId = undefined;
      record.promise = undefined;
      if (record.retry) clearTimeout(record.retry);
      if (this.retry === record.retry) this.retry = undefined;
      record.retry = undefined;
    }
    if (id) this.connectionHosts.delete(id);
    this.update({ host, connectionId: undefined, connected: false });
    this.connection = undefined;
    await this.saveHost(host);
    if (id) await native.disconnect(id).catch(() => undefined);
    try {
      await this.reconnectHost(hostKey);
    } catch {
      // reconnectHost schedules the next attempt on this Host's record.
    }
  };
}

export const connection = new ConnectionController();
