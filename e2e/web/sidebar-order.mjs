import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { waitFor } from "../../verification/ui.mjs";
import { openFolder, selectWorktree } from "../workspace/scenario.mjs";
import { create } from "../terminal/scenario.mjs";
import {
  closeSidebar,
  openSidebar,
  register,
} from "../connection/scenario.mjs";

const row = (path) => `[data-sidebar-sort-id=${JSON.stringify(path)}]`;
const button = (path) =>
  `${row(path)} .nav-repository-button, ${row(path)} > [data-state] > .nav-worktree-row .nav-worktree-button`;
const order = (screen) =>
  screen.evaluate(
    `Array.from(document.querySelectorAll('.nav-repository[data-sidebar-sort-id],.nav-worktree[data-sidebar-sort-id]')).map(e=>e.dataset.sidebarSortId)`,
  );
const matches = (screen, paths) =>
  waitFor(
    () => order(screen),
    (actual) => JSON.stringify(actual) === JSON.stringify(paths),
  );
export async function sidebarOrderScenario({
  client,
  repository,
  worktree,
  phone,
  desktop,
  restartHostLosingTerminals,
  additionalHost,
  createPlainFolder,
  reload,
  record,
  workflow,
}) {
  const screen = client.screen;
  const a = repository;
  if (workflow !== "sidebar-host-order") {
    const b = await createPlainFolder();
    const c =
      workflow === "sidebar-workspace-order"
        ? await createPlainFolder()
        : undefined;
    for (const path of [a, b, ...(c ? [c] : [])])
      await openFolder(screen, path, false);
    await matches(screen, c ? [a, b, c] : [a, b]);
    const worktreeButton = (path) =>
      `button[data-iori-worktree-path=${JSON.stringify(path)}]`;
    const worktreeGroup = (path) =>
      `.nav-worktree:has(${worktreeButton(path)})`;
    const worktreeToggle = `${worktreeGroup(worktree)} [data-iori-action="worktree-toggle"]`;
    if (workflow === "sidebar-worktree-state") {
      await selectWorktree(screen, worktree, false);
      const terminalId = await create(client);
      const terminalRow = `[data-iori-terminal-row=${JSON.stringify(terminalId)}]`;
      await screen.click(worktreeToggle);
      await waitFor(
        () => screen.attribute(worktreeToggle, "aria-expanded"),
        (v) => v === "false",
      );
      const gitDirectory = join(a, ".git");
      const unavailableGitDirectory = join(a, ".git-unavailable");
      await rename(gitDirectory, unavailableGitDirectory);
      try {
        await reload();
        await screen.wait(button(b));
        await waitFor(
          async () => !(await screen.visible(worktreeButton(worktree))),
        );
      } finally {
        await rename(unavailableGitDirectory, gitDirectory);
      }
      await reload();
      await screen.wait(worktreeToggle);
      assert.equal(
        await screen.attribute(worktreeToggle, "aria-expanded"),
        "false",
        "Gitを一時的に読めなくてもworktreeの閉じた状態を保持する",
      );
      await record("Gitを一時的に読めない間もworktreeの閉じた状態を保持する");
      await screen.click(button(a));
      const addedWorktree = join(await createPlainFolder(), "added-worktree");
      execFileSync(
        "git",
        ["-C", a, "worktree", "add", "-b", "sidebar-added", addedWorktree],
        { stdio: "pipe" },
      );
      // Wait for the new row through search while its repository stays saved closed.
      await screen.input(".nav-sidebar input", "sidebar-added");
      await screen.wait(worktreeButton(addedWorktree));
      await screen.input(".nav-sidebar input", "");
      await waitFor(
        () => screen.attribute(button(a), "aria-expanded"),
        (v) => v === "false",
      );
      await screen.click(button(a));
      await screen.wait(worktreeToggle);
      assert.equal(
        await screen.attribute(worktreeToggle, "aria-expanded"),
        "false",
      );
      assert.equal(await screen.visible(terminalRow), false);
      await screen.click(button(a));
      await screen.input(".nav-sidebar input", "browser");
      await screen.wait(terminalRow);
      assert.equal(
        await screen.attribute(worktreeToggle, "aria-expanded"),
        "true",
      );
      await screen.input(".nav-sidebar input", "");
      await waitFor(
        () => screen.attribute(button(a), "aria-expanded"),
        (v) => v === "false",
      );
      await screen.click(button(a));
      await screen.wait(worktreeToggle);
      assert.equal(
        await screen.attribute(worktreeToggle, "aria-expanded"),
        "false",
      );
      await screen.click(button(a));
      await record(
        "リポジトリ・worktreeの開閉をClient再読込後も保持し、閉じたリポジトリにも新しいworktreeが現れる。検索の一時展開後は元の開閉へ戻る",
      );
    } else {
      // Collapse only the repository so the pointer crosses complete, visible rows.
      await screen.click(button(a));
      await waitFor(
        async () =>
          !(await screen.visible(
            `button[data-iori-worktree-path=${JSON.stringify(a)}]`,
          )),
      );
      await screen.drag(button(c), button(a));
      await matches(screen, [c, a, b]);
      await reload();
      await matches(screen, [c, a, b]);
      assert.equal(await screen.attribute(button(a), "aria-expanded"), "false");
      await restartHostLosingTerminals();
      await reload();
      await matches(screen, [c, a, b]);
      await openFolder(screen, b, false);
      await matches(screen, [c, a, b]);
      await record(
        "PCのドラッグでワークスペース順を変更し、Client再読込・Host再起動・再度開く操作でも保持",
      );
      // Search must leave the underlying order unchanged even when rows are dragged.
      await screen.input(".nav-sidebar input", "folder-");
      await screen.drag(button(c), button(b));
      await screen.input(".nav-sidebar input", "");
      await matches(screen, [c, a, b]);
      const mobile = await phone();
      await mobile.browser.call("Emulation.setTouchEmulationEnabled", {
        enabled: true,
      });
      await mobile.screen.wait('[data-iori-view="workspace"]');
      await openFolder(mobile.screen, b, true);
      await openSidebar(mobile.screen);
      await matches(mobile.screen, [c, a, b]);
      await mobile.screen.longPressDrag(button(c), button(b), async () => {
        await mobile.screen.wait('[data-sidebar-sorting="true"]');
      });
      await matches(mobile.screen, [a, b, c]);
      await matches(screen, [a, b, c]);
      await mobile.screen.longPressDrag(button(c));
      await waitFor(
        () => mobile.screen.visible('[data-iori-action="sidebar-remove"]'),
        Boolean,
        undefined,
        "指を離した後の行メニュー",
      );
      await mobile.screen.key("Escape");
      await matches(mobile.screen, [a, b, c]);
      // Keep the swipe's start row fully visible without scrolling it into view.
      // Both pages share settings; start the collapse operation from an open row.
      if (
        (await mobile.screen.attribute(button(a), "aria-expanded")) === "false"
      )
        await mobile.screen.click(button(a));
      await mobile.screen.click(button(a));
      await waitFor(
        async () =>
          !(await mobile.screen.visible(
            `button[data-iori-worktree-path=${JSON.stringify(a)}]`,
          )),
      );
      // A short viewport gives the three workspaces real vertical scroll range.
      await mobile.browser.call("Emulation.setDeviceMetricsOverride", {
        width: 400,
        height: 320,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const viewport = '.navigation-scroll [data-slot="scroll-area-viewport"]';
      await closeSidebar(mobile.screen);
      await openSidebar(mobile.screen);
      await mobile.screen.scroll(viewport, { top: 0 });
      assert.equal(
        await mobile.screen.evaluate(`(()=>{
    const viewport=document.querySelector('${viewport}');
    const row=document.querySelector(${JSON.stringify(button(b))});
    const r=row.getBoundingClientRect(),v=viewport.getBoundingClientRect();
    return viewport.scrollTop===0&&r.top>=v.top&&r.bottom<=v.bottom;
  })()`),
        true,
        "スクロール前の行が見えており、helperによるスクロールは不要",
      );
      await mobile.screen.swipe(
        button(b),
        { x: 0.5, y: 0.9 },
        { x: 0.5, y: -4 },
      );
      await waitFor(
        () =>
          mobile.screen.evaluate(
            `document.querySelector('${viewport}').scrollTop`,
          ),
        (value) => value > 0,
        undefined,
        "ドロワーの行からの縦スクロール",
      );
      await matches(mobile.screen, [a, b, c]);
      assert.equal(
        await mobile.screen.visible('[data-sidebar-sorting="true"]'),
        false,
      );
      await mobile.browser.call("Emulation.setDeviceMetricsOverride", {
        width: 400,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await record(
        "スマホの長押しドラッグをPCへ共有、動かさず離すと既存メニュー、通常の指移動では並べ替えない",
      );
      await desktop();
      await matches(screen, [a, b, c]);
    }
  }
  if (workflow === "sidebar-host-order") {
    const invitation = await additionalHost();
    await register(screen, invitation, "追加Host用Chromium");
    await screen.key("Escape");
    const hosts = () =>
      screen.evaluate(
        `Array.from(document.querySelectorAll('.nav-host-title')).map(e=>e.dataset.ioriHostKey)`,
      );
    const keys = await waitFor(hosts, (v) => v.length === 2);
    for (const key of keys) {
      const selector = `.nav-host-title[data-iori-host-key=${JSON.stringify(key)}]`;
      if ((await screen.attribute(selector, "aria-expanded")) === "true")
        await screen.click(selector);
      await waitFor(
        async () =>
          !(await screen.visible(
            `${row(key)} [data-slot="collapsible-content"]`,
          )),
      );
    }
    const hostButton = (key) =>
      `.nav-host-title[data-iori-host-key=${JSON.stringify(key)}]`;
    await screen.drag(hostButton(keys[1]), hostButton(keys[0]));
    await waitFor(hosts, (v) => v[0] === keys[1]);
    await reload();
    await waitFor(hosts, (v) => v[0] === keys[1]);
    for (const key of keys)
      assert.equal(
        await screen.attribute(hostButton(key), "aria-expanded"),
        "false",
      );
    await record("独立した2Hostの順をドラッグで変更し、Client再読込後も保持");
  }
}
