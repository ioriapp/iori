import * as v from "valibot";
import {
  integer,
  string,
  fail,
  nonEmptyString,
  decoded,
  schema,
} from "./primitives.ts";
const MAX_DISPLAY_NAME_CODE_POINTS = 63;
const encoder = new TextEncoder();
export function displayName(value: unknown, field: string): string {
  const parsed = string(value, field).trim();
  if (parsed.length === 0) return fail(`${field} must not be empty`);
  if ([...parsed].length > MAX_DISPLAY_NAME_CODE_POINTS) {
    return fail(
      `${field} must be at most ${MAX_DISPLAY_NAME_CODE_POINTS} characters`,
    );
  }
  if (/[\p{Cc}\p{Bidi_Control}]/u.test(parsed)) {
    return fail(`${field} must not contain control characters`);
  }
  return parsed;
}

function socketAddress(value: unknown, field: string): string {
  const parsed = nonEmptyString(value, field);
  const ipv4 = /^((?:\d{1,3}\.){3}\d{1,3}):(\d+)$/u.exec(parsed);
  if (ipv4) {
    const octets = ipv4[1]!.split(".").map(Number);
    const port = Number(ipv4[2]);
    if (octets.every((octet) => octet <= 255) && port >= 1 && port <= 65_535) {
      return parsed;
    }
    return fail(`${field} must be an IP address and port`);
  }
  const ipv6 = /^\[([0-9a-fA-F:.]+)\]:(\d+)$/u.exec(parsed);
  if (ipv6) {
    const port = Number(ipv6[2]);
    try {
      const url = new URL(`http://[${ipv6[1]}]/`);
      if (url.hostname && port >= 1 && port <= 65_535) return parsed;
    } catch {
      return fail(`${field} must be an IP address and port`);
    }
  }
  return fail(`${field} must be an IP address and port`);
}

export function socketAddressArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return fail(`${field} must be an array`);
  return value.map((item, index) => socketAddress(item, `${field}[${index}]`));
}

export function publicKey(value: unknown, field: string): string {
  const parsed = string(value, field);
  if (!/^[0-9a-fA-F]{64}$/.test(parsed)) {
    return fail(`${field} must be a 32-byte hex key`);
  }
  return parsed.toLowerCase();
}

export function secret(value: unknown): string {
  const parsed = string(value, "secret");
  if (!/^[A-Za-z0-9_-]{43}$/.test(parsed)) {
    return fail("secret must be a 32-byte base64url value");
  }
  const decoded = base64UrlDecode(parsed);
  if (decoded.length !== 32 || base64UrlEncode(decoded) !== parsed) {
    return fail("secret must be a canonical 32-byte base64url value");
  }
  return parsed;
}

export function relayUrl(value: unknown): string {
  const text = string(value, "Relay URL");
  try {
    const url = new URL(text);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return fail("Invalid Relay URL");
    return url.href;
  } catch {
    return fail("Invalid Relay URL");
  }
}

const invite = v.object({
  version: v.literal(1),
  hostKey: decoded((value) => publicKey(value, "hostKey")),
  relayUrl: v.optional(decoded(relayUrl)),
  addresses: v.array(decoded((value) => socketAddress(value, "address"))),
  secret: decoded(secret),
  expiresAt: integer(0),
  hostName: decoded((value) => displayName(value, "hostName")),
});
export type Invite = v.InferOutput<typeof invite>;
export const inviteSchema = schema(invite);
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const INVITE_PREFIX = "iori://pair/";

