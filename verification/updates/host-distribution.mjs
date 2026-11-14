import { registerCleanup, registerVerificationDaemon } from "../lifecycle.mjs";
import { createServer } from "node:https";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { createHash, sign, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildHost } from "../../scripts/release/host.mjs";
import { prepareSigning } from "./keys.mjs";
import { prepareTls, endpoint, port } from "./distribution.mjs";
import { verificationHostEnvironment } from "../cli/environment.mjs";
import { claudeTokenName, claudeTokenPath } from "../cli/claude-token.mjs";
import {
  boundTerminalDaemon,
  stopTerminalDaemon,
} from "../terminal/daemon-process.mjs";
const run = promisify(execFile);

export async function prepareHostDistribution(
  root,
  { previousZip, targetZip, previousArchive, targetArchive } = {},
) {
  const updateRoot = join(root, "host-updates");
  const bundle = join(updateRoot, "bundle");
  await mkdir(updateRoot, { recursive: true });
  const publicKey = await prepareSigning(updateRoot, "Host");
  const windows = process.platform === "win32";
  // The Windows parent transfers this run's CA and server certificate before starting this runner.
  if (!windows) await prepareTls(updateRoot, "Windows");
  const location = endpoint(windows ? "Android" : "Windows");
  const distribution = process.env.IORI_WEB_HOST_DISTRIBUTION;
  async function extractZip(archive, destination) {
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
    await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(
        `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::ExtractToDirectory(${quote(archive)}, ${quote(destination)})`,
        "utf16le",
      ).toString("base64"),
    ]);
  }
  previousZip ??= previousArchive;
  targetZip ??= targetArchive;
  async function extract(archive, destination) {
    if (windows) return extractZip(archive, destination);
    await mkdir(destination, { recursive: true });
    await run("tar", ["-xzf", archive, "-C", destination]);
  }
  if (previousZip) await extract(previousZip, bundle);
  else if (distribution) await cp(distribution, bundle, { recursive: true });
  else await buildHost(bundle);
  const good = join(updateRoot, "good"),
    bad = join(updateRoot, "bad");
  if (targetZip) await extract(targetZip, good);
  const { DAEMON_PROTOCOL } = await import(
    pathToFileURL(
      join(targetZip ? good : bundle, "src/terminal/daemon/protocol.js"),
    ).href
  );
  if (windows && !distribution && !previousZip)
    await run(
      join(process.env.WINDIR, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"),
      [
        "/nologo",
        "/target:winexe",
        "/out:" + join(bundle, "iori-host-background.exe"),
        resolve("scripts", "release", "launcher.cs"),
      ],
    ).catch((error) => {
      throw new Error(
        `${error.message}\n${error.stdout ?? ""}\n${error.stderr ?? ""}`,
      );
    });
  const { version } = JSON.parse(
    await readFile(
      join(targetZip ? good : bundle, "release-version.json"),
      "utf8",
    ),
  );
  const asset =
    process.platform === "win32"
      ? "iori-host-windows-x64.zip"
      : "iori-host-linux-x64.tar.gz";
  const extension = windows ? ".zip" : ".tar.gz";
  let active = previousZip ? "good" : "bad";
  const requests = [];
  const manifests = {};
  const server = createServer(
    {
      key: await readFile(join(updateRoot, "tls/key.pem")),
      cert: await readFile(join(updateRoot, "tls/cert.pem")),
    },
    async (request, response) => {
      requests.push({ path: request.url, version: active });
      const name = request.url?.split("/").at(-1);
      if (!request.url?.startsWith(`/releases/download/v${version}/`)) {
        response.writeHead(404);
        response.end();
        return;
      }
      if (name === "release.json" || name === "release.json.sig") {
        response.end(
          manifests[active][name === "release.json" ? "manifest" : "signature"],
        );
        return;
      }
      if (name !== asset) {
        response.writeHead(404);
        response.end();
        return;
      }
      const file = join(updateRoot, active + extension);
      response.writeHead(200, { "Content-Length": (await stat(file)).size });
      createReadStream(file).pipe(response);
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    // Windows forwards the fixed port; web runners each reserve their own.
    server.listen(windows ? port : 0, location.address, resolve);
  });
  try {
    const source = new URL(location.source);
    source.port = String(server.address().port);
    const previous = previousZip
      ? JSON.parse(await readFile(join(bundle, "release-version.json"), "utf8"))
          .version
      : "0.0.0";
    await writeFile(join(bundle, "release-public-key.txt"), publicKey + "\n");
    await writeFile(
      join(bundle, "release-source.txt"),
      source.origin + "/releases\n",
    );
    if (!targetZip) await cp(bundle, good, { recursive: true });
    if (!previousZip) await cp(bundle, bad, { recursive: true });
    if (!previousZip)
      await writeFile(
        join(bundle, "release-version.json"),
        JSON.stringify({ version: previous }),
      );
    if (!previousZip)
      await writeFile(
        join(bad, "service.mjs"),
        `import {DatabaseSync} from 'node:sqlite';import {writeFileSync} from 'node:fs';import {join} from 'node:path';const root=join(process.platform==='win32'?process.env.LOCALAPPDATA:process.env.XDG_DATA_HOME,'iori-host');const db=new DatabaseSync(join(root,'host.sqlite'));db.exec("CREATE TABLE IF NOT EXISTS update_probe(value TEXT);DELETE FROM update_probe;INSERT INTO update_probe VALUES('failed-new-version')");db.close();writeFileSync(join(root,'failed-version-ran'),'yes');process.exit(42);\n`,
      );
    const versions = previousZip
      ? [["good", good]]
      : [
          ["good", good],
          ["bad", bad],
        ];
    for (const [name, directory] of versions) {
      if (windows) {
        const ps = (value) => "'" + value.replaceAll("'", "''") + "'";
        const script = `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::CreateFromDirectory(${ps(directory)}, ${ps(join(updateRoot, name + extension))})`;
        await run("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ]);
      } else
        await run("tar", [
          "-czf",
          join(updateRoot, name + extension),
          "-C",
          directory,
          ".",
        ]);
    }
    for (const [name] of versions) {
      const bytes = await readFile(join(updateRoot, name + extension));
      const manifest = Buffer.from(
        JSON.stringify({
          version,
          terminalDaemonProtocol: DAEMON_PROTOCOL,
          assets: [
            {
              name: asset,
              size: bytes.length,
              sha256: createHash("sha256").update(bytes).digest("hex"),
            },
          ],
        }),
      );
      manifests[name] = {
        manifest,
        signature: sign(
          null,
          manifest,
          await readFile(join(updateRoot, "signing/release.pem")),
        ),
      };
    }
    return {
      bundle,
      version,
      previous,
      requests,
      ca: join(updateRoot, "tls/ca.pem"),
      publishGood() {
        active = "good";
      },
      async close() {
        await new Promise((resolve) => server.close(resolve));
        await rm(join(updateRoot, "signing"), { recursive: true, force: true });
        await rm(join(updateRoot, "tls"), { recursive: true, force: true });
      },
    };
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }
}

export async function startUpdateHost(
  distribution,
  dataRoot,
  { port = process.env.IORI_HOST_PORT, cliEnvironment = {} } = {},
) {
  const unit = `iori-host-update-verification-${randomUUID()}.service`;
  const unitDirectory = join(process.env.XDG_RUNTIME_DIR, "systemd/user");
  const unitFile = join(unitDirectory, unit);
  const env = {
    ...verificationHostEnvironment(),
    ...cliEnvironment,
    NODE_EXTRA_CA_CERTS: distribution.ca,
    XDG_DATA_HOME: dataRoot,
    IORI_HOST_PORT: String(port),
  };
  // A unit file keeps its values after a run is killed, so a secret value is
  // never written into it: systemd reads the verification token from the file
  // that already holds it, and only the path goes into the unit.
  const tokenFile =
    env[claudeTokenName] === undefined ? undefined : claudeTokenPath;
  delete env[claudeTokenName];
  const hostRoot = join(dataRoot, "iori-host");
  await registerVerificationDaemon(hostRoot);
  const quote = (value) =>
    '"' +
    value
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("%", "%%")
      .replaceAll("\n", "\\n") +
    '"';
  await mkdir(unitDirectory, { recursive: true });
  // The unit starts in the data root, which the Host has not created yet on a
  // first start; systemd fails at CHDIR when it is missing.
  await mkdir(dataRoot, { recursive: true });
  await writeFile(
    unitFile,
    [
      "[Service]",
      "Type=notify",
      "WorkingDirectory=" + dataRoot,
      "NotifyAccess=all",
      "Restart=on-failure",
      "TimeoutStartSec=infinity",
      "MemoryMax=4G",
      "MemorySwapMax=0",
      // systemd keeps a quoted path as written and then rejects it as not
      // absolute, so this line stays unquoted (the path has no spaces).
      ...(tokenFile ? ["EnvironmentFile=" + tokenFile] : []),
      ...Object.entries(env).map(
        ([key, value]) => "Environment=" + quote(key + "=" + value),
      ),
      "ExecStart=" +
        quote(join(distribution.bundle, "runtime/node")) +
        " " +
        quote(join(distribution.bundle, "service.mjs")),
      "",
    ].join("\n"),
  );
  const close = registerCleanup(async () => {
    try {
      await run("systemctl", ["--user", "stop", unit]).catch((error) => {
        if (error.code !== 5) throw error;
      });
    } finally {
      await stopTerminalDaemon(hostRoot);
    }
    await rm(unitFile, { force: true });
    await run("systemctl", ["--user", "daemon-reload"]);
    await run("systemctl", ["--user", "reset-failed", unit]).catch(() => {});
  });
  try {
    await run("systemctl", ["--user", "daemon-reload"]);
    await run("systemctl", ["--user", "start", unit]);
    await boundTerminalDaemon(hostRoot);
  } catch (error) {
    await close();
    throw error;
  }
  return { unit, unitFile, close };
}
