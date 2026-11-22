import { createHash, timingSafeEqual } from "node:crypto";
import type {
  Device,
  Event,
  HostInfo,
  Invite,
  PushNotificationSettings,
  Response,
  ResultByMethod,
} from "@iori/protocol";
import {
  type Connection,
  type Mutation,
  type StoreContext,
  succeeded,
  failure,
} from "./connection.ts";

export const INVITE_LIFETIME_MS = 10 * 60 * 1000;

export interface HostIdentity {
  publicKey: string;
  hostName: string;
  os: string;
}

interface InviteRow {
  secret: string;
  expires_at: number;
  issuer_operation_id: string;
}

export interface CurrentInvite {
  operationId: string;
  expiresAt: number;
}

interface DeviceRow {
  public_key: string;
  name: string;
  registered_at: number;
}

function toDevice(row: DeviceRow): Device {
  return {
    publicKey: row.public_key,
    name: row.name,
    registeredAt: row.registered_at,
  };
}

export function createDevicesRepository({
  database,
  transaction,
  readOperation,
  saveOperation,
}: Connection) {
  function setPushNotificationSettings(
    publicKey: string,
    settings: PushNotificationSettings,
  ): void {
    if (settings.subscription)
      database
        .prepare(
          "INSERT INTO push_subscriptions(device_public_key, value_json) VALUES (?, ?) ON CONFLICT(device_public_key) DO UPDATE SET value_json = excluded.value_json",
        )
        .run(publicKey, JSON.stringify(settings));
    else
      database
        .prepare("DELETE FROM push_subscriptions WHERE device_public_key = ?")
        .run(publicKey);
  }

  function pushSubscriptions(): {
    publicKey: string;
    settings: PushNotificationSettings;
  }[] {
    const rows = database
      .prepare("SELECT device_public_key, value_json FROM push_subscriptions")
      .all() as { device_public_key: string; value_json: string }[];
    return rows.map((row) => ({
      publicKey: row.device_public_key,
      settings: JSON.parse(row.value_json) as PushNotificationSettings,
    }));
  }

  function removePushSubscription(
    publicKey: string,
    settings: PushNotificationSettings,
  ): void {
    // A failed in-flight delivery must not remove a replacement registration.
    database
      .prepare(
        "DELETE FROM push_subscriptions WHERE device_public_key = ? AND value_json = ?",
      )
      .run(publicKey, JSON.stringify(settings));
  }

  function hostInfo(identity: HostIdentity, addresses: string[]): HostInfo {
    return {
      pushNotifications: true,
      publicKey: identity.publicKey,
      hostName: identity.hostName,
      os: identity.os,
      addresses,
    };
  }

  function isRegistered(publicKey: string): boolean {
    return (
      database
        .prepare("SELECT 1 FROM devices WHERE public_key = ?")
        .get(publicKey) !== undefined
    );
  }

  function currentInvite(): CurrentInvite | undefined {
    const row = database
      .prepare(
        "SELECT issuer_operation_id, expires_at FROM invite WHERE singleton = 1",
      )
      .get() as { issuer_operation_id: string; expires_at: number } | undefined;
    if (!row) return undefined;
    return {
      operationId: row.issuer_operation_id,
      expiresAt: row.expires_at,
    };
  }

  function listDevices(): Device[] {
    const rows = database
      .prepare(
        "SELECT public_key, name, registered_at FROM devices ORDER BY registered_at, public_key",
      )
      .all() as unknown as DeviceRow[];
    return rows.map(toDevice);
  }

  function snapshot(
    identity: HostIdentity,
    addresses: string[],
    currentDevicePublicKey: string,
  ): Event {
    return {
      type: "snapshot",
      host: hostInfo(identity, addresses),
      devices: listDevices(),
      currentDevicePublicKey,
    };
  }

  function info(
    identity: HostIdentity,
    addresses: string[],
  ): Response<HostInfo> {
    return succeeded(hostInfo(identity, addresses));
  }
  function devices(
    currentDevicePublicKey: string,
  ): Response<ResultByMethod["devices.list"]> {
    return succeeded({
      devices: listDevices(),
      currentDevicePublicKey,
    });
  }
  function createInvite(
    context: StoreContext,
    identity: HostIdentity,
    addresses: string[],
    secret: string,
    createdAt: number,
    relayUrl?: string,
  ): Response<ResultByMethod["invite.create"]> {
    return transaction(() => {
      // Bind replay to the issuing device without caching the invite secret.
      const previous = readOperation<{ inviteExpiresAt: number }>(
        context.clientPublicKey,
        context.operationId,
      );
      const current = database
        .prepare(
          "SELECT secret, expires_at FROM invite WHERE issuer_operation_id = ?",
        )
        .get(context.operationId) as
        Pick<InviteRow, "secret" | "expires_at"> | undefined;
      const invite: Invite = {
        version: 1,
        ...(relayUrl ? { relayUrl } : {}),
        hostKey: identity.publicKey,
        addresses,
        secret,
        expiresAt: createdAt + INVITE_LIFETIME_MS,
        hostName: identity.hostName,
      };
      if (previous || current) {
        if (
          !current ||
          previous?.inviteExpiresAt !== current.expires_at ||
          createdAt >= current.expires_at
        )
          return failure("invalid_request");
        invite.secret = current.secret;
        invite.expiresAt = current.expires_at;
      } else {
        database
          .prepare(
            "INSERT INTO invite (singleton, secret, expires_at, issuer_operation_id) VALUES (1, ?, ?, ?) ON CONFLICT(singleton) DO UPDATE SET secret = excluded.secret, expires_at = excluded.expires_at, issuer_operation_id = excluded.issuer_operation_id",
          )
          .run(invite.secret, invite.expiresAt, context.operationId);
        saveOperation(
          context,
          succeeded({ inviteExpiresAt: invite.expiresAt }),
        );
      }
      return succeeded({ invite });
    });
  }

  function pair(
    context: StoreContext,
    identity: HostIdentity,
    addresses: string[],
    deviceName: string,
    presentedSecret: string,
    registeredAt: number,
  ): Mutation<ResultByMethod["pair"]> {
    const previous = readOperation<ResultByMethod["pair"]>(
      context.clientPublicKey,
      context.operationId,
    );
    if (previous) {
      return {
        response: isRegistered(context.clientPublicKey)
          ? succeeded(previous)
          : failure("not_registered"),
      };
    }

    const mutation = transaction((): Mutation<ResultByMethod["pair"]> => {
      const concurrentPrevious = readOperation<ResultByMethod["pair"]>(
        context.clientPublicKey,
        context.operationId,
      );
      if (concurrentPrevious) {
        return {
          response: isRegistered(context.clientPublicKey)
            ? succeeded(concurrentPrevious)
            : failure("not_registered"),
        };
      }

      const invite = database
        .prepare(
          "SELECT secret, expires_at, issuer_operation_id FROM invite WHERE singleton = 1",
        )
        .get() as InviteRow | undefined;
      if (!invite || registeredAt >= invite.expires_at) {
        return { response: failure("invite_rejected") };
      }

      const actualSecret = Buffer.from(presentedSecret, "base64url");
      if (
        actualSecret.byteLength !== 32 ||
        !timingSafeEqual(
          createHash("sha256")
            .update(Buffer.from(invite.secret, "base64url"))
            .digest(),
          createHash("sha256").update(actualSecret).digest(),
        )
      ) {
        return { response: failure("invite_rejected") };
      }

      const device: Device = {
        publicKey: context.clientPublicKey,
        name: deviceName,
        registeredAt,
      };
      database
        .prepare(
          "INSERT INTO devices (public_key, name, registered_at) VALUES (?, ?, ?) ON CONFLICT(public_key) DO UPDATE SET name = excluded.name, registered_at = excluded.registered_at",
        )
        .run(device.publicKey, device.name, device.registeredAt);
      database.prepare("DELETE FROM invite WHERE singleton = 1").run();

      const result: ResultByMethod["pair"] = {
        device,
        host: hostInfo(identity, addresses),
      };
      const response = succeeded(result);
      saveOperation(context, response);
      return {
        response,
        event: {
          type: "device.registered",
          device,
          inviteOperationId: invite.issuer_operation_id,
        },
      };
    });
    return mutation;
  }

  function revoke(
    context: StoreContext,
    targetPublicKey: string,
  ): Mutation<ResultByMethod["devices.revoke"]> {
    return transaction((): Mutation<ResultByMethod["devices.revoke"]> => {
      if (!isRegistered(context.clientPublicKey)) {
        return { response: failure("not_registered") };
      }
      const cached = readOperation<ResultByMethod["devices.revoke"]>(
        context.clientPublicKey,
        context.operationId,
      );
      if (cached) return { response: succeeded(cached) };
      database
        .prepare("DELETE FROM operation_results WHERE client_public_key = ?")
        .run(targetPublicKey);
      if (!isRegistered(targetPublicKey)) {
        const response = succeeded({ publicKey: targetPublicKey });
        saveOperation(context, response);
        return { response };
      }

      database
        .prepare("DELETE FROM devices WHERE public_key = ?")
        .run(targetPublicKey);
      const response = succeeded({ publicKey: targetPublicKey });
      if (context.clientPublicKey !== targetPublicKey)
        saveOperation(context, response);
      return {
        response,
        event: { type: "device.revoked", publicKey: targetPublicKey },
        revokedPublicKey: targetPublicKey,
      };
    });
  }
  return {
    setPushNotificationSettings,
    pushSubscriptions,
    removePushSubscription,
    hostInfo,
    isRegistered,
    currentInvite,
    listDevices,
    snapshot,
    info,
    devices,
    createInvite,
    pair,
    revoke,
  };
}
