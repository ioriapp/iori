import type {
  Request,
  HostInfo,
  Event,
  RelaySettings,
  Response,
} from "@iori/protocol";
import type { HostIdentity, HostStore, StoreContext } from "../store.ts";
import type { EventHub } from "../event-hub.ts";
import type { Session } from "../host-transport.ts";
import type { NativeBiStream } from "../native.ts";
import type { TerminalManager } from "../terminal/manager.ts";
import type { TeamManager } from "../teams/manager.ts";
import type { AutomationManager } from "../automations/manager.ts";
import type { FileUploads } from "../files-writing.ts";
import type { ForgeWatcher } from "../forge-watch.ts";
import type { ForgeSites } from "../forge/sites.ts";
import type { CiLogKeep } from "../forge/ci.ts";
import type { WorktreeRemover } from "../worktree-removal.ts";
import type { WorktreeCreator } from "../worktree-creation.ts";
import type { WorkspaceService } from "../workspace.ts";
import type { MaintenanceManager } from "../maintenance/manager.ts";
import type { ConnectionScope } from "../connection-scope.ts";

export type MethodRequest<M extends string> = Extract<Request, { method: M }>;

export interface RequestContext {
  session: Session;
  operation: StoreContext;
  stream: NativeBiStream;
  signal: AbortSignal;
}

export interface HostServices {
  store: HostStore;
  events: EventHub;
  identity: HostIdentity;
  root: string;
  hostInfo(): Promise<HostInfo>;
  currentAddresses(): string[];
  readonly relay: RelaySettings | undefined;
  readonly connectionScope: ConnectionScope;
  createInvite(operationId: string, publicKey: string): Response;
  expiredInviteStatus(): Event | undefined;
  registered(event: Extract<Event, { type: "device.registered" }>): void;
  setRelay(relay: RelaySettings | undefined): void;
  rebind(): Promise<void>;
  unauthenticated: Set<Session>;
  sessionsByKey: Map<string, Set<Session>>;
  readonly uninstalling: boolean;
  readonly terminalManager: TerminalManager;
  readonly teamManager: TeamManager;
  readonly automationManager: AutomationManager;
  maintenance: MaintenanceManager;
  fileUploads: FileUploads;
  forge: ForgeWatcher;
  forgeSites: ForgeSites;
  ciLogKeep(session: Session): CiLogKeep;
  worktreeCreator: WorktreeCreator;
  worktreeRemover: WorktreeRemover;
  workspaces: WorkspaceService;
}

export function matchesMethod<M extends Request["method"]>(
  request: Request,
  matches: (method: Request["method"]) => method is M,
): request is MethodRequest<M> {
  return matches(request.method);
}
