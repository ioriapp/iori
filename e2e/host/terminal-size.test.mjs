import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import { connectClient } from "../../verification/host/client.mjs";
import { stopTerminalDaemon } from "../../verification/terminal/daemon-process.mjs";

async function create(client, cwd) {
  return (await client.request("terminal.create", { cwd, shell: "bash" }))
    .terminal;
}

async function readSize(terminal, marker, rows, cols) {
  await terminal.input(`printf '${marker} '; /bin/stty size\r`);
  await terminal.output(`${marker} ${rows} ${cols}`);
}

async function changed(terminal, cols, rows) {
  await terminal.waitFor(
    ({ frame }) =>
      frame.kind === "terminal.size" &&
      frame.cols === cols &&
      frame.rows === rows,
  );
}

test("指定した寸法が実際のPTYに適用される", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const sizeClient = await connectClient(dataRoot);
    try {
      const created = await create(client, dataRoot);
      stage("Terminalを開き、指定寸法をPTYから読む");
      const terminal = await sizeClient.terminal(created.id, {
        cols: 103,
        rows: 31,
      });
      await readSize(terminal, "OPEN_SIZE", 31, 103);
      stage("寸法変更後の値をPTYから読む");
      await terminal.resize(91, 27);
      await changed(terminal, 91, 27);
      await readSize(terminal, "RESIZED", 27, 91);
    } finally {
      await sizeClient.close();
    }
  }));

test("別端末の操作でPTYの寸法を引き継ぎ、読むだけの再接続では変えない", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const pc = await connectClient(dataRoot);
    const phone = await connectClient(dataRoot);
    try {
      const created = await create(client, dataRoot);
      const desktop = await pc.terminal(created.id, { cols: 110, rows: 32 });
      stage("スマホで開いた寸法へ切り替わる");
      const mobile = await phone.terminal(created.id, {
        cols: 45,
        rows: 24,
        deviceClass: "mobile",
      });
      await readSize(mobile, "PHONE_SIZE", 24, 45);
      stage("PCで操作するとPC寸法へ戻る");
      await desktop.focus(110, 32);
      await changed(mobile, 110, 32);
      await readSize(desktop, "PC_SIZE", 32, 110);
      stage("読むだけのスマホ再接続ではPC寸法を保つ");
      const reader = await phone.terminal(created.id, {
        cols: 44,
        rows: 23,
        deviceClass: "mobile",
        claimSize: false,
      });
      assert.equal(reader.values[0].frame.snapshot.cols, 110);
      assert.equal(reader.values[0].frame.snapshot.rows, 32);
      await readSize(desktop, "REOPEN_SIZE", 32, 110);
      stage("スマホの操作で再びスマホ寸法にする");
      await reader.focus(44, 23);
      await changed(desktop, 44, 23);
      await readSize(reader, "PHONE_AGAIN", 23, 44);
    } finally {
      await phone.close();
      await pc.close();
    }
  }));

test("新しいTerminalは実行中のTerminalで最も広いPC寸法から始まる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const sizes = await connectClient(dataRoot);
    try {
      const wide = await create(client, dataRoot);
      await sizes.terminal(wide.id, { cols: 130, rows: 33 });
      const narrow = await create(client, dataRoot);
      await sizes.terminal(narrow.id, { cols: 75, rows: 25 });
      stage("狭いTerminalの後でも広い寸法で作る");
      const created = await create(client, dataRoot);
      assert.equal(created.cols, 130);
      assert.equal(created.rows, 33);
      const terminal = await sizes.terminal(created.id, {
        cols: created.cols,
        rows: created.rows,
      });
      await readSize(terminal, "NEW_SIZE", 33, 130);
    } finally {
      await sizes.close();
    }
  }));

test("HostとTerminalデーモンの再起動後も保存した最も広いPC寸法から始まる", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const sizes = await connectClient(dataRoot);
    try {
      const wide = await create(client, dataRoot);
      await sizes.terminal(wide.id, { cols: 132, rows: 34 });
      const narrow = await create(client, dataRoot);
      await sizes.terminal(narrow.id, { cols: 76, rows: 26 });
    } finally {
      await sizes.close();
    }
    stage("Hostと検証専用のTerminalデーモンを再起動する");
    const reconnected = await restart({
      whileStopped: () => stopTerminalDaemon(join(dataRoot, "iori-host")),
    });
    stage("保存済みの広い寸法で新しいTerminalを作る");
    const created = await create(reconnected, dataRoot);
    assert.equal(created.cols, 132);
    assert.equal(created.rows, 34);
    const next = await connectClient(dataRoot);
    try {
      const terminal = await next.terminal(created.id, {
        cols: created.cols,
        rows: created.rows,
      });
      await readSize(terminal, "SAVED_SIZE", 34, 132);
    } finally {
      await next.close();
    }
  }));

test("日本語の入出力を保持し、別の接続から同じシェルを続けられる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const created = await create(client, dataRoot);
    const first = await client.terminal(created.id);
    stage("日本語を入力し実行結果を受け取る");
    await first.input(
      "export IORI_SESSION='同じ'シェル; printf '%s%s\\n' '日本語の' '実行結果'\r",
    );
    await first.output("日本語の実行結果");
    stage("開き直した画面に出力が残り、同じシェルへ入力できる");
    const reopened = await client.terminal(created.id);
    await reopened.output("日本語の実行結果");
    await reopened.input("printf '%s\\n' \"$IORI_SESSION\"\r");
    await reopened.output("同じシェル");
  }));
