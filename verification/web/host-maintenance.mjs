import { openSidebar } from "../../e2e/connection/scenario.mjs";
import assert from "node:assert/strict";
import { readFile, stat, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  observed,
  clearObserved,
  typeTerminal,
  requestClose,
} from "../../e2e/terminal/scenario.mjs";
import { boundTerminalDaemon } from "../terminal/daemon-process.mjs";
import { waitFor } from "../ui.mjs";
const run = promisify(execFile);

export async function hostMaintenanceScenario({
  client,
  fixture,
  updates,
  hostRoot,
  unit,
  record,
  shot,
  mobile,
  desktop,
  terminalId,
  cliId,
  pulseState,
  terminalBefore,
  cliBefore,
}) {
  const screen = client.screen;
  const database = new DatabaseSync(join(hostRoot, "host.sqlite"));
  database.exec(
    "CREATE TABLE update_probe(value TEXT);INSERT INTO update_probe VALUES('before-update')",
  );
  database.close();
  const settings = '[data-iori-action="settings-open"]';
  await screen.wait(settings + ' [data-iori-state="update-available"]');
  const hostSettings = '[data-iori-action="host-settings-open"]';
  await screen.wait(hostSettings + ' [data-iori-state="update-available"]');
  const hostKey = await screen.attribute(hostSettings, "data-iori-host-key");
  await screen.click(hostSettings);
  assert.equal(
    await screen.attribute(
      '[data-iori-action="settings-host-select"]',
      "data-iori-host-key",
    ),
    hostKey,
  );
  await screen.wait('[data-iori-action="host-update"]');
  await screen.wait(
    '[data-iori-action="settings-host-select"] [data-iori-state="update-available"]',
  );
  await screen.click('[data-iori-action="settings-host-select"]');
  await screen.wait('[role="option"] [data-iori-state="update-available"]');
  await screen.key("Escape");
  await screen.wait(
    '[data-iori-action="open-host-version"] [data-iori-state="update-available"]',
  );
  await screen.click('[data-iori-action="settings-general"]');
  updates.publish();
  await screen.click('[data-iori-action="update-check"]');
  await screen.wait(
    '[data-iori-action="settings-general"] [data-iori-state="update-available"]',
  );
  await screen.click('[data-iori-action="open-host-version"]');
  await shot("pc-host-version");
  await mobile();
  await screen.wait('[data-iori-action="host-update"]');
  await shot("mobile-host-version");
  await screen.click('[data-iori-action="settings-close"]');
  await openSidebar(screen);
  await screen.wait(hostSettings + ' [data-iori-state="update-available"]');
  await shot("mobile-host-update-drawer");
  await screen.click(hostSettings);
  await screen.wait('[data-iori-action="host-update"]');
  assert.equal(
    await screen.attribute(
      '[data-iori-action="settings-host-select"]',
      "data-iori-host-key",
    ),
    hostKey,
  );
  await desktop();
  record("host-update-marks", {
    settings: true,
    hostRow: true,
    selector: true,
    hostName: true,
    version: true,
    general: true,
  });
  async function continuity(label) {
    await screen.click('[data-iori-action="settings-close"]');
    await clearObserved(client);
    for (const [name, id, before] of [
      ["cli", cliId, cliBefore],
      ["terminal", terminalId, terminalBefore],
    ]) {
      await screen.click(`[data-iori-tab-id="terminal:${id}"]`);
      await screen.wait(
        `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
      );
      const after = await waitFor(
        () => pulseState(name),
        (value) => value?.count > before.count,
      );
      assert.equal(after.pid, before.pid);
      await observed(client, after.marker);
      record(label + "-" + name, { pidContinued: true, outputContinued: true });
    }
    await screen.click(settings);
    await screen.click('[data-iori-action="open-host-version"]');
  }
  async function update(expected) {
    await screen.click('[data-iori-action="host-update"]');
    await screen.wait('[data-iori-view="host-maintenance-confirmation"]');
    await maintenancePictures(client, shot, `continuing-update-${expected}`);
    assert.equal(
      await screen.evaluate(
        `document.querySelector('[data-iori-view="host-maintenance-confirmation"]').querySelector('.text-destructive')===null`,
      ),
      true,
    );
    await screen.click('[data-iori-action="host-maintenance-confirm"]');
    await screen.wait(`[data-iori-state="host-${expected}"]`);
  }
  // Failure first leaves the older Host eligible for the successful update to
  // the same Client version. Both attempts use real signed distributions.
  record("linux-systemd-update-attempt", { number: 1, expected: "rollback" });
  await update("failed");
  await screen.wait('[data-iori-state="host-maintenance-error"]');
  assert.equal(
    await readFile(join(hostRoot, "failed-version-ran"), "utf8"),
    "yes",
  );
  const restored = new DatabaseSync(join(hostRoot, "host.sqlite"), {
    readOnly: true,
  });
  assert.equal(
    restored.prepare("SELECT value FROM update_probe").get().value,
    "before-update",
  );
  restored.close();
  assert.equal(
    await screen.text('[data-iori-value="host-version"]'),
    fixture.previous,
  );
  record("rollback", {
    failedVersionRan: true,
    databaseRestored: true,
    versionRestored: true,
  });
  await continuity("rollback");
  const retainedFile = join(hostRoot, "maintenance/previous-update.txt");
  const previousWork = await waitFor(
    () => readFile(retainedFile, "utf8").catch(() => undefined),
    Boolean,
  );
  fixture.publishGood();
  record("linux-systemd-update-attempt", { number: 2, expected: "success" });
  await update("succeeded");
  assert.equal(
    await screen.text('[data-iori-value="host-version"]'),
    fixture.version,
  );
  await continuity("update");
  await screen.click('[data-iori-action="settings-close"]');
  assert.equal(
    await screen.visible(
      hostSettings + ' [data-iori-state="update-available"]',
    ),
    false,
    "HostがClientと同じバージョンになると行の更新点が消える",
  );
  await screen.click(hostSettings);
  await screen.click('[data-iori-action="open-host-version"]');
  const currentWork = await waitFor(
    () => readFile(retainedFile, "utf8").catch(() => undefined),
    (value) => value && value !== previousWork,
  );
  assert.equal(
    await stat(previousWork).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.equal((await stat(join(currentWork, "previous"))).isDirectory(), true);
  assert.equal(
    (await stat(join(currentWork, "database/host.sqlite"))).isFile(),
    true,
  );
  record("update-backups", { previousRemoved: true, currentRetained: true });
  await screen.click('[data-iori-action="host-restart"]');
  await screen.wait('[data-iori-view="host-maintenance-confirmation"]');
  await shot("restart-confirmation");
  await screen.click('[data-iori-action="host-maintenance-confirm"]');
  await screen.wait('[data-iori-state="host-succeeded"]');
  await continuity("restart");
  const restart = (
    await run("systemctl", [
      "--user",
      "show",
      unit,
      "--property=Restart",
      "--value",
    ])
  ).stdout.trim();
  assert.equal(restart, "on-failure");
  record("service-restart-policy", { restored: true });
  await screen.click('[data-iori-action="settings-close"]');
}

/** A live idle CLI and an input-ready shell are not interrupted work. */
export async function hostMaintenancePreview({
  client,
  hostRoot,
  terminalId,
  cliId,
  worktree,
  record,
  shot,
}) {
  const { screen } = client;
  const japanese = await screen.evaluate(
    "document.documentElement.lang.startsWith('ja')",
  );
  const text = (english, ja) => (japanese ? ja : english);
  // Temporarily hide this owned daemon's descriptor to take the existing cold
  // restart confirmation path, without stopping either of its live PTYs.
  const descriptor = join(hostRoot, "terminal-daemon/connection.json");
  const hidden = descriptor + ".preview";
  await rename(descriptor, hidden);
  try {
    await screen.click('[data-iori-action="settings-open"]');
    await screen.click('[data-iori-action="open-host-version"]');
    await screen.click('[data-iori-action="host-restart"]');
    await screen.wait('[data-iori-view="host-maintenance-confirmation"]');
    const idle = await screen.evaluate(`(() => {
      const dialog = document.querySelector('[data-iori-view="host-maintenance-confirmation"]');
      return {targets: dialog.querySelectorAll('li,[data-iori-maintenance-work]').length,
        summary: dialog.querySelector('[data-slot="dialog-description"]')?.textContent,
        stop: dialog.querySelector('[data-iori-maintenance-open]')?.textContent,
        work: Boolean(dialog.querySelector('[data-iori-maintenance-working]')),
        action: dialog.querySelector('[data-iori-action="host-maintenance-confirm"]').textContent};
    })()`);
    await shot("idle-restart-confirmation");
    assert.equal(
      idle.targets,
      0,
      "待機中CLIと入力待ちTerminalは中断される作業に並べない",
    );
    assert.equal(idle.work, false);
    assert.ok(
      idle.summary?.endsWith(text(" will be restarted.", "を再起動します。")),
    );
    assert.equal(
      idle.stop,
      text(
        "All open CLIs and Terminals will stop. CLI conversations can be resumed later.",
        "開いているCLIとTerminalはすべて止まります。CLIの会話は後で再開できます。",
      ),
    );
    assert.equal(idle.action, text("Restart", "再起動する"));
    record("idle-restart-confirmation", {
      idleCli: cliId,
      idleTerminal: terminalId,
      ...idle,
    });
    await maintenancePictures(client, shot, "idle-restart");
    await screen.key("Escape");
    await screen.click('[data-iori-action="settings-close"]');
    await screen.click(`[data-iori-tab-id="terminal:${terminalId}"]`);
    await typeTerminal(
      client,
      `node -e 'process.title="fake run --secret=x"; require("fs").writeFileSync("maintenance-fake.pid", String(process.pid)); console.log("TITLE_"+"READY"); setTimeout(()=>{},6e5)'; printf 'TITLE_%s\\n' DONE\r`,
    );
    await observed(client, "TITLE_READY");
    await requestClose(client, terminalId);
    await screen.wait('[data-iori-dialog="terminal-close-confirmation"]');
    assert.equal(
      await screen.text(
        '[data-iori-dialog="terminal-close-confirmation"] [data-slot="dialog-title"]',
      ),
      text("fake is running", "fakeを実行中です"),
    );
    await screen.click('[data-iori-action="terminal-cancel-close"]');
    process.kill(
      Number(await readFile(join(worktree, "maintenance-fake.pid"), "utf8")),
      "SIGTERM",
    );
    await observed(client, "TITLE_DONE");
    await typeTerminal(
      client,
      "printf 'MAINTENANCE_BUSY\\n'; sh -c 'echo $$ > maintenance-sleep.pid; exec sleep 600'; printf done > maintenance-sleep.done\r",
    );
    await observed(client, "MAINTENANCE_BUSY");
    await requestClose(client, terminalId);
    await screen.wait('[data-iori-dialog="terminal-close-confirmation"]');
    assert.equal(
      await screen.text(
        '[data-iori-dialog="terminal-close-confirmation"] [data-slot="dialog-title"]',
      ),
      text("sleep is running", "sleepを実行中です"),
    );
    await screen.click('[data-iori-action="terminal-cancel-close"]');
    await screen.click('[data-iori-action="settings-open"]');
    await screen.click('[data-iori-action="open-host-version"]');
    await screen.click('[data-iori-action="host-restart"]');
    await screen.wait("[data-iori-maintenance-working]");
    const busy = await screen.evaluate(`(() => {
      const dialog = document.querySelector('[data-iori-view="host-maintenance-confirmation"]');
      return {ids: [...dialog.querySelectorAll('[data-iori-maintenance-work]')].map(row => row.getAttribute('data-iori-maintenance-work')),
        state: dialog.querySelector('[data-iori-maintenance-work-state]')?.textContent,
        action: dialog.querySelector('[data-iori-action="host-maintenance-confirm"]').textContent};
    })()`);
    assert.deepEqual(busy.ids, [terminalId]);
    assert.ok(busy.state.includes("sleep"));
    assert.ok(busy.state.includes(text("Running", "実行中")));
    assert.equal(busy.action, text("Stop and restart", "止めて再起動する"));
    await maintenancePictures(client, shot, "working-restart");
    await screen.key("Enter");
    await waitFor(
      () => screen.visible('[data-iori-view="host-maintenance-confirmation"]'),
      (visible) => !visible,
    );
    assert.equal(
      await screen.visible('[data-iori-action="host-restart"]'),
      true,
      "Enterはキャンセルし、対象のTerminalへ移動しない",
    );
    record("confirmation-enter-cancels", { settingsRemainOpen: true });
    await screen.click('[data-iori-action="host-restart"]');
    await screen.wait("[data-iori-maintenance-working]");
    await screen.click(`[data-iori-maintenance-work="${terminalId}"]`);
    await screen.wait(
      `[data-iori-terminal-id="${terminalId}"][data-iori-displayed="true"]`,
    );
    assert.equal(
      await screen.visible('[data-iori-view="host-maintenance-confirmation"]'),
      false,
    );
    record("working-restart-confirmation", { ...busy, openedTerminal: true });
    await screen.click('[data-iori-action="settings-open"]');
    await screen.click('[data-iori-action="open-host-version"]');
    await screen.click('[data-iori-action="host-uninstall"]');
    await screen.wait("[data-iori-maintenance-working]");
    assert.match(
      await screen.text('[data-iori-view="host-maintenance-confirmation"]'),
      /All devices using this Host|すべての端末から接続できなくなります/u,
    );
    assert.equal(
      await screen.text('[data-iori-action="host-maintenance-confirm"]'),
      text("Stop and uninstall", "止めてアンインストールする"),
    );
    await maintenancePictures(client, shot, "working-uninstall");
    await screen.click('[data-iori-field="host-uninstall-data"]');
    await maintenancePictures(client, shot, "working-uninstall-delete-data", {
      devices: [
        ["pc", 1440, 1000],
        ["mobile", 390, 844],
      ],
      themes: ["light"],
    });
    await screen.key("Escape");
    await screen.click('[data-iori-action="host-restart"]');
    await screen.wait("[data-iori-maintenance-working]");
    // End only the sleep started by this scenario while its confirmation stays
    // open, as a foreground command can finish while the user is reading it.
    process.kill(
      Number(await readFile(join(worktree, "maintenance-sleep.pid"), "utf8")),
      "SIGTERM",
    );
    await waitFor(() =>
      readFile(join(worktree, "maintenance-sleep.done"), "utf8").catch(
        () => undefined,
      ),
    );
    await screen.click('[data-iori-action="host-maintenance-confirm"]');
    await screen.wait('[data-iori-state="host-succeeded"]');
    await boundTerminalDaemon(hostRoot);
    assert.equal(
      await screen.visible('[data-iori-view="host-maintenance-confirmation"]'),
      false,
    );
    record("completed-work-restarts-without-reconfirmation", {
      restarted: true,
    });
    await screen.click('[data-iori-action="settings-close"]');
  } finally {
    // A real cold restart has written a new descriptor. Keep it for the
    // existing cleanup, which owns and collects both the old and new daemons.
    if (
      await stat(descriptor).then(
        () => true,
        () => false,
      )
    )
      await rm(hidden);
    else await rename(hidden, descriptor);
  }
}

// Same viewport and theme capture as the existing uninstall pictures.
async function maintenancePictures(
  client,
  shot,
  name,
  {
    devices = [
      ["pc", 1440, 1000],
      ["wqhd", 2560, 1440],
      ["mobile", 390, 844],
    ],
    themes = ["dark", "light"],
  } = {},
) {
  if (process.env.IORI_MAINTENANCE_CAPTURE !== "1") return;
  const { screen } = client;
  const dark = await screen.evaluate(
    "document.documentElement.classList.contains('dark')",
  );
  for (const [device, width, height] of devices) {
    await client.browser.viewport({ width, height });
    for (const theme of themes) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await shot(`maintenance-${device}-${name}-${theme}`);
    }
  }
  await client.browser.viewport({ width: 1440, height: 1000 });
  await screen.evaluate(
    `document.documentElement.classList.toggle('dark', ${dark})`,
  );
}

/** The confirmation also stays concise before any CLI or Terminal is opened. */
export async function hostMaintenanceEmpty({ client, hostRoot, shot }) {
  const { screen } = client;
  const descriptor = join(hostRoot, "terminal-daemon/connection.json");
  const hidden = descriptor + ".preview";
  await rename(descriptor, hidden);
  try {
    await screen.click('[data-iori-action="settings-open"]');
    await screen.click('[data-iori-action="open-host-version"]');
    await screen.click('[data-iori-action="host-restart"]');
    await screen.wait('[data-iori-view="host-maintenance-confirmation"]');
    await maintenancePictures(client, shot, "empty-restart", {
      devices: [["pc", 1440, 1000]],
      themes: ["light"],
    });
    await screen.key("Escape");
    await screen.click('[data-iori-action="settings-close"]');
  } finally {
    await rename(hidden, descriptor);
  }
}
