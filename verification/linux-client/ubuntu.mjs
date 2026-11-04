import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { linuxClientImage } from "../../scripts/release/linux-client.mjs";
import { command, root } from "../../scripts/release/common.mjs";
import { WebDriver, ui, waitFor } from "../ui.mjs";

if (!process.argv.includes("--inside")) {
  const directory = path.resolve(process.argv[2]);
  const evidence = path.resolve(
    process.env.IORI_VERIFICATION_EVIDENCE_ROOT ??
      ".local/evidence/linux-client",
    "ubuntu-" + Date.now(),
  );
  await mkdir(evidence, { recursive: true });
  const image = await linuxClientImage();
  await command("docker", [
    "--config",
    "/tmp/iori-linux-client-docker",
    "run",
    "--rm",
    "--init",
    "--memory",
    "4g",
    "--cpus",
    "4",
    "-v",
    `${root}:/source:ro`,
    "-v",
    `${directory}:/artifacts:ro`,
    "-v",
    `${evidence}:/evidence`,
    image,
    "bash",
    "-ec",
    `
umask 077
export HOME=/tmp/iori-ubuntu XDG_DATA_HOME=/tmp/iori-ubuntu/data XDG_CONFIG_HOME=/tmp/iori-ubuntu/config XDG_CACHE_HOME=/tmp/iori-ubuntu/cache XDG_RUNTIME_DIR=/tmp/iori-ubuntu/runtime
mkdir -p "$HOME" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
exec dbus-run-session -- xvfb-run -a -s '-screen 0 1440x1000x24' bash -ec 'head -c 32 /dev/urandom | base64 | gnome-keyring-daemon --daemonize --components=secrets --unlock; exec node /source/verification/linux-client/ubuntu.mjs --inside'
`,
  ]);
  console.log(`Ubuntu 22.04 evidence: ${evidence}`);
} else {
  const result = { passed: false, phases: [] };
  let debExecutable;
  try {
    for (const format of ["deb", "AppImage"]) {
      await command("cp", [
        `/artifacts/iori-linux-x64.${format}`,
        `/tmp/iori-linux-x64.${format}`,
      ]);
      if (format === "deb") {
        await command("dpkg", ["-i", "/tmp/iori-linux-x64.deb"]);
        const packageName = execFileSync(
          "dpkg-deb",
          ["-f", "/tmp/iori-linux-x64.deb", "Package"],
          { encoding: "utf8" },
        ).trim();
        debExecutable = execFileSync("dpkg", ["-L", packageName], {
          encoding: "utf8",
        })
          .split("\n")
          .find((file) => file.startsWith("/usr/bin/"));
      } else await command("chmod", ["+x", "/tmp/iori-linux-x64.AppImage"]);
      const executable =
        format === "deb" ? debExecutable : "/tmp/iori-linux-x64.AppImage";
      const env = {
        ...process.env,
        TAURI_WEBVIEW_AUTOMATION: "true",
        WEBKIT_INSPECTOR_SERVER: "127.0.0.1:4447",
        WEBDRIVER_TARGET_ADDR: "127.0.0.1:4447",
        WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1",
        LIBGL_ALWAYS_SOFTWARE: "1",
        APPIMAGE_EXTRACT_AND_RUN: "1",
      };
      const app = spawn(executable, [], {
        env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let appLog = "";
      app.stdout.on("data", (data) => {
        appLog += data;
      });
      app.stderr.on("data", (data) => {
        appLog += data;
      });
      const driver = spawn(
        "WebKitWebDriver",
        ["--port=4445", "--host=127.0.0.1"],
        { env, stdio: "ignore" },
      );
      const driverClosed = new Promise((resolve) =>
        driver.once("close", resolve),
      );
      const appClosed = new Promise((resolve) => app.once("close", resolve));
      let browser;
      try {
        await waitFor(async () => {
          try {
            return (await fetch("http://127.0.0.1:4445/status")).ok;
          } catch {
            return false;
          }
        });
        const response = await fetch("http://127.0.0.1:4445/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            capabilities: {
              alwaysMatch: {
                "webkitgtk:browserOptions": { binary: executable },
              },
            },
          }),
        });
        const payload = await response.json();
        assert.equal(response.status, 200, JSON.stringify(payload));
        browser = new WebDriver(
          "http://127.0.0.1:4445",
          payload.value.sessionId,
        );
        const screen = ui(
          (expression) => browser.evaluate(expression),
          browser,
        );
        await screen.wait('[data-iori-view="first-run"]');
        await writeFile(
          `/evidence/${format}.png`,
          Buffer.from(await browser.screenshot(), "base64"),
        );
        result.phases.push(
          `${format}: first Host registration screen on Ubuntu 22.04`,
        );
      } finally {
        try {
          await browser?.close();
        } catch {
          /* Preserve original result. */
        }
        try {
          process.kill(-app.pid, "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
        driver.kill("SIGTERM");
        await Promise.all([appClosed, driverClosed]);
        await writeFile(`/evidence/${format}.log`, appLog);
      }
    }
    result.passed = true;
  } catch (error) {
    result.error = error.message;
    process.exitCode = 1;
  } finally {
    await writeFile("/evidence/result.json", JSON.stringify(result, null, 2));
  }
}
