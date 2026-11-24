import {
  isForgeCiMethod,
  isForgeIssueMethod,
  isReadMethod,
  parseRequest,
  terminalOpenStreamSchema,
  type Request,
} from "@iori/protocol";
import { authorizationError } from "../authorization.ts";
import type { NativeBiStream } from "../native.ts";
import { ReadingFailure } from "../reading-failure.ts";
import {
  sendStreamResponse,
  responseError,
  writeStreamFrame,
  createStreamFrameReader,
} from "../host-transport.ts";
import type { Session } from "../host-transport.ts";
import type { HostServices, RequestContext, MethodRequest } from "./context.ts";
import { subscribe } from "./subscriptions.ts";
import { handleFiles } from "./files.ts";
import { handleAutomations } from "./automations.ts";
import { handleDevices } from "./devices.ts";
import { handleMaintenance } from "./maintenance.ts";
import { handleTeams } from "./teams.ts";
import { handleCli } from "./cli.ts";
import { handleTerminal } from "./terminal.ts";
import { handleForge } from "./forge.ts";
import { handleWorkspaces } from "./worktrees-folders.ts";

const MAX_INVITE_ATTEMPTS_PER_CONNECTION = 6;

function inDomain<D extends string>(
  request: Request,
  domain: D,
): request is MethodRequest<`${D}.${string}`> {
  return request.method.startsWith(`${domain}.`);
}

async function sendRequestResponse(
  host: HostServices,
  context: RequestContext,
  request: Request,
): Promise<void> {
  const { session, stream, signal } = context;
  const { store } = host;
  const denied = authorizationError(
    store.isRegistered(session.publicKey),
    request,
  );
  if (denied) {
    await sendStreamResponse(stream, responseError(denied));
    return;
  }

  if (request.kind === "subscribe") return subscribe(host, context, request);
  if (
    host.uninstalling &&
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
  if (inDomain(request, "files") || inDomain(request, "git"))
    return handleFiles(host, context, request);

  if (inDomain(request, "automation"))
    return handleAutomations(host, context, request);
  if (
    request.method === "pair" ||
    request.method === "host.relay.set" ||
    request.method === "invite.create" ||
    request.method === "notifications.push.set" ||
    inDomain(request, "devices")
  )
    return handleDevices(host, context, request);
  if (inDomain(request, "host"))
    return handleMaintenance(host, context, request);
  if (inDomain(request, "teams")) return handleTeams(host, context, request);
  if (
    request.method === "team.launch" ||
    request.method === "cli.launch" ||
    request.method === "cli.resume" ||
    inDomain(request, "terminal")
  )
    return handleTerminal(host, context, request);
  if (inDomain(request, "cli")) return handleCli(host, context, request);
  if (
    inDomain(request, "forge") ||
    inDomain(request, "repository") ||
    request.method === "github.accounts"
  )
    return handleForge(host, context, request);
  if (inDomain(request, "worktrees") || inDomain(request, "folders"))
    return handleWorkspaces(host, context, request);
  return request satisfies never;
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

export async function handleStream(
  host: HostServices,
  session: Session,
  stream: NativeBiStream,
): Promise<void> {
  const { store } = host;
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
    await host.terminalManager.openStream(
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
      request.method === "forge.pr" ||
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
    await sendRequestResponse(
      host,
      {
        session,
        stream,
        signal: controller.signal,
        operation: {
          clientPublicKey: session.publicKey,
          operationId: request.operationId,
        },
      },
      request,
    );
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
    if (controller.signal.aborted) await stream.reset(0).catch(() => undefined);
  }
}
