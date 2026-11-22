import type { Event, SubscribeRequest } from "@iori/protocol";
import { ReadingFailure, errorCode } from "../reading-failure.ts";
import { watchReading } from "../reading-watch.ts";
import type { HostServices, RequestContext } from "./context.ts";
import {
  sendStreamResponse,
  writeStreamFrame,
  responseError,
} from "../host-transport.ts";

export async function subscribe(
  host: HostServices,
  { session, stream }: RequestContext,
  request: SubscribeRequest,
): Promise<void> {
  const { hostInfo, store, currentAddresses, identity, events } = host;
  if (request.method === "reading.watch") {
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

  if (request.method === "events") {
    const info = await hostInfo();
    const subscription = events.addSubscription(session.connection, stream);
    try {
      await events.send(subscription, {
        ...store.snapshot(identity, currentAddresses(), session.publicKey),
        host: {
          ...info,
          ...store.hostInfo(identity, currentAddresses()),
          connectionScope: host.connectionScope,
          relay: host.relay,
        },
      } as Extract<Event, { type: "snapshot" }>);
      const expired = host.expiredInviteStatus();
      if (expired) await events.send(subscription, expired);
      await stream.stopped();
    } catch {
      // The subscription ended or the connection closed.
    } finally {
      events.removeSubscription(subscription);
      await stream.reset(0).catch(() => undefined);
    }
    return;
  }
  return request satisfies never;
}
