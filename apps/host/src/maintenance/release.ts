import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile, open, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface HostRelease {
  version: string;
  terminalDaemonProtocol: number;
  asset: { name: string; size: number; sha256: string };
}
export class ReleaseFailure extends Error {
  readonly reason: "source" | "verification" | "download";
  constructor(reason: "source" | "verification" | "download") {
    super(reason);
    this.reason = reason;
  }
}
export class ReleaseSource {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }
  async get(version: string, name: string): Promise<Response> {
    const source = (
      await readFile(join(this.root, "release-source.txt"), "utf8")
    ).trim();
    const base = new URL(source + "/");
    let url = new URL(`download/v${encodeURIComponent(version)}/${name}`, base);
    const visited = new Set<string>();
    try {
      const redirectHosts: string[] = JSON.parse(
        await readFile(join(this.root, "release-redirect-hosts.json"), "utf8"),
      );
      for (;;) {
        if (
          !allowedReleaseUrl(url, base, redirectHosts) ||
          visited.has(url.href)
        )
          throw new ReleaseFailure("source");
        visited.add(url.href);
        const response = await fetch(url, { redirect: "manual" });
        if (
          response.status >= 300 &&
          response.status < 400 &&
          response.headers.has("location")
        ) {
          await response.body?.cancel();
          url = new URL(response.headers.get("location")!, url);
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new ReleaseFailure("source");
        }
        return response;
      }
    } catch {
      throw new ReleaseFailure("source");
    }
  }
  async manifest(version: string): Promise<HostRelease> {
    const [response, signatureResponse] = await Promise.all([
      this.get(version, "release.json"),
      this.get(version, "release.json.sig"),
    ]);
    const [bytes, signature] = await Promise.all([
      response.arrayBuffer(),
      signatureResponse.arrayBuffer(),
    ]);
    try {
      const key = Buffer.from(
        (
          await readFile(join(this.root, "release-public-key.txt"), "utf8")
        ).trim(),
        "base64",
      );
      const publicKey = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          key,
        ]),
        format: "der",
        type: "spki",
      });
      if (!verify(null, Buffer.from(bytes), publicKey, Buffer.from(signature)))
        throw new Error("signature");
      const manifest = JSON.parse(Buffer.from(bytes).toString("utf8"));
      const name =
        process.platform === "win32"
          ? "iori-host-windows-x64.zip"
          : "iori-host-linux-x64.tar.gz";
      const asset = manifest.assets.find(
        (item: { name: string }) => item.name === name,
      );
      if (
        // The release server is an external trust boundary: a different signed tag must not install a different version.
        // eslint-disable-next-line iori/no-stored-value-rejection -- External release metadata, not an iori storage record.
        manifest.version !== version ||
        !Number.isSafeInteger(manifest.terminalDaemonProtocol) ||
        !asset ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0 ||
        !/^[a-f0-9]{64}$/.test(asset.sha256)
      )
        throw new Error("manifest");
      return {
        version,
        terminalDaemonProtocol: manifest.terminalDaemonProtocol,
        asset,
      };
    } catch {
      throw new ReleaseFailure("verification");
    }
  }
  async download(
    release: HostRelease,
    directory: string,
    progress: (received: number, total: number) => void,
  ) {
    const response = await this.get(release.version, release.asset.name);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = join(directory, release.asset.name);
    const file = await open(destination, "w", 0o600);
    let received = 0;
    const hash = createHash("sha256");
    try {
      if (!response.body) throw new ReleaseFailure("download");
      for await (const chunk of response.body) {
        received += chunk.length;
        if (received > release.asset.size)
          throw new ReleaseFailure("verification");
        hash.update(chunk);
        await file.writeFile(chunk);
        progress(received, release.asset.size);
      }
      if (
        received !== release.asset.size ||
        hash.digest("hex") !== release.asset.sha256
      )
        throw new ReleaseFailure("verification");
      return destination;
    } catch (error) {
      if (error instanceof ReleaseFailure) throw error;
      throw new ReleaseFailure("download");
    } finally {
      await file.close();
    }
  }
}

export function allowedReleaseUrl(
  url: URL,
  source: URL,
  redirectHosts: readonly string[],
): boolean {
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (url.origin === source.origin ||
      (!url.port && redirectHosts.includes(url.hostname)))
  );
}
