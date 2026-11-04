import { selectWorktree } from "../workspace/scenario.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  chmod,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { waitFor } from "../../verification/ui.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";

/** Chromium File objects pass through the same drop handler as Explorer files. */
async function drop(screen, target, name, size, value, event = "drop", file) {
  if (file) {
    await screen.evaluate(`(()=>{
      const input=document.createElement('input');
      input.type='file';input.id='iori-transfer-fixture';document.body.append(input);
    })()`);
    try {
      const { root } = await file.browser.call("DOM.getDocument");
      const { nodeId } = await file.browser.call("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: "#iori-transfer-fixture",
      });
      await file.browser.call("DOM.setFileInputFiles", {
        nodeId,
        files: [file.path],
      });
      await screen.evaluate(`(()=>{
        const target=document.querySelector(${JSON.stringify(target)}),data=new DataTransfer();
        data.items.add(document.querySelector('#iori-transfer-fixture').files[0]);
        target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));
        ${event === "drop" ? "target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));" : ""}
      })()`);
    } finally {
      await screen.evaluate(
        "document.querySelector('#iori-transfer-fixture')?.remove()",
      );
    }
  } else
    await screen.evaluate(`(()=>{
    const target=document.querySelector(${JSON.stringify(target)}),data=new DataTransfer();
    data.items.add(new File([new Uint8Array(${size}).fill(${value})],${JSON.stringify(name)}));
    target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));
    ${event === "drop" ? "target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));" : ""}
    return true;
  })()`);
}

