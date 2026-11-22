import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:https";
import {
  createECDH,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { watch } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runHostTest } from "../../verification/host/process.mjs";
import { connectClient } from "../../verification/host/client.mjs";
import { prepareTls } from "../../verification/updates/distribution.mjs";
import { cliNotificationId } from "../../packages/protocol/src/index.ts";
import { registerWatchCli } from "./fixtures/watch-definition.mjs";

// Decode RFC 8291 independently of the sending library, using the device key.
function decrypt(body, receiver, auth) {
  const salt = body.subarray(0, 16);
  const sender = body.subarray(21, 21 + body[20]);
  const info = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    receiver.getPublicKey(),
    sender,
  ]);
  const ikm = hkdfSync(
    "sha256",
    receiver.computeSecret(sender),
    auth,
    info,
    32,
  );
  const key = hkdfSync(
    "sha256",
    ikm,
    salt,
    Buffer.from("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = hkdfSync(
    "sha256",
    ikm,
    salt,
    Buffer.from("Content-Encoding: nonce\0"),
    12,
  );
  const ciphertext = body.subarray(21 + body[20]);
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([
    decipher.update(ciphertext.subarray(0, -16)),
    decipher.final(),
  ]);
  assert.equal(plain.at(-1), 2);
  return JSON.parse(plain.subarray(0, -1).toString("utf8"));
}