export function inviteToCode(invite: Invite): string {
  const value = inviteSchema.parse(invite);
  const bytes: number[] = [1];
  const append = (data: Uint8Array) => {
    for (const byte of data) bytes.push(byte);
  };
  const integer = (n: number, size: number) => {
    let remaining = BigInt(n);
    const result = new Uint8Array(size);
    for (let i = size - 1; i >= 0; i--) {
      result[i] = Number(remaining & 255n);
      remaining >>= 8n;
    }
    append(result);
  };
  const text = (str: string) => {
    const encoded = encoder.encode(str);
    integer(encoded.length, 4);
    append(encoded);
  };
  append(
    Uint8Array.from(value.hostKey.match(/../gu)!, (part) => parseInt(part, 16)),
  );
  append(
    Uint8Array.from(base64UrlDecode(value.secret), (c) => c.charCodeAt(0)),
  );
  integer(value.expiresAt, 8);
  text(value.relayUrl ?? "");
  text(value.hostName);
  integer(value.addresses.length, 4);
  for (const address of value.addresses) {
    const ipv6 = address.startsWith("[");
    const split = address.lastIndexOf(":");
    const host = address.slice(0, split);
    integer(ipv6 ? 6 : 4, 1);
    if (ipv6) {
      const canonical = new URL(`http://${host}/`).hostname.slice(1, -1);
      const [left, right = ""] = canonical.split("::");
      const before = left ? left.split(":") : [];
      const after = right ? right.split(":") : [];
      const groups = [
        ...before,
        ...Array<string>(8 - before.length - after.length).fill("0"),
        ...after,
      ];
      for (const group of groups) integer(parseInt(group, 16), 2);
    } else {
      for (const octet of host.split(".")) integer(Number(octet), 1);
    }
    integer(Number(address.slice(split + 1)), 2);
  }
  let result = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32[(buffer >>> bits) & 31];
    }
  }
  if (bits) result += BASE32[(buffer << (5 - bits)) & 31];
  return result;
}

export function inviteToText(invite: Invite): string {
  return INVITE_PREFIX + inviteToCode(invite);
}

export function inviteQrSegments(
  invite: Invite,
): (
  { data: Uint8Array; mode: "byte" } | { data: string; mode: "alphanumeric" }
)[] {
  return [
    { data: encoder.encode(INVITE_PREFIX), mode: "byte" },
    { data: inviteToCode(invite), mode: "alphanumeric" },
  ];
}

export function inviteFromText(text: string): Invite {
  let code = text.trim();
  if (code.includes("://")) {
    if (!code.toLowerCase().startsWith(INVITE_PREFIX))
      return fail("unsupported invite URL");
    code = code.slice(INVITE_PREFIX.length);
  }
  code = code.toUpperCase();
  if (!/^[A-Z2-7]+$/u.test(code)) return fail("invalid invite code");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of code) {
    buffer = (buffer << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
    }
  }
  if (bits >= 5 || (buffer & ((1 << bits) - 1)) !== 0)
    return fail("invalid invite code");
  let offset = 0;
  const take = (size: number): Uint8Array => {
    if (size > bytes.length - offset) return fail("invalid invite content");
    const result = Uint8Array.from(bytes.slice(offset, offset + size));
    offset += size;
    return result;
  };
  const integer = (size: number): number => {
    let result = 0n;
    for (const byte of take(size)) result = (result << 8n) | BigInt(byte);
    if (result > BigInt(Number.MAX_SAFE_INTEGER))
      return fail("invalid invite content");
    return Number(result);
  };
  const readText = (): string => {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(take(integer(4)));
    } catch {
      return fail("invalid invite content");
    }
  };
  if (integer(1) !== 1) return fail("unsupported invite version");
  const hostKey = Array.from(take(32), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const secret = base64UrlEncode(
    Array.from(take(32), (byte) => String.fromCharCode(byte)).join(""),
  );
  const expiresAt = integer(8);
  const relay = readText();
  const hostName = readText();
  const count = integer(4);
  const addresses: string[] = [];
  for (let i = 0; i < count; i++) {
    const family = integer(1);
    if (family !== 4 && family !== 6) return fail("invalid invite content");
    const address = take(family === 4 ? 4 : 16);
    const host =
      family === 4
        ? Array.from(address).join(".")
        : new URL(
            `http://[${Array.from({ length: 8 }, (_, j) => ((address[j * 2]! << 8) | address[j * 2 + 1]!).toString(16)).join(":")}]/`,
          ).hostname;
    addresses.push(`${host}:${integer(2)}`);
  }
  if (offset !== bytes.length) return fail("invalid invite content");
  return inviteSchema.parse({
    version: 1,
    hostKey,
    secret,
    expiresAt,
    ...(relay ? { relayUrl: relay } : {}),
    hostName,
    addresses,
  });
}

function base64UrlEncode(binary: string): string {
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(code: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return fail("invalid invite code");
  const base64 = code.replaceAll("-", "+").replaceAll("_", "/");
  try {
    return atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  } catch {
    return fail("invalid invite code");
  }
}
