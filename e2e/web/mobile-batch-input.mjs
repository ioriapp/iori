import { fakeMarker } from "../fake-model/marker.mjs";
import { openClaude } from "../cli-screen/claude-status.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import {
  observe,
  observedTerminalMode,
  observeTerminalInstances,
  clearObserved,
  open,
  create,
} from "../terminal/scenario.mjs";

export async function mobileBatchInput({
  client,
  mobile,
  fakeModelRequests,
  record,
  shot,
}) {
  const screen = client.screen;
  // Complete the CLI's startup questions on desktop with the shared helper.
  // This Terminal has no saved Mobile input choice when first opened on phone.
  const id = await openClaude(client);
  // Reopen the view after reload so the shared observer can read its real buffer.
  await screen.click(
    `.dock-tab-header:has([data-iori-tab-id="terminal:${id}"]) [data-iori-action="workspace-close-tab"]`,
  );
  await mobile();
  await screen.wait('[data-iori-view="workspace"]');
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await observeTerminalInstances(client);
  await open(client, id);
  const batch = `[data-iori-terminal-id="${id}"] [data-iori-field="terminal-batch-input"]`;
  const resizeForKeyboard = async (height) => {
    // Android's existing IME insets shrink the WebView itself. Change the
    // browser's real viewport through CDP, without replacing DOM size APIs.
    await client.browser.call("Emulation.setDeviceMetricsOverride", {
      width: 400,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // A dimension read can precede delivery of the resize event. Let each
    // frame reach the app before sending the next keyboard animation size.
    await screen.evaluate(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
    await waitFor(
      () => screen.evaluate("window.innerHeight"),
      (value) => value === height,
    );
  };
  const swipeWithoutFocus = async () => {
    await screen.swipe(
      `[data-iori-terminal-id="${id}"] .xterm-screen`,
      { x: 0.5, y: 0.3 },
      { x: 0.5, y: 0.65 },
    );
    assert.equal(
      await screen.evaluate("document.activeElement.matches('textarea')"),
      false,
      "キーボードを閉じた後のswipeで入力先に焦点が残らない",
    );
  };
  await screen.wait(batch);
  assert.equal(
    await screen.evaluate("document.activeElement.matches('textarea')"),
    false,
  );
  await observedTerminalMode(client, "bracketedPaste", true);
  await screen.input(batch, "ABC");
  await screen.key("End");
  await screen.key("ArrowLeft");
  await screen.key("Shift+ArrowLeft");
  await screen.evaluate(
    "navigator.clipboard.writeText('貼り付け\\n続き').then(()=>true)",
  );
  await screen.click('[data-iori-action="terminal-paste"]');
  await waitFor(
    () => screen.value(batch),
    (value) => value === "A貼り付け\n続きC",
    undefined,
    "キーの帯の貼り付けが入力欄の選択範囲を改行付きの文字で置き換える",
  );
  await record(
    "まとめて入力の貼り付けは選択範囲を置き換え、改行を入力欄に保つ",
  );
  await clearObserved(client);
  await screen.input(
    batch,
    "Join the two words on the next line without any spaces. Reply only with the joined word. Do not use tools." +
      fakeMarker("mobile-batch-input"),
  );
  await screen.key("End");
  await screen.key("Enter");
  assert.equal(
    await screen.evaluate(
      `document.querySelector(${JSON.stringify(batch)}).value.endsWith('\\n')`,
    ),
    true,
  );
  await client.browser.call("Input.insertText", { text: "AZURE BIRCH" });
  assert.equal(
    await screen.evaluate(
      `document.querySelector(${JSON.stringify(batch)}).value.split('\\n').length`,
    ),
    2,
  );
  await resizeForKeyboard(600);
  await screen.click('[data-iori-action="terminal-batch-send"]');
  assert.equal(
    await screen.evaluate(
      `document.activeElement.matches(${JSON.stringify(batch)})`,
    ),
    true,
    "送信後も続けて入力できる",
  );
  const cliBuffer = await waitFor(
    () =>
      screen.evaluate(`(()=>{
      const buffer=document.querySelector('[data-iori-terminal-id="${id}"] [data-iori-part="terminal-screen"]').__e2eTerminal.buffer.active;
      return Array.from({length:buffer.length},(_,row)=>buffer.getLine(row).translateToString(true)).join('\\n');
    })()`),
    (text) => text.includes("AZUREBIRCH"),
  );
  if (fakeModelRequests)
    assert.equal(
      fakeModelRequests.find(
        (request) =>
          request.marker === "mobile-batch-input" &&
          request.step === 0 &&
          request.toolsProvided,
      )?.tokensPresent["AZURE BIRCH"],
      true,
      "まとめて入力した語が一続きでモデル要求に含まれる",
    );
  assert.match(
    cliBuffer,
    /^\s*❯ Join the two words[^\n]*(?:\n(?!\s*❯)[^\n]*)*\n\s*AZURE BIRCH[^\S\n]*(?:\n|$)/mu,
  );
  assert.equal(
    await screen.evaluate(
      `document.querySelector(${JSON.stringify(batch)}).value`,
    ),
    "",
  );
  await record(
    "MobileのCLIは焦点なしで開き、Enterで改行した2行がClaude Code（haiku）の1つの発言ブロックに表示され、結合した回答が返る",
  );
  await resizeForKeyboard(900);
  await swipeWithoutFocus();
  await record(
    "まとめて入力の送信後、キーボードを閉じてswipeしても入力欄に焦点が残らない",
  );
  await screen.swipe(batch, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 });
  assert.equal(
    await screen.evaluate(
      `document.activeElement.matches(${JSON.stringify(batch)})`,
    ),
    true,
    "キーボードを閉じた後も入力欄のtapで焦点を戻せる",
  );
  const draft = "次の依頼の書きかけ\nまだ送信しない";
  await screen.input(batch, draft);
  await screen.click('[data-iori-action="terminal-batch-expand"]');
  const expanded = '[data-iori-field="terminal-expanded-input"]';
  await screen.wait(expanded);
  assert.equal(
    await screen.evaluate(`document.querySelector('${expanded}').value`),
    draft,
  );
  const expandedDraft = `${draft}\n全画面で追記`;
  await screen.input(expanded, expandedDraft);
  await resizeForKeyboard(600);
  await resizeForKeyboard(750);
  assert.equal(
    await screen.evaluate(`document.activeElement.matches('${expanded}')`),
    true,
    "キーボードが閉じる途中では入力欄の焦点を外さない",
  );
  await resizeForKeyboard(900);
  await waitFor(
    () => screen.evaluate("document.activeElement.matches('textarea')"),
    (value) => !value,
    undefined,
    "キーボードを閉じると全画面の入力欄も焦点を外す",
  );
  assert.equal(await screen.value(expanded), expandedDraft);
  await screen.swipe(expanded, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 });
  assert.equal(
    await screen.evaluate(`document.activeElement.matches('${expanded}')`),
    true,
  );
  await shot("mobile-batch-expanded");
  await screen.click('[data-iori-action="terminal-batch-collapse"]');
  await mobile();
  await screen.wait('[data-iori-view="workspace"]');
  await observeTerminalInstances(client);
  await open(client, id);
  await screen.wait(batch);
  assert.equal(
    await screen.evaluate(
      `document.querySelector(${JSON.stringify(batch)}).value`,
    ),
    expandedDraft,
  );
  await shot("mobile-batch-restored");
  await screen.click('[data-iori-action="terminal-input-batch"]');
  await mobile();
  await screen.wait('[data-iori-view="workspace"]');
  await observeTerminalInstances(client);
  await open(client, id);
  await screen.wait('[data-iori-action="terminal-input-live"]');
  // The center may contain /model or a file path after CLI reflow. Tap
  // ordinary words from the actual output to exercise immediate input focus.
  const tapPlainText = async () => {
    const at = await screen.evaluate(`(()=>{
      const t=document.querySelector('[data-iori-terminal-id="${id}"] [data-iori-part="terminal-screen"]').__e2eTerminal;
      const b=t.buffer.active;
      for(let row=b.viewportY;row<b.viewportY+t.rows;row++){
        const line=b.getLine(row)?.translateToString(false)??'';
        const match=/\\b(Join|Reply|words)\\b/.exec(line);
        if(!match)continue;
        const r=t.element.querySelector('.xterm-screen').getBoundingClientRect();
        return {x:r.x+(match.index+1.5)*r.width/t.cols,y:r.y+(row-b.viewportY+0.5)*r.height/t.rows};
      }
      throw new Error('表示中のCLIの文が見つかりません');
    })()`);
    await client.browser.call("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 0, ...at }],
    });
    await client.browser.call("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  await tapPlainText();
  assert.equal(
    await screen.evaluate(
      "document.activeElement.matches('[data-iori-field=\"terminal-input\"]')",
    ),
    true,
  );
  await resizeForKeyboard(600);
  await resizeForKeyboard(900);
  await swipeWithoutFocus();
  await tapPlainText();
  assert.equal(
    await screen.evaluate(
      "document.activeElement.matches('[data-iori-field=\"terminal-input\"]')",
    ),
    true,
    "キーボードを閉じた後も直接入力のtapで焦点を戻せる",
  );
  await record(
    "全画面の下書きを保ってキーボードを閉じ、直接入力でも閉じた後のswipeは焦点を戻さず、tapでは戻る",
  );
  const shell = await create(client);
  await screen.wait(
    `[data-iori-terminal-id="${shell}"] [data-iori-action="terminal-input-live"]`,
  );
  await record(
    "全画面から下書きを戻し、Clientを読み込み直して下書きとTerminal別の入力方式を復元する。新しいshellは直接入力で始まる",
  );
}