for (const mode of [
  "offline",
  "connected",
  "disconnect",
  "gone",
  "revoked",
  "unavailable",
]) {
  const names = {
    offline:
      "未接続のデバイスへ判断待ちの通知を暗号化し、同じ待ちでは繰り返さない",
    connected: "接続しているデバイスへはPush通知を送らない",
    disconnect: "接続中に始まった判断待ちは切断後にPush通知する",
    gone: "配信先が410を返すと登録を削除し、次の通知を送らない",
    revoked: "デバイスを失効するとPush通知の登録も削除する",
    unavailable:
      "配信失敗のログはHTTPの状態番号だけを含み宛先と鍵と本文を含まない",
  };
  test(names[mode], (t) => {
    let server;
    const received = [];
    let arrived;
    const first = new Promise((resolve) => {
      arrived = resolve;
    });
    let stderr = "";
    let logged;
    const failure = new Promise((resolve) => {
      logged = resolve;
    });
    t.after(() => server && new Promise((resolve) => server.close(resolve)));
    return runHostTest(
      t,
      async ({ client, dataRoot, stage }) => {
        const receiver = createECDH("prime256v1");
        receiver.generateKeys();
        const auth = randomBytes(16);
        const subscription = {
          endpoint: `https://localhost:${server.address().port}/push`,
          keys: {
            p256dh: receiver.getPublicKey().toString("base64url"),
            auth: auth.toString("base64url"),
          },
        };
        const deviceKey = (await client.request("devices.list"))
          .currentDevicePublicKey;
        assert.equal(
          (await client.request("host.info")).pushNotifications,
          true,
        );
        await client.request("notifications.push.set", {
          subscription,
          language: "ja",
          waiting: true,
          done: true,
        });
        const controller = await connectClient(dataRoot);
        t.after(() => controller.close());
        if (mode !== "connected" && mode !== "disconnect") await client.close();
        const events = await controller.events();
        await events.waitFor((event) => event.type === "snapshot");
        const cliId = await registerWatchCli(controller, dataRoot);
        const { terminal } = await controller.request("cli.launch", {
          cliId,
          cwd: dataRoot,
        });
        const pty = await controller.terminal(terminal.id);
        const output = await pty.output(/WATCH_CONTROL:([^\r\n]+)\r?\n/u);
        const control = output.match(/WATCH_CONTROL:([^\r\n]+)\r?\n/u)[1];
        let subscriptionRemoved;
        if (mode === "gone") {
          const directory = join(dataRoot, "iori-host");
          const db = new DatabaseSync(join(directory, "host.sqlite"), {
            readOnly: true,
          });
          let watcher;
          let settled = false;
          subscriptionRemoved = new Promise((resolve) => {
            const check = () => {
              if (settled || !db.isOpen) return;
              if (
                db
                  .prepare(
                    "SELECT count(*) AS n FROM push_subscriptions WHERE device_public_key = ?",
                  )
                  .get(deviceKey).n === 0
              ) {
                settled = true;
                watcher.close();
                db.close();
                resolve();
              }
            };
            watcher = watch(directory, check);
            t.after(() => {
              watcher.close();
              if (db.isOpen) db.close();
            });
            check();
          });
        }
        if (mode === "revoked")
          await controller.request("devices.revoke", { publicKey: deviceKey });
        stage("CLIの判断待ちを公開する");
        await appendFile(control, "HOOK_WAITING\n");
        await events.waitFor(
          (event) =>
            event.type === "terminal.updated" &&
            event.terminal.id === terminal.id &&
            event.terminal.cliStatus?.state === "waiting",
        );
        if (mode === "disconnect") await client.close();
        if (mode === "unavailable") {
          stage("配信失敗のログにHTTPの状態番号だけがあることを確かめる");
          await failure;
          assert.match(stderr, /iori-host push-delivery-failed status=503/u);
          for (const privateValue of [
            subscription.endpoint,
            subscription.keys.p256dh,
            subscription.keys.auth,
            "private-response-body",
          ])
            assert.equal(stderr.includes(privateValue), false);
          return;
        }
        if (mode === "offline" || mode === "gone" || mode === "disconnect") {
          const delivery = await first;
          assert.equal(delivery.headers["content-encoding"], "aes128gcm");
          assert.equal(delivery.headers.ttl, "86400");
          assert.equal(delivery.headers.authorization, undefined);
          const hostKey = (await controller.request("host.info")).publicKey;
          assert.deepEqual(decrypt(delivery.body, receiver, auth), {
            v: 1,
            id: cliNotificationId({ hostKey, terminalId: terminal.id }),
            title: `${basename(dataRoot)} - Watch CLI (watch-cli) 承認待ち`,
            body: "Watch CLI (watch-cli)",
            target: { hostKey, terminalId: terminal.id },
          });
        }
        if (mode === "gone") await subscriptionRemoved;
        if (mode === "gone" || mode === "revoked") {
          const db = new DatabaseSync(
            join(dataRoot, "iori-host", "host.sqlite"),
            { readOnly: true },
          );
          try {
            assert.equal(
              db
                .prepare(
                  "SELECT count(*) AS n FROM push_subscriptions WHERE device_public_key = ?",
                )
                .get(deviceKey).n,
              0,
            );
          } finally {
            db.close();
          }
        }
        if (mode === "offline" || mode === "disconnect") {
          stage("同じ待ちの内容を更新しても再通知しない");
          await appendFile(control, "HOOK_WAITING_CHANGED\n");
          await events.waitFor(
            (event) =>
              event.type === "terminal.updated" &&
              event.terminal.id === terminal.id &&
              event.terminal.cliStatus?.attention?.tool === "Read",
          );
        } else {
          await appendFile(control, "HOOK_STOP\n");
          await events.waitFor(
            (event) =>
              event.type === "terminal.updated" &&
              event.terminal.id === terminal.id &&
              event.terminal.cliStatus?.state === "done",
          );
        }
        await controller.request("host.info");
        assert.equal(
          received.length,
          mode === "offline" || mode === "gone" || mode === "disconnect"
            ? 1
            : 0,
        );
      },
      {
        onStderr: (chunk) => {
          stderr += chunk;
          if (stderr.includes("iori-host push-delivery-failed")) logged();
        },
        prepareEnvironment: async (dataRoot) => {
          const tls = await prepareTls(join(dataRoot, "push"), "Android");
          server = createServer(
            {
              key: await readFile(join(tls, "key.pem")),
              cert: await readFile(join(tls, "cert.pem")),
            },
            async (request, response) => {
              const chunks = [];
              for await (const chunk of request) chunks.push(chunk);
              const delivery = {
                body: Buffer.concat(chunks),
                headers: request.headers,
              };
              received.push(delivery);
              response.on("finish", () => arrived(delivery));
              response
                .writeHead(
                  mode === "gone" ? 410 : mode === "unavailable" ? 503 : 201,
                )
                .end(mode === "unavailable" ? "private-response-body" : "");
            },
          );
          await new Promise((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
          );
          return { NODE_EXTRA_CA_CERTS: join(tls, "ca.pem") };
        },
      },
    );
  });
}
