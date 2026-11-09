import assert from "node:assert/strict";
import { openSidebar, closeSidebar } from "../connection/scenario.mjs";
import { waitFor } from "../../verification/ui.mjs";
import {
  create,
  open,
  observe,
  observed,
  clearObserved,
  typeTerminal,
} from "../terminal/scenario.mjs";

export async function mobileKeyBand({ client, mobile, record, shot }) {
  const id = await create(client);
  const screen = client.screen;
  await screen.click('[data-iori-action="settings-open"]');
  assert.equal(
    await screen.visible('[data-iori-action="settings-keyboard"]'),
    false,
  );
  await screen.click('[data-iori-action="settings-close"]');
  await mobile({ width: 390, height: 844 });
  await screen.wait('[data-iori-view="workspace"]');
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await open(client, id);
  await openSidebar(screen);
  await screen.click('[data-iori-action="settings-open"]');
  assert.equal(
    await screen.visible('[data-iori-action="settings-keyboard"]'),
    true,
  );
  await screen.click('[data-iori-action="open-devices"]');
  await screen.click('[data-iori-action="invite"]');
  await screen.wait(".invitation-qr-button");
  await screen.click(".invitation-qr-button");
  await screen.wait(".invitation-qr-dialog");
  await screen.key("Alt+ArrowLeft");
  assert.equal(await screen.visible(".invitation-qr-dialog"), false);
  assert.equal(await screen.visible('[data-iori-view="devices"]'), true);
  await screen.click('[data-iori-action="settings-close"]');
  await closeSidebar(screen);
  const pane = `[data-iori-terminal-id="${id}"]`;
  const key = (name) => `${pane} [data-iori-key="${name}"]`;
  const batch = `${pane} [data-iori-field="terminal-batch-input"]`;
  const action = (name) => `[data-iori-action="${name}"]`;
  const names = async () =>
    screen.evaluate(
      `Array.from(document.querySelectorAll(${JSON.stringify(pane + " .terminal-mobile-toggles > button")})).slice(0,4).map(button => button.textContent.trim())`,
    );
  assert.deepEqual(await names(), [
    "直接",
    "スマートフォンの幅",
    "貼り付け",
    "画像",
  ]);
  await screen.click(`${pane} ${action("terminal-input-live")}`);
  assert.deepEqual(await names(), [
    "まとめて",
    "スマートフォンの幅",
    "貼り付け",
    "画像",
  ]);
  await screen.click(`${pane} ${action("terminal-input-batch")}`);
  assert.deepEqual(await names(), [
    "直接",
    "スマートフォンの幅",
    "貼り付け",
    "画像",
  ]);
  await shot("mobile-button-names-on");
  for (const show of [false, true]) {
    await openSidebar(screen);
    await screen.click(action("settings-open"));
    await screen.click(action("settings-keyboard"));
    if (!show) {
      await screen.evaluate(
        "document.querySelector('.settings-content').scrollTop = document.querySelector('.settings-content').scrollHeight",
      );
      assert.ok(
        (await screen.evaluate(
          "document.querySelector('.settings-content').scrollTop",
        )) > 0,
      );
      await screen.click(action("settings-back"));
      await screen.click(action("open-connection"));
      assert.equal(
        await screen.evaluate(
          "document.querySelector('.settings-content').scrollTop",
        ),
        0,
      );
      await screen.click(action("settings-back"));
      await screen.click(action("settings-keyboard"));
    }
    const toggle = '[data-iori-field="keyboard-show-button-names"]';
    await screen.click(toggle);
    assert.equal(await screen.attribute(toggle, "aria-checked"), String(show));
    await screen.click(action("settings-close"));
    await closeSidebar(screen);
    assert.deepEqual(
      await names(),
      show
        ? ["直接", "スマートフォンの幅", "貼り付け", "画像"]
        : ["", "", "", ""],
    );
    if (!show) await shot("mobile-button-names-off");
  }
  await record(
    "帯の先頭の4つの名前と入力方式の状態名を表示し、設定のOFFでアイコンだけ、ONで名前が戻る",
  );
  const interrupt = async (mode, composition = false) => {
    await clearObserved(client);
    const command = `printf '%s%s\\n' 'SLEEP_' 'READY'; sleep 60`;
    if (mode === "live") await typeTerminal(client, `${command}\r`);
    else {
      await screen.input(batch, command);
      await screen.click(`${pane} [data-iori-action="terminal-batch-send"]`);
    }
    await observed(client, "SLEEP_READY");
    if (mode === "batch") await screen.input(batch, "draft stays here");
    await screen.tap(key("ctrl"));
    assert.equal(await screen.attribute(key("ctrl"), "aria-pressed"), "true");
    if (composition) {
      const field =
        mode === "batch" ? batch : `${pane} [data-iori-field="terminal-input"]`;
      await screen.evaluate(`(()=>{
        window.__keyBandCompositionEnded=false;
        document.querySelector(${JSON.stringify(field)}).addEventListener('compositionend',()=>{window.__keyBandCompositionEnded=true},{once:true});
      })()`);
      await client.browser.call("Input.imeSetComposition", {
        text: "c",
        selectionStart: 1,
        selectionEnd: 1,
      });
      // Batch input consumes and ends composition itself; inserting another
      // 'c' after that would be a new keystroke. xterm commits on IME confirmation.
      if (mode === "live")
        await client.browser.call("Input.insertText", { text: "c" });
      await waitFor(() => screen.evaluate("window.__keyBandCompositionEnded"));
    } else {
      await client.browser.call("Input.insertText", { text: "c" });
    }
    await waitFor(
      () => screen.attribute(key("ctrl"), "aria-pressed"),
      (value) => value === "false",
    );
    if (mode === "batch") {
      assert.equal(await screen.value(batch), "draft stays here");
      await screen.input(batch, "printf '%s%s\\n' 'BATCH_' 'INTERRUPTED'");
      await screen.click(`${pane} [data-iori-action="terminal-batch-send"]`);
      await observed(client, "BATCH_INTERRUPTED");
    } else {
      await typeTerminal(client, "printf '%s%s\\n' 'LIVE_' 'INTERRUPTED'\r");
      await observed(client, "LIVE_INTERRUPTED");
    }
  };
  await interrupt("live");
  await interrupt("live", true);
  await record(
    "直接入力でCtrlを保持し、通常入力とIME compositionのcが実PTYのsleepを止めて保持が外れる",
  );
  await screen.click(`${pane} [data-iori-action="terminal-input-live"]`);
  await screen.wait(batch);
  await interrupt("batch");
  await interrupt("batch", true);
  await record(
    "まとめて入力でも通常入力とIME compositionのCtrl+Cがsleepを止め、入力欄の下書きにcが混ざらず保持が外れる",
  );
  await screen.click(`${pane} [data-iori-action="terminal-input-batch"]`);
  await clearObserved(client);
  await typeTerminal(
    client,
    "stty -echo; printf '%s%s\\n' 'CAT_' 'READY'; cat -v; stty echo\r",
  );
  await observed(client, "CAT_READY");
  await screen.tap(key("alt"));
  assert.equal(await screen.attribute(key("alt"), "aria-pressed"), "true");
  await shot("mobile-key-band-alt");
  await screen.tap(key("alt"));
  assert.equal(await screen.attribute(key("alt"), "aria-pressed"), "false");
  await screen.swipe(key("arrowUp"), { x: 0.5, y: 0.8 }, { x: 0.5, y: -1 });
  await screen.tap(key("enter"));
  // Echo is off: this exact line is cat's PTY output, including any stray Alt bytes.
  await observed(client, /(?:^|\n)\s*\^\[\[5~\s*(?:\n|$)/u);
  await shot("mobile-key-band-swipe");
  await screen.tap(key("ctrlC"));
  await record(
    "Altの再タップは何も送らず解除し、↑の上スワイプがPgUpだけを実PTYへ送る",
  );
}
