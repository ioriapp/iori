import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import { stopTerminalDaemon } from "../../verification/terminal/daemon-process.mjs";

async function image(client, terminalId, contents) {
  return client.request("terminal.image.write", {
    terminalId,
    imageId: randomUUID(),
    extension: "png",
    data: Buffer.from(contents).toString("base64"),
    first: true,
    last: true,
  });
}

test("Terminalの画像はHost再起動後も残り、閉じると回収される", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart }) => {
    const { terminal } = await client.request("terminal.create", {
      cwd: dataRoot,
      shell: "bash",
    });
    const before = await image(client, terminal.id, "first image");
    assert.equal(await readFile(before.path, "utf8"), "first image");
    const restarted = await restart();
    assert.equal(await readFile(before.path, "utf8"), "first image");
    const after = await image(restarted, terminal.id, "second image");
    assert.notEqual(after.path, before.path);
    assert.equal(await readFile(after.path, "utf8"), "second image");
    await restarted.request("terminal.close", { terminalId: terminal.id });
    await assert.rejects(readFile(before.path), { code: "ENOENT" });
    await assert.rejects(readFile(after.path), { code: "ENOENT" });
  }));

test("デーモンも停止した後に起動すると失われたTerminalの画像を回収する", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart }) => {
    const { terminal } = await client.request("terminal.create", {
      cwd: dataRoot,
      shell: "bash",
    });
    const saved = await image(client, terminal.id, "image");
    assert.equal(await readFile(saved.path, "utf8"), "image");
    const restarted = await restart({
      whileStopped: () => stopTerminalDaemon(join(dataRoot, "iori-host")),
    });
    await assert.rejects(readFile(saved.path), { code: "ENOENT" });
    const reopened = await restarted.terminal(terminal.id);
    await reopened.input("printf 'IMAGE_REOPENED\\n'\r");
    await reopened.output("IMAGE_REOPENED");
    const next = await image(restarted, terminal.id, "new image");
    assert.notEqual(next.path, saved.path);
    assert.equal(await readFile(next.path, "utf8"), "new image");
  }));
