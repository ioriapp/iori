import { useEffect, useState, useSyncExternalStore } from "react";
import type { CliSummary } from "@iori/protocol";
import { connection } from "./connection.ts";
import { decodeBytes } from "./reading/transport.ts";

const definitions = new Map<string, Map<string, CliSummary>>();
const listeners = new Set<() => void>();
export function updateCliIconDefinitions(host: string, clis: CliSummary[]) {
  definitions.set(host, new Map(clis.map((cli) => [cli.id, cli])));
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useCurrentIconDefinition(host: string, cli: CliSummary) {
  const current = useSyncExternalStore(subscribe, () => definitions.get(host));
  // Retained tabs and children keep their CLI's name after deletion, but its
  // removed attachments must not be restored from the old session summary.
  return current ? (current.get(cli.id) ?? { ...cli, icon: undefined }) : cli;
}
/** A mounted image owns one reference. The same bytes are transferred once
 * for all the places that display them, then released with the last image. */
const images = new Map<
  string,
  { references: number; promise: Promise<string>; url?: string }
>();
export function useHostIcon(host: string, hash?: string) {
  const [image, setImage] = useState<{ key: string; url: string | null }>();
  const connected = useSyncExternalStore(connection.subscribe, () =>
    connection.getSnapshot().connectedHosts.includes(host),
  );
  const key = `${host}:${hash}`;
  useEffect(() => {
    if (!host || !hash || !connected) return;
    let active = true;
    let entry = images.get(key);
    if (!entry) {
      const created = {
        references: 0,
        promise: Promise.resolve(""),
        url: undefined as string | undefined,
      };
      created.promise = (async () => {
        const parts: Uint8Array<ArrayBuffer>[] = [];
        let offset = 0;
        let mimeType = "";
        for (;;) {
          const result = await connection.requestHost(host, "cli.icon.read", {
            hash,
            offset,
          });
          if (!result?.ok) throw new Error("Image unavailable");
          parts.push(decodeBytes(result.result.bytesBase64));
          mimeType = result.result.mimeType;
          offset = result.result.nextOffset;
          if (result.result.eof) break;
        }
        if (!created.references) return "";
        created.url = URL.createObjectURL(new Blob(parts, { type: mimeType }));
        return created.url;
      })();
      images.set(key, created);
      entry = created;
    }
    entry.references++;
    void entry.promise
      .then((url) => {
        if (active && url) setImage({ key, url });
      })
      .catch(() => {
        if (active) setImage({ key, url: null });
      });
    return () => {
      active = false;
      if (--entry.references === 0) {
        if (entry.url) URL.revokeObjectURL(entry.url);
        images.delete(key);
      }
    };
  }, [host, hash, key, connected]);
  return image?.key === key ? image.url : undefined;
}
