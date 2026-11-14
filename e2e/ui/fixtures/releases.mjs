import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DAEMON_PROTOCOL } from "../../../apps/host/src/terminal/daemon/protocol.ts";

const version = JSON.parse(
  await readFile(
    new URL("../../../release-version.json", import.meta.url),
    "utf8",
  ),
).version;

export async function clientRelease() {
  let available = false;
  let failed = false;
  const waiting = new Set();
  const nextVersion = version.split(".").map(Number);
  nextVersion[2]++;
  const next = nextVersion.join(".");
  const server = httpServer((request, response) => {
    if (request.url === "/asset") {
      response.writeHead(200);
      response.write("download started");
      if (failed) {
        response.destroy();
        return;
      }
      waiting.add(response);
      response.once("close", () => waiting.delete(response));
    } else {
      response.writeHead(available ? 200 : 503, {
        "Content-Type": "application/json",
      });
      response.end(
        JSON.stringify(
          request.url?.includes("api/releases")
            ? [{ tag_name: `v${next}`, draft: false }]
            : { version: next },
        ),
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    source: `http://127.0.0.1:${server.address().port}`,
    version: next,
    publish() {
      available = true;
    },
    failDownload() {
      failed = true;
      for (const response of waiting) response.destroy();
      waiting.clear();
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export async function hostRelease(root) {
  await mkdir(root, { recursive: true });
  const key = join(root, "tls-key.pem"),
    cert = join(root, "tls-cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const bytes = Buffer.alloc(64, 1);
  const manifest = Buffer.from(
    JSON.stringify({
      version,
      terminalDaemonProtocol: DAEMON_PROTOCOL + 1,
      assets: [
        {
          name: "iori-host-linux-x64.tar.gz",
          size: bytes.length,
          sha256: createHash("sha256")
            .update(Buffer.alloc(64, 2))
            .digest("hex"),
        },
      ],
    }),
  );
  const signature = sign(null, manifest, privateKey);
  const waiting = new Set();
  let released = false;
  const server = httpsServer(
    { key: await readFile(key), cert: await readFile(cert) },
    (request, response) => {
      if (request.url.endsWith("release.json.sig")) response.end(signature);
      else if (request.url.endsWith("release.json")) response.end(manifest);
      else {
        response.writeHead(200);
        if (released) {
          response.end(bytes);
          return;
        }
        response.write(bytes.subarray(0, 32));
        waiting.add(response);
        response.once("close", () => waiting.delete(response));
      }
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const source = `https://127.0.0.1:${server.address().port}`;
  await Promise.all([
    writeFile(join(root, "release-source.txt"), source),
    writeFile(
      join(root, "release-public-key.txt"),
      publicKey
        .export({ format: "der", type: "spki" })
        .subarray(-32)
        .toString("base64"),
    ),
    writeFile(join(root, "release-redirect-hosts.json"), "[]"),
    writeFile(
      join(root, "release-version.json"),
      JSON.stringify({ version: "0.0.1" }),
    ),
  ]);
  return {
    bundle: root,
    ca: cert,
    version,
    releaseAsset() {
      released = true;
      for (const response of waiting) response.end(bytes.subarray(32));
      waiting.clear();
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
