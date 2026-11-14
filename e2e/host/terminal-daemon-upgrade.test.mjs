import assert from "node:assert/strict";
import { watch } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import { daemonProxy } from "../../verification/host/daemon-proxy.mjs";

const distribution = process.env.IORI_PREVIOUS_HOST_BUNDLE;
const targetDistribution = process.env.IORI_TARGET_HOST_BUNDLE;
const quote = (word) => `'${word.replaceAll("'", "'\\''")}'`;

for (const forceReplacement of [false, true])
  test(
    forceReplacement
      ? "デーモンの停止応答のOSCから画面とタイトルと作業ディレクトリを引き継ぐ"
      : "前の配布物のデーモンから画面とタイトルと作業ディレクトリを引き継ぐ",
    {
      skip:
        !forceReplacement &&
        !distribution &&
        "IORI_PREVIOUS_HOST_BUNDLEに変更前の配布物を指定する",
    },
    (t) =>
      runHostTest(
        t,
        async ({ client, dataRoot, restart, stage }) => {
          const cwd = join(dataRoot, "next-directory");
          await mkdir(cwd);
          const actor = join(dataRoot, "upgrade-actor.mjs");
          const emitted = join(dataRoot, "metadata-emitted");
          await writeFile(
            actor,
            `
    import {watch,writeFileSync} from 'node:fs';
    process.stdin.setRawMode(true);process.stdin.on('data',()=>{});
    watch(process.cwd(),(_,file)=>{if(file==='fire-metadata'){
      process.stdout.write(${JSON.stringify("\x1b]2;UPGRADE_TITLE\x07\x1b]7;" + pathToFileURL(cwd).href + "\x07UPGRADE_SCREEN\r\n")},()=>writeFileSync(${JSON.stringify(emitted)},''));
    }});
    console.log('UPGRADE_ACTOR_READY');
  `,
          );
          const { terminal: created } = await client.request(
            "terminal.create",
            {
              cwd: dataRoot,
              shell: "bash",
            },
          );
          const terminal = await client.terminal(created.id);
          await terminal.input(`node ${quote(actor)}\r`);
          await terminal.output("UPGRADE_ACTOR_READY");
          const descriptorFile = join(
            dataRoot,
            "iori-host/terminal-daemon/connection.json",
          );
          const before = JSON.parse(await readFile(descriptorFile, "utf8"));
          stage("Host不在中に古いデーモンの画面とOSCを更新する");
          client = await restart({
            distribution: targetDistribution ?? null,
            whileStopped: async () => {
              const ready = new Promise((resolve, reject) => {
                const watcher = watch(dataRoot, async () => {
                  if (
                    await access(emitted).then(
                      () => true,
                      () => false,
                    )
                  ) {
                    watcher.close();
                    resolve();
                  }
                });
                watcher.once("error", reject);
                t.after(() => watcher.close());
              });
              await writeFile(join(dataRoot, "fire-metadata"), "");
              await ready;
              if (forceReplacement) {
                // Only the version negotiation is changed at the socket boundary.
                // The real daemon supplies its unchanged shutdown response.
                const proxy = await daemonProxy(dataRoot, {
                  version: before.version - 1,
                });
                t.after(() => proxy.close());
              }
            },
          });
          stage("新しいHostが古いデーモンを停止して保存した値を確認する");
          const restored = (
            await client.request("terminal.list")
          ).terminals.find(({ id }) => id === created.id);
          assert.equal(restored.title, "UPGRADE_TITLE");
          assert.equal(restored.cwd, cwd);
          const after = JSON.parse(await readFile(descriptorFile, "utf8"));
          // The protocol omits restartPending unless it is true.
          assert.equal(
            restored.restartPending === true,
            forceReplacement || before.version !== after.version,
          );
          // Opening restarts the shell and replays the preserved screen as history.
          const reopened = await client.terminal(created.id);
          await reopened.output("UPGRADE_SCREEN");
        },
        { distribution: forceReplacement ? targetDistribution : distribution },
      ),
  );
