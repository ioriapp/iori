import { createSocket } from "node:dgram";
import { createServer } from "node:net";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { cliDefinitions } from "../../apps/host/src/cli/definitions.ts";
import { connectClient } from "../../verification/host/client.mjs";
import { verificationHostEnvironment } from "../../verification/cli/environment.mjs";
import { startWebHost } from "../../verification/web/host.mjs";

async function availablePort() {
  for (;;) {
    const socket = createSocket("udp4");
    const server = createServer();
    try {
      await new Promise((resolve, reject) => {
        socket.once("error", reject);
        socket.bind(0, "127.0.0.1", resolve);
      });
      const { port } = socket.address();
      const free = await new Promise((resolve) => {
        server.once("error", () => resolve(false));
        server.listen(port, () => resolve(true));
      });
      if (free) return port;
    } finally {
      await new Promise((resolve) => socket.close(resolve));
      if (server.listening)
        await new Promise((resolve) => server.close(resolve));
    }
  }
}

export async function checkModelCatalogs(
  distribution,
  evidence,
  env = process.env,
) {
  const dataRoot = await mkdtemp(path.join(tmpdir(), "iori-release-models-"));
  const results = [];
  let host;
  let client;
  try {
    const cliEnvironment = verificationHostEnvironment(env);
    // Host data is isolated, while the CLI's normal HOME and configuration
    // remain visible. XDG_DATA_HOME is also the Host's data root, so link the
    // user's other data folders into it: a CLI such as Muse Code lists models
    // only from the catalog it keeps there. The cleanup's rm removes the links
    // without following them.
    const userData = env.XDG_DATA_HOME || path.join(homedir(), ".local/share");
    for (const entry of await readdir(userData).catch(() => []))
      if (entry !== "iori-host")
        await symlink(path.join(userData, entry), path.join(dataRoot, entry));
    host = await startWebHost(distribution, {
      dataRoot,
      port: await availablePort(),
      cliEnvironment,
    });
    client = await connectClient(dataRoot);
    const { clis } = await client.request("cli.list");
    const installed = new Set(clis.map((cli) => cli.id));
    for (const definition of cliDefinitions) {
      const file = JSON.parse(
        await readFile(
          new URL(
            `../../apps/host/src/cli/${definition.id}/definition.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      if (file.models?.unavailable === true) {
        results.push({
          cli: definition.id,
          status: "skipped",
          reason: "unavailable",
        });
      } else if (!installed.has(definition.id)) {
        results.push({
          cli: definition.id,
          status: "skipped",
          reason: "not installed",
        });
      } else {
        try {
          const response = await client.request("cli.models", {
            cliId: definition.id,
          });
          if (response.error || !response.models.length)
            results.push({
              cli: definition.id,
              status: "failed",
              reason: response.error ?? "empty model list",
              ...(response.errorDetail ? { detail: response.errorDetail } : {}),
            });
          else
            results.push({
              cli: definition.id,
              status: "passed",
              count: response.models.length,
            });
        } catch (error) {
          results.push({
            cli: definition.id,
            status: "failed",
            reason: error.message,
          });
        }
      }
    }
  } catch (error) {
    results.push({ status: "failed", reason: error.message });
    throw error;
  } finally {
    try {
      await client?.close();
    } finally {
      try {
        await host?.close({ stopTerminals: true });
      } finally {
        await rm(dataRoot, { recursive: true, force: true });
        await writeFile(evidence, JSON.stringify(results, null, 2) + "\n");
      }
    }
  }
  for (const result of results)
    console.log(
      `[release] models ${result.cli}: ${result.status}${result.reason ? ` (${result.reason}${result.detail ? `: ${result.detail}` : ""})` : ` (${result.count})`}`,
    );
  const failed = results.filter((result) => result.status === "failed");
  if (failed.length)
    throw new Error(
      `モデル一覧の取得に失敗: ${failed.map((result) => `${result.cli}: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`).join(", ")}`,
    );
}

if (process.argv[1] === import.meta.filename) {
  await checkModelCatalogs(
    process.argv[2] === "--source" ? undefined : path.resolve(process.argv[2]),
    path.resolve(process.argv[3]),
  );
}
