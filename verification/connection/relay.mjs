import { local as verificationLocal } from "../native/local.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { linux, verificationPort } from "../native/remote.mjs";
import { waitFor } from "../ui.mjs";

/** Own only these development relays and this verification Host's UDP port. */
export async function startRelay(root, authenticated = false) {
  const bind = verificationLocal.network.hostAddress;
  const reservation = createServer();
  reservation.listen(0, bind);
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  const directory = path.join(
    root,
    authenticated ? "relay-auth" : "relay-open",
  );
  await mkdir(directory, { recursive: true });
  const config = path.join(directory, "config.toml");
  await writeFile(
    config,
    `http_bind_addr = "${bind}:${port}"\nenable_metrics = false\n${authenticated ? 'access.shared_token = ["configured-by-environment"]\n' : ""}`,
    { mode: 0o600 },
  );
  const token = authenticated
    ? randomBytes(32).toString("base64url")
    : undefined;
  const child = spawn(
    path.resolve(".local/tools/iroh-relay/bin/iroh-relay"),
    ["--dev", "--config-path", config],
    {
      stdio: "ignore",
      env: {
        ...process.env,
        ...(token ? { IROH_RELAY_ACCESS_TOKEN: token } : {}),
      },
    },
  );
  let failure;
  child.on("error", () => {
    failure = true;
  });
  const url = `http://${bind}:${port}/`;
  try {
    await waitFor(async () => {
      if (failure || child.exitCode !== null)
        throw new Error("検証用Relayを起動できませんでした");
      try {
        await fetch(url);
        return true;
      } catch {
        return false;
      }
    });
  } catch (error) {
    child.kill();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    url,
    token,
    async stop() {
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export function isolateDirectConnection(id) {
  const tables = JSON.parse(linux("sudo -n nft -j list tables")).nftables;
  for (const { table } of tables) {
    if (
      table?.family === "inet" &&
      /^iori_relay_[a-zA-Z0-9_]+$/u.test(table.name)
    )
      linux(`sudo -n nft delete table inet ${table.name}`);
  }
  const table = `iori_relay_${id.replaceAll(/[^a-zA-Z0-9_]/g, "_")}`;
  let active = false;
  return {
    block() {
      linux(
        `sudo -n nft -f - <<'IORI_RELAY_RULES'\nadd table inet ${table}\nadd chain inet ${table} output { type filter hook output priority 0; policy accept; }\nadd chain inet ${table} input { type filter hook input priority 0; policy accept; }\nadd rule inet ${table} output udp sport ${verificationPort} drop\nadd rule inet ${table} input udp dport ${verificationPort} drop\nIORI_RELAY_RULES`,
      );
      active = true;
    },
    restore() {
      if (active) {
        linux(`sudo -n nft delete table inet ${table}`);
        active = false;
      }
    },
  };
}
