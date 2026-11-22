import type { Event, Response } from "@iori/protocol";
import type { HostServices, MethodRequest, RequestContext } from "./context.ts";
import { sendStreamResponse, responseError } from "../host-transport.ts";

export async function handleDevices(
  host: HostServices,
  context: RequestContext,
  request: MethodRequest<
    | "pair"
    | "invite.create"
    | "notifications.push.set"
    | "host.relay.set"
    | `devices.${string}`
  >,
): Promise<void> {
  const {
    store,
    createInvite,
    identity,
    currentAddresses,
    events,
    sessionsByKey,
    unauthenticated,
  } = host;
  const { session, operation, stream } = context;
  let mutationEvent: Event | undefined;
  let revokedPublicKey: string | undefined;
  let response: Response<unknown>;
  switch (request.method) {
    case "pair": {
      const mutation = store.pair(
        operation,
        identity,
        currentAddresses(),
        request.params.deviceName,
        request.params.secret,
        Date.now(),
      );
      if (mutation.response.ok) {
        mutation.response.result.host.relay = host.relay;
        mutation.response.result.host.connectionScope = host.connectionScope;
      }
      response = mutation.response;
      mutationEvent = mutation.event;
      if (response.ok && session.preAuth) {
        session.preAuth = false;
        unauthenticated.delete(session);
      }
      break;
    }
    case "notifications.push.set":
      store.setPushNotificationSettings(session.publicKey, request.params);
      response = { ok: true, result: {} };
      break;
    case "devices.list":
      response = store.devices(session.publicKey);
      break;
    case "invite.create":
      response =
        host.connectionScope === "loopback"
          ? responseError("invalid_request")
          : createInvite(request.operationId, session.publicKey);
      break;
    case "devices.revoke": {
      const mutation = store.revoke(operation, request.params.publicKey);
      response = mutation.response;
      mutationEvent = mutation.event;
      revokedPublicKey = mutation.revokedPublicKey;
      break;
    }
    case "host.relay.set": {
      host.setRelay(request.params.relay);
      const relay = request.params.relay;
      mutationEvent = { type: "host.relay", relay };
      response = { ok: true, result: { relay } };
      break;
    }
    default:
      return request satisfies never;
  }
  try {
    await sendStreamResponse(stream, response);
  } finally {
    if (mutationEvent) {
      events.publish(mutationEvent);
      if (mutationEvent.type === "device.registered")
        host.registered(mutationEvent);
    }
    if (request.method === "host.relay.set" && response.ok) {
      // Wait for the response bytes to reach the Client before rebinding.
      // The normal accept-loop recovery keeps Host work and its identity.
      await stream.stopped().catch(() => undefined);
      await host.rebind();
    }
    if (revokedPublicKey) {
      for (const revoked of sessionsByKey.get(revokedPublicKey) ?? []) {
        revoked.connection.close(1, Buffer.from("not_registered"));
      }
    }
  }
}
