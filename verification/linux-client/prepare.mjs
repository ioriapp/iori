import { local as verificationLocal } from "../native/local.mjs";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { lockEntry } from "../native/locks.mjs";
import { gate, linux, sh } from "../native/remote.mjs";
import { command } from "../connection/build.mjs";
import { linuxClientImage } from "../../scripts/release/linux-client.mjs";

await lockEntry(import.meta.url);
gate({ devices: [verificationLocal.linux.host], requireFreePorts: false });
// System tools only. All test processes, the DBus session and keyring belong to
// the existing verification user and live in each runner's dedicated directory.
await command("ssh", [
  verificationLocal.linux.host,
  "sudo apt-get update && sudo apt-get install -y xvfb xauth webkit2gtk-driver gnome-keyring dbus-x11 pkexec python3-gi gir1.2-gtk-3.0",
]);
const tools = path.resolve(".local/linux-client-tools");
await command("cargo", [
  "install",
  "tauri-driver",
  "--version",
  "2.0.6",
  "--locked",
  "--root",
  tools,
]);
linux("sudo -u iori-dev -H mkdir -p /home/iori-dev/.local/iori-cache/bin");
await command("scp", [
  path.join(tools, "bin/tauri-driver"),
  verificationLocal.linux.host + ":/tmp/iori-verification-tauri-driver",
]);
linux(
  `sudo install -o iori-dev -g iori-dev -m 755 /tmp/iori-verification-tauri-driver ${sh("/home/iori-dev/.local/iori-cache/bin/tauri-driver")} && rm /tmp/iori-verification-tauri-driver`,
);

// AppImage bundles Ubuntu's WebKit. Its automation protocol must use the
// matching WebDriver, while deb uses the verification machine's WebKit.
const image = await linuxClientImage();
const driverRoot = path.join(tools, "appimage-driver");
await mkdir(path.join(driverRoot, "lib"), { recursive: true });
const container = "iori-webdriver-export-" + process.pid;
try {
  await command("docker", ["create", "--name", container, image]);
  await command("docker", [
    "cp",
    container + ":/usr/bin/WebKitWebDriver",
    path.join(driverRoot, "WebKitWebDriver"),
  ]);
  for (const name of ["libicui18n.so.70", "libicuuc.so.70", "libicudata.so.70"])
    await command("docker", [
      "cp",
      "-L",
      container + ":/usr/lib/x86_64-linux-gnu/" + name,
      path.join(driverRoot, "lib", name),
    ]);
} finally {
  await command("docker", ["rm", "-f", container]);
}
const archive = path.join(tools, "appimage-driver.tar.gz");
await command("tar", ["-czf", archive, "-C", driverRoot, "."]);
await command("scp", [
  archive,
  verificationLocal.linux.host + ":/tmp/iori-appimage-driver.tar.gz",
]);
const remoteDriver = "/home/iori-dev/.local/iori-cache/appimage-driver";
linux(
  `sudo -u iori-dev -H mkdir -p ${sh(remoteDriver)} && sudo -u iori-dev -H tar -xzf /tmp/iori-appimage-driver.tar.gz -C ${sh(remoteDriver)} && rm /tmp/iori-appimage-driver.tar.gz`,
);
const wrapper = path.join(tools, "WebKitWebDriver-appimage");
await writeFile(
  wrapper,
  `#!/bin/sh\nexport LD_LIBRARY_PATH=${sh(remoteDriver + "/lib")}:"\${LD_LIBRARY_PATH:-}"\nexec ${sh(remoteDriver + "/WebKitWebDriver")} "$@"\n`,
);
await command("scp", [
  wrapper,
  verificationLocal.linux.host + ":/tmp/iori-webdriver-appimage",
]);
linux(
  "sudo install -o iori-dev -g iori-dev -m 755 /tmp/iori-webdriver-appimage /home/iori-dev/.local/iori-cache/bin/WebKitWebDriver-appimage && rm /tmp/iori-webdriver-appimage",
);
