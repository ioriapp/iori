import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { linux, sh, gate } from "../native/remote.mjs";
import { WebDriver, ui, waitFor } from "../ui.mjs";
import { command } from "../connection/build.mjs";

export const asUser = (script, user = "iori-dev") =>
  `sudo -u ${sh(user)} -H bash -c ${sh(script)}`;

// One isolated DBus/keyring, X server and systemd unit per Client. Restarted
// applications inherit this environment; WebDriver attaches without relaunching.
export async function startLinuxClient({
  root,
  executable,
  evidence,
  result = {},
  user = "iori-dev",
  isolated = true,
}) {
  gate({ devices: [verificationLocal.linux.host], requireFreePorts: false });
  const unit = "iori-linux-client-" + randomUUID();
  const uid = linux(`id -u ${sh(user)}`);
  const runAsUser = (script) => asUser(script, user);
  const session = (script) =>
    runAsUser(
      `XDG_RUNTIME_DIR=/run/user/${uid} DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus ${script}`,
    );
  // Unix sockets have a short pathname limit. Keep keyring/DBus runtime paths
  // under the OS runtime directory, independent of the build/source path.
  const runtime = `/run/user/${uid}` + (isolated ? "/" + unit : "");
  const remote = root + "/client";
  const bootstrap = `${remote}/start.sh`;
  linux(runAsUser(`mkdir -p ${sh(remote)}`));
  // Local Host setup needs the disposable account's real HOME and user bus so
  // install.sh and the systemd user manager see the same unit and control data.
  const home = isolated
    ? remote + "/home"
    : linux(runAsUser('printf %s "$HOME"'));
  const data = isolated ? remote + "/data" : home + "/.local/share";
  const config = isolated ? remote + "/config" : home + "/.config";
  const cache = isolated ? remote + "/cache" : home + "/.cache";
  const driver =
    user === "iori-dev"
      ? "/home/iori-dev/.local/iori-cache/bin/tauri-driver"
      : remote + "/tauri-driver";
  if (user !== "iori-dev")
    linux(
      `sudo install -o ${sh(user)} -g ${sh(user)} -m 700 /home/iori-dev/.local/iori-cache/bin/tauri-driver ${sh(driver)}`,
    );
  const script = `#!/bin/bash
set -e
umask 077
export HOME=${sh(home)}
export XDG_DATA_HOME=${sh(data)}
export XDG_CONFIG_HOME=${sh(config)}
export XDG_CACHE_HOME=${sh(cache)}
export XDG_RUNTIME_DIR=${sh(runtime)}
${isolated ? "" : `export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus`}
mkdir -p "$HOME" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
exec ${isolated ? "dbus-run-session -- " : ""}xvfb-run -a -s '-screen 0 1440x1000x24' bash -ec ${sh(`
printf 'export DISPLAY=%q\\nexport DBUS_SESSION_BUS_ADDRESS=%q\\nexport XAUTHORITY=%q\\n' "$DISPLAY" "$DBUS_SESSION_BUS_ADDRESS" "$XAUTHORITY" > ${sh(remote + "/display.sh")}
head -c 32 /dev/urandom | base64 | gnome-keyring-daemon --daemonize --components=secrets --unlock
export TAURI_WEBVIEW_AUTOMATION=true WEBKIT_INSPECTOR_SERVER=127.0.0.1:4447
export APPIMAGE_EXTRACT_AND_RUN=1 LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1
${sh(executable)} > ${sh(remote + "/app.log")} 2>&1 &
export WEBDRIVER_TARGET_ADDR=127.0.0.1:4447
exec ${sh(driver)} --port 4445 --native-port 4446 --native-driver ${sh(executable.endsWith(".AppImage") ? "/home/iori-dev/.local/iori-cache/bin/WebKitWebDriver-appimage" : "/usr/bin/WebKitWebDriver")} > ${sh(remote + "/driver.log")} 2>&1
`)}
`;
  const local = evidence + "/client-start.sh";
  await writeFile(local, script);
  await command("scp", [
    local,
    verificationLocal.linux.host + ":/tmp/" + unit + ".sh",
  ]);
  linux(
    `sudo install -o ${sh(user)} -g ${sh(user)} -m 700 ${sh("/tmp/" + unit + ".sh")} ${sh(bootstrap)} && rm ${sh("/tmp/" + unit + ".sh")}`,
  );
  linux(
    session(
      `systemd-run --user --unit=${sh(unit)} --collect -p MemoryMax=4G -p MemorySwapMax=0 ${sh(bootstrap)}`,
    ),
  );
  const tunnel = spawn(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-N",
      "-L",
      "127.0.0.1:14445:127.0.0.1:4445",
      verificationLocal.linux.host,
    ],
    { stdio: "ignore" },
  );
  const tunnelClosed = new Promise((resolve) => tunnel.once("close", resolve));
  let browser;
  let restarted = false;
  const screenshot = async (name) => {
    // WebKit's WebDriver screenshot can stall while the Xvfb window remains
    // responsive. Capture this Client's dedicated display without the driver.
    const target = remote + "/screenshot.png";
    const capture = `import gi
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk
window = Gdk.get_default_root_window()
Gdk.pixbuf_get_from_window(window, 0, 0, window.get_width(), window.get_height()).savev(${JSON.stringify(target)}, "png", [], [])`;
    linux(
      runAsUser(
        `source ${sh(remote + "/display.sh")}\npython3 -c ${sh(capture)}`,
      ),
    );
    await writeFile(
      evidence + "/" + name + ".png",
      Buffer.from(linux(runAsUser(`base64 -w 0 ${sh(target)}`)), "base64"),
    );
  };
  const connect = async () => {
    await waitFor(async () => {
      try {
        return (await fetch("http://127.0.0.1:14445/status")).ok;
      } catch {
        return false;
      }
    });
    // Tauri uses a custom scheme. WebKit's automatic navigation wait can
    // stall even after the document is ready; UI helpers observe real controls.
    browser = await WebDriver.create("http://127.0.0.1:14445", executable, {
      pageLoadStrategy: "none",
    });
    await waitFor(async () => {
      try {
        return await browser.evaluate(
          "document.readyState==='complete'&&Boolean(window.__TAURI_INTERNALS__)",
        );
      } catch {
        return false;
      }
    });
    const screen = ui((expression) => browser.evaluate(expression), browser);
    for (const name of ["click", "input", "key", "wait"]) {
      const operation = screen[name];
      screen[name] = async (...args) => {
        result.lastUiOperation = {
          name,
          target: args[0],
        };
        return operation(...args);
      };
    }
    return screen;
  };
  const stop = async () => {
    try {
      await browser?.close();
    } catch {
      /* App exit invalidates the old session. */
    }
    tunnel.kill("SIGTERM");
    await tunnelClosed;
    linux(
      session(
        `systemctl --user stop ${restarted ? sh(unit + "-restart") + " " : ""}${sh(unit)}`,
      ),
    );
    if (isolated) linux(runAsUser(`rm -rf ${sh(runtime)}`));
    await writeFile(
      evidence + "/app.log",
      linux(runAsUser(`cat ${sh(remote + "/app.log")}`)),
    );
    await writeFile(
      evidence + "/driver.log",
      linux(runAsUser(`cat ${sh(remote + "/driver.log")}`)),
    );
  };
  try {
    const screen = await connect();
    return {
      async restartWithoutRegistrationKey() {
        assert.equal(
          isolated,
          true,
          "key removal requires this run's isolated keyring",
        );
        const processes = await this.processes();
        assert.match(
          processes,
          /^\d+$/u,
          "one isolated Client process before restart",
        );
        linux(runAsUser(`kill -TERM ${processes}`));
        await waitFor(
          () => this.processes(),
          (processes) => processes === "",
        );
        const environmentScript = (script) => `
source ${sh(remote + "/display.sh")}
export HOME=${sh(home)} XDG_DATA_HOME=${sh(data)} XDG_CONFIG_HOME=${sh(config)} XDG_CACHE_HOME=${sh(cache)} XDG_RUNTIME_DIR=${sh(runtime)}
export TAURI_WEBVIEW_AUTOMATION=true WEBKIT_INSPECTOR_SERVER=127.0.0.1:4447
export APPIMAGE_EXTRACT_AND_RUN=1 LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1
${script}`;
        const runInSession = (script) => runAsUser(environmentScript(script));
        const found = linux(
          runInSession(
            `gdbus call --session --dest org.freedesktop.secrets --object-path /org/freedesktop/secrets --method org.freedesktop.Secret.Service.SearchItems ${sh("{'application': 'io.github.ioriapp.iori.linuxverification', 'purpose': 'client-keys'}")}`,
          ),
        );
        const items = [
          ...new Set(
            found.match(
              /\/org\/freedesktop\/secrets\/collection\/[A-Za-z0-9_/]+/gu,
            ) ?? [],
          ),
        ];
        assert.equal(items.length, 1, "registered Client has one keyring item");
        for (const item of items)
          linux(
            runInSession(
              `gdbus call --session --dest org.freedesktop.secrets --object-path ${sh(item)} --method org.freedesktop.Secret.Item.Delete`,
            ),
          );
        restarted = true;
        linux(
          session(
            `systemd-run --user --unit=${sh(unit + "-restart")} --collect -p MemoryMax=4G -p MemorySwapMax=0 bash -c ${sh(environmentScript(`${sh(executable)} > ${sh(remote + "/app.log")} 2>&1`))}`,
          ),
        );
        await this.reconnect();
      },
      get browser() {
        return browser;
      },
      screen,
      async launchAgain() {
        const before = await this.processes();
        assert.match(
          before,
          /^\d+$/u,
          "one Client process before second launch",
        );
        linux(
          runAsUser(`
source ${sh(remote + "/display.sh")}
export HOME=${sh(home)} XDG_DATA_HOME=${sh(data)} XDG_CONFIG_HOME=${sh(config)} XDG_CACHE_HOME=${sh(cache)} XDG_RUNTIME_DIR=${sh(runtime)}
${sh(executable)}`),
        );
        assert.equal(
          await this.processes(),
          before,
          "second launch exits and preserves the original process",
        );
      },
      async reconnect() {
        try {
          await browser.close();
        } catch {
          /* The old process has exited. */
        }
        this.screen = await connect();
      },
      screenshot,
      async processes() {
        return linux(
          runAsUser(`for proc in /proc/[0-9]*; do
  case "$(readlink "$proc/exe" 2>/dev/null)" in
    */iori-linux-verification|*'/iori-linux-verification (deleted)')
      if tr '\\0' '\\n' < "$proc/environ" 2>/dev/null | grep -Fxq ${sh("XDG_DATA_HOME=" + data)}; then basename "$proc"; fi;;
  esac
done`),
        );
      },
      stop,
    };
  } catch (error) {
    try {
      await screenshot("failure");
    } catch (captureError) {
      result.screenshotError = captureError.message;
    }
    await stop();
    throw error;
  }
}
