import { isIP } from "node:net";
import type { AutomationWebhook } from "@iori/protocol";

export function webhookAddressPriority(address: string): number {
  if (isIP(address) === 4) {
    const first = Number(address.split(".")[0]);
    if (first === 192) return 0;
    if (first === 10) return 1;
    if (first === 172) return 2;
    if (first === 100) return 3;
    if (first === 169) return 4;
  }
  const first = parseInt(address.split(":")[0]!, 16);
  if ((first & 0xfe00) === 0xfc00) return 5;
  if ((first & 0xffc0) === 0xfe80) return 6;
  return 7;
}

/** Apply the scope to socket addresses, including IPv4 mapped into IPv6. */
export function webhookAddressAllowed(
  address: string,
  scope: AutomationWebhook["scope"],
): boolean {
  const host = address.split("%")[0]!;
  const family = isIP(host);
  let ipv4: number[] | undefined;
  if (family === 4) ipv4 = host.split(".").map(Number);
  else if (family === 6) {
    const expanded = host.replace(/(\d+\.\d+\.\d+\.\d+)$/u, (tail) => {
      const bytes = tail.split(".").map(Number);
      return `${((bytes[0]! << 8) | bytes[1]!).toString(16)}:${((bytes[2]! << 8) | bytes[3]!).toString(16)}`;
    });
    const [left, right] = expanded.split("::");
    const before = left ? left.split(":") : [];
    const after = right ? right.split(":") : [];
    const groups = expanded.includes("::")
      ? [
          ...before,
          ...Array<string>(8 - before.length - after.length).fill("0"),
          ...after,
        ]
      : before;
    const value = groups.reduce(
      (n, group) => (n << 16n) | BigInt(`0x${group}`),
      0n,
    );
    if (value >> 32n === 0xffffn) {
      ipv4 = [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 255n));
    } else {
      if (value === 1n) return true;
      return (
        scope === "lan" && (value >> 121n === 0x7en || value >> 118n === 0x3fan)
      );
    }
  }
  if (!ipv4) return false;
  const [a, b] = ipv4;
  if (a === 127) return true;
  return (
    scope === "lan" &&
    (a === 10 ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b! >= 64 && b! <= 127))
  );
}
