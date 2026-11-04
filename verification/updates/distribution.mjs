import { local as verificationLocal } from "../native/local.mjs";
import { createServer } from "node:https";
import { execFileSync } from "node:child_process";
import { sign } from "node:crypto";
import semver from "semver";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

export const port = 14447;
export function endpoint(platform) {
  const address =
    platform === "Android"
      ? "127.0.0.1"
      : verificationLocal.network.hostAddress;
  const hostname = platform === "Android" ? "localhost" : address;
  return {
    address,
    source: `https://${hostname}:${port}`,
    san: platform === "Android" ? "DNS:localhost" : `IP:${address}`,
  };
}
export async function prepareTls(root, platform) {
  const location = endpoint(platform);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "endpoint.json"), JSON.stringify(location));
  const directory = path.join(root, "tls");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const openssl = (args) => execFileSync("openssl", args, { stdio: "ignore" });
  const host = new URL(location.source).hostname;
  openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    path.join(directory, "ca-key.pem"),
    "-out",
    path.join(directory, "ca.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=iori verification CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  openssl([
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    path.join(directory, "key.pem"),
    "-out",
    path.join(directory, "server.csr"),
    "-subj",
    `/CN=${host}`,
  ]);
  await writeFile(
    path.join(directory, "server.ext"),
    [
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      `subjectAltName=${location.san}`,
      "",
    ].join("\n"),
  );
  openssl([
    "x509",
    "-req",
    "-in",
    path.join(directory, "server.csr"),
    "-CA",
    path.join(directory, "ca.pem"),
    "-CAkey",
    path.join(directory, "ca-key.pem"),
    "-CAcreateserial",
    "-out",
    path.join(directory, "cert.pem"),
    "-days",
    "1",
    "-extfile",
    path.join(directory, "server.ext"),
  ]);
  // Verify the chain, TLS server purpose and exact endpoint name before any
  // device run. A CA certificate must never double as the server certificate.
  openssl([
    "verify",
    "-CAfile",
    path.join(directory, "ca.pem"),
    "-purpose",
    "sslserver",
    platform === "Android" ? "-verify_hostname" : "-verify_ip",
    host,
    path.join(directory, "cert.pem"),
  ]);
  for (const file of ["ca-key.pem", "ca.srl", "server.csr", "server.ext"])
    await rm(path.join(directory, file));
  console.log(
    JSON.stringify({
      verificationTls: { host, chain: true, purpose: "sslserver", name: true },
    }),
  );
  return directory;
}
export async function verificationSource(root, certificate) {
  const file = path.join(root, "apps/client/src-tauri/src/updates/mod.rs");
  const code = await readFile(file, "utf8");
  // Only the dedicated verification source copy trusts this run's certificate.
  // The committed product has no test mode and keeps its fixed HTTPS source.
  const marker = "builder.redirect(";
  if (code.split(marker).length !== 2)
    throw new Error("Expected one HTTP builder to inject the verification CA");
  return code.replace(
    marker,
    `builder.add_root_certificate(reqwest::Certificate::from_pem(${JSON.stringify(certificate)}.as_bytes()).expect("verification certificate")).redirect(`,
  );
}
export async function verificationReleaseSource(root) {
  const file = path.join(root, "apps/client/src-tauri/src/updates/release.rs");
  const code = await readFile(file, "utf8");
  const start = code.indexOf("fn api(source: &str)");
  const end = code.indexOf("\npub(crate) fn client()", start);
  if (start < 0 || end < 0) throw new Error("Release source marker not found");
  return (
    code.slice(0, start) +
    `fn api(source: &str) -> Result<reqwest::Url, String> {
    reqwest::Url::parse(&format!("{source}/api/releases")).map_err(|e| e.to_string())
}
` +
    code.slice(end)
  );
}
export async function startDistribution(
  root,
  { keepCredentials = false } = {},
) {
  const { address } = JSON.parse(
    await readFile(path.join(root, "endpoint.json"), "utf8"),
  );
  let published = false;
  const requests = [];
  const server = createServer(
    {
      key: await readFile(path.join(root, "tls/key.pem")),
      cert: await readFile(path.join(root, "tls/cert.pem")),
    },
    async (request, response) => {
      const name = request.url?.split("/").at(-1);
      const files = [
        "updater.json",
        "iori-setup-windows-x64.exe",
        "iori-linux-x64.deb",
        "iori-linux-x64.AppImage",
        "release.json",
        "release.json.sig",
        "iori-android-arm64.apk",
        "iori-host-windows-x64.zip",
        "iori-host-linux-x64.tar.gz",
      ];
      requests.push({ path: request.url, published });
      if (!published) {
        response.writeHead(503);
        response.end();
        return;
      }
      if (request.url === "/api/releases") {
        try {
          const manifest = JSON.parse(
            await readFile(
              path.join(root, "assets/updater.json"),
              "utf8",
            ).catch(() =>
              readFile(path.join(root, "assets/release.json"), "utf8"),
            ),
          );
          const stable = manifest.version;
          const development = `${semver.inc(stable, "patch")}-beta.1`;
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify([
              { tag_name: `v${stable}`, draft: false, prerelease: false },
              { tag_name: `v${development}`, draft: false, prerelease: true },
            ]),
          );
        } catch {
          response.writeHead(404);
          response.end();
        }
        return;
      }
      if (!files.includes(name)) {
        response.writeHead(503);
        response.end();
        return;
      }
      try {
        let bytes = await readFile(path.join(root, "assets", name));
        const tag = request.url?.match(/\/download\/v([^/]+)\//u)?.[1];
        if (
          tag &&
          semver.prerelease(tag) &&
          ["updater.json", "release.json", "release.json.sig"].includes(name)
        ) {
          const manifestName =
            name === "updater.json" ? "updater.json" : "release.json";
          const manifest = JSON.parse(
            await readFile(path.join(root, "assets", manifestName), "utf8"),
          );
          manifest.version = tag;
          bytes = Buffer.from(JSON.stringify(manifest));
          if (name === "release.json.sig")
            bytes = sign(
              null,
              bytes,
              await readFile(path.join(root, "signing/release.pem")),
            );
        }
        response.writeHead(200, {
          "Content-Length": bytes.length,
          "Content-Type": name.endsWith("json")
            ? "application/json"
            : "application/octet-stream",
        });
        response.end(bytes);
      } catch {
        response.writeHead(404);
        response.end();
      }
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, address, resolve);
  });
  return {
    publish() {
      published = true;
    },
    requests,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await writeFile(
        path.join(root, "requests.json"),
        JSON.stringify(requests, null, 2),
      );
      if (keepCredentials) return;
      await rm(path.join(root, "tls"), { recursive: true, force: true });
      await rm(path.join(root, "signing"), { recursive: true, force: true });
    },
  };
}