// Transfer duration depends on file size and load. The scenario runner bounds
// the operation; completion comes from the actual file, not a transient UI row.
async function transferComplete(screen, complete, previousAlerts, observation) {
  for (;;) {
    const failed = await screen.evaluate(`
      [...document.querySelectorAll('.files-tree [role="alert"]')]
        .some(alert=>!${JSON.stringify(previousAlerts)}.includes(alert.textContent))
    `);
    if (failed) throw new Error(`${observation}：転送の失敗が表示されました`);
    if (await complete()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export async function filesTransfer({
  client,
  screen,
  repository,
  worktree,
  mobile,
  desktop,
  shot,
  record,
}) {
  const largeSize = 256 * 1024 * 1024;
  const fixtures = join(dirname(repository), "files-transfer-input");
  await mkdir(fixtures, { recursive: true });
  await writeFile(join(fixtures, "continues.bin"), Buffer.alloc(largeSize, 68));
  await writeFile(join(fixtures, "cancel.bin"), Buffer.alloc(largeSize, 67));
  await mkdir(join(repository, "put-files"), { recursive: true });
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(repository)}]`,
  );
  await openWorkspaceView(screen, "files");
  const folder = '[data-iori-file="put-files"]';
  await screen.wait(folder);
  // Existing warnings belong to earlier actions, not these transfers. Keep
  // their text across the worktree switch, which recreates the Files tree.
  const previousAlerts = await screen.evaluate(
    `[...document.querySelectorAll('.files-tree [role="alert"]')].map(alert=>alert.textContent)`,
  );
  const enter = async (device, viewport) => {
    if (device === "mobile") {
      await mobile(viewport);
      await selectWorktree(screen, repository, true);
      await openSidebar(screen);
    } else await desktop();
    await openWorkspaceView(screen, "files");
    await screen.wait(folder);
  };
  const initialDark = await screen.evaluate(
    "document.documentElement.classList.contains('dark')",
  );
  for (const [device, viewport] of [
    ["pc", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    await enter(device, viewport);
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
      );
      await drop(screen, folder, "input.txt", 8, 65, "dragover");
      await shot(`${device}-files-put-drag-${theme}`);
    }
  }
  await enter("pc");
  await drop(screen, folder, "input.txt", 5 * 1024 * 1024 + 17, 65);
  const placed = join(repository, "put-files", "input.txt");
  await transferComplete(
    screen,
    async () =>
      (await readFile(placed).catch(() => Buffer.alloc(0))).length ===
      5 * 1024 * 1024 + 17,
    previousAlerts,
    "input.txt のアップロード完了",
  );
  assert.equal(
    (await readFile(placed)).equals(Buffer.alloc(5 * 1024 * 1024 + 17, 65)),
    true,
  );
  // A worktree switch unmounts its Files View, while the app keeps both drops.
  await drop(screen, folder, "continues.bin", largeSize, 68, "drop", {
    browser: client.browser,
    path: join(fixtures, "continues.bin"),
  });
  await screen.wait('[data-iori-put="continues.bin"]');
  await drop(screen, folder, "alongside.txt", 5 * 1024 * 1024 + 17, 69);
  await screen.wait('[data-iori-put="alongside.txt"]');
  assert.equal(await screen.visible('[data-iori-put="continues.bin"]'), true);
  await selectWorktree(screen, worktree, false);
  await selectWorktree(screen, repository, false);
  await openWorkspaceView(screen, "files");
  await screen.wait(folder);
  await transferComplete(
    screen,
    async () =>
      (
        await stat(join(repository, "put-files", "continues.bin")).catch(
          () => ({}),
        )
      ).size === largeSize &&
      (
        await stat(join(repository, "put-files", "alongside.txt")).catch(
          () => ({}),
        )
      ).size ===
        5 * 1024 * 1024 + 17,
    previousAlerts,
    "並行アップロードの完了",
  );
  assert.equal(
    (await stat(join(repository, "put-files", "continues.bin"))).size,
    largeSize,
  );
  assert.equal(
    (await readFile(join(repository, "put-files", "alongside.txt"))).equals(
      Buffer.alloc(5 * 1024 * 1024 + 17, 69),
    ),
    true,
  );
  assert.equal(
    (await readFile(join(repository, "put-files", "continues.bin"))).equals(
      Buffer.alloc(largeSize, 68),
    ),
    true,
  );
  await record(
    "転送中のworktreeの往復と、別の小さいファイルの並行ドロップが完了する",
  );
  await chmod(placed, 0o640);
  for (const [device, viewport] of [
    ["pc", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    await enter(device, viewport);
    await drop(screen, folder, "input.txt", 13, 66);
    await screen.wait('[data-iori-dialog="files-replace"]');
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
      );
      await shot(`${device}-files-put-replace-${theme}`);
    }
    await screen.key("Escape");
  }
  await drop(screen, folder, "input.txt", 13, 66);
  await screen.wait('[data-iori-dialog="files-replace"]');
  await screen.click('[data-iori-action="files-put-replace"]');
  await transferComplete(
    screen,
    async () => (await readFile(placed)).equals(Buffer.alloc(13, 66)),
    previousAlerts,
    "置き換えアップロードの完了",
  );
  assert.equal((await readFile(placed)).equals(Buffer.alloc(13, 66)), true);
  assert.equal((await stat(placed)).mode & 0o777, 0o640);
  for (const [device, viewport] of [
    ["pc", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    await enter(device, viewport);
    if ((await screen.attribute(folder, "aria-expanded")) !== "true")
      await screen.click(folder);
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
      );
      // A real large file leaves enough time to cancel through its visible control.
      await drop(screen, folder, "cancel.bin", largeSize, 67, "drop", {
        browser: client.browser,
        path: join(fixtures, "cancel.bin"),
      });
      await screen.wait('[data-iori-put="cancel.bin"]');
      assert.equal(
        await screen.evaluate(
          "[...document.querySelectorAll('[data-iori-file]')].some(entry=>entry.dataset.ioriFile.includes('.iori-put-'))",
        ),
        false,
      );
      await shot(`${device}-files-put-progress-${theme}`);
      await screen.click(
        '[data-iori-put="cancel.bin"] [data-iori-action="files-put-cancel"]',
      );
      await waitFor(
        async () =>
          !(await readdir(join(repository, "put-files"))).some((name) =>
            name.startsWith(".iori-put-"),
          ),
        Boolean,
        undefined,
        "アップロードのキャンセル後の一時ファイル回収",
      );
      assert.equal(
        (await readdir(join(repository, "put-files"))).includes("cancel.bin"),
        false,
      );
    }
  }
  assert.equal((await readFile(placed)).equals(Buffer.alloc(13, 66)), true);
  await enter("pc");
  await screen.evaluate(
    `document.documentElement.classList.toggle('dark',${initialDark})`,
  );
  await openWorkspaceView(screen, "files");
  if ((await screen.attribute(folder, "aria-expanded")) !== "true")
    await screen.click(folder);
  const fileRow = '[data-iori-file="put-files/input.txt"]';
  await screen.wait(fileRow);
  // Only the OS location picker is replaced. The browser's real file stream is
  // written by the native-web boundary, then read back from browser storage.
  await screen.evaluate(
    `window.showSaveFilePicker=async options=>{window.__ioriSavedName=options.suggestedName;return (await navigator.storage.getDirectory()).getFileHandle('iori-saved-file',{create:true})}`,
  );
  await screen.contextMenu(fileRow);
  await screen.click('[data-iori-action="files-save"]');
  await transferComplete(
    screen,
    () =>
      screen
        .evaluate(
          `(async()=>{const handle=await(await navigator.storage.getDirectory()).getFileHandle('iori-saved-file');return (await handle.getFile()).size===13})()`,
        )
        .catch(() => false),
    previousAlerts,
    "input.txt のダウンロード完了",
  );
  assert.equal(
    await screen.evaluate(
      `(async()=>{const handle=await(await navigator.storage.getDirectory()).getFileHandle('iori-saved-file');const file=await handle.getFile();return window.__ioriSavedName==='input.txt'&&(await file.text())==='BBBBBBBBBBBBB'})()`,
    ),
    true,
  );
  // Save a real large file through the same stream, capturing the shared rows.
  await writeFile(
    join(repository, "put-files", "save-progress.bin"),
    Buffer.alloc(128 * 1024 * 1024, 70),
  );
  const savingRow = '[data-iori-file="put-files/save-progress.bin"]';
  for (const [device, viewport] of [
    ["pc", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    await enter(device, viewport);
    if ((await screen.attribute(folder, "aria-expanded")) !== "true")
      await screen.click(folder);
    await screen.wait(savingRow);
    await screen.evaluate(
      `window.showSaveFilePicker=async()=> (await navigator.storage.getDirectory()).getFileHandle('iori-save-progress',{create:true})`,
    );
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
      );
      await screen.contextMenu(savingRow);
      await screen.click('[data-iori-action="files-save"]');
      await screen.wait('[data-iori-save="save-progress.bin"]');
      await waitFor(
        () =>
          screen.evaluate(
            `Number(document.querySelector('[data-iori-save="save-progress.bin"] progress')?.value)>0`,
          ),
        Boolean,
        undefined,
        "ダウンロードの進行開始",
      );
      if (device === "pc" && theme === "light") {
        await selectWorktree(screen, worktree, false);
        await selectWorktree(screen, repository, false);
        await openWorkspaceView(screen, "files");
        await screen.wait('[data-iori-save="save-progress.bin"]');
      }
      await shot(`${device}-files-save-progress-${theme}`);
      await screen.click(
        '[data-iori-save="save-progress.bin"] [data-iori-action="files-save-cancel"]',
      );
      await waitFor(
        () => screen.visible('[data-iori-save="save-progress.bin"]'),
        (visible) => !visible,
        undefined,
        "ダウンロードのキャンセル",
      );
    }
  }
  await enter("pc");
  if ((await screen.attribute(folder, "aria-expanded")) !== "true")
    await screen.click(folder);
  await screen.click(fileRow);
  await screen.contextMenu('[data-iori-tab="put-files/input.txt"]');
  await screen.wait('[data-iori-action="files-save"]');
  await screen.key("Escape");
  await screen.evaluate(
    `(async()=>{delete window.showSaveFilePicker;await(await navigator.storage.getDirectory()).removeEntry('iori-saved-file');await(await navigator.storage.getDirectory()).removeEntry('iori-save-progress')})()`,
  );
  await record(
    "Filesへの5MiB超のドロップ、置き換え確認、キャンセル時の一時ファイル回収、保存したファイルの内容を確認",
  );
}
