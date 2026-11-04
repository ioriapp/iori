import { local as verificationLocal } from "./native/local.mjs";
import { rm, glob } from "node:fs/promises";
import { command } from "./connection/build.mjs";
import path from "node:path";
import { lockEntry, heldDevices } from "./native/locks.mjs";
import { localCache, linuxCache, windowsCache } from "./native/cache.mjs";
import { gate, linux, windows, ps, sh } from "./native/remote.mjs";

await lockEntry(import.meta.url);
gate({
  requireFreePorts: false,
  devices: heldDevices().filter((device) => device !== "android"),
});
for (const device of heldDevices()) {
  if (device === verificationLocal.windows.host)
    windows(
      `if(Test-Path -LiteralPath ${ps(windowsCache)}){cmd.exe /c ${ps('rd /s /q "\\\\?\\' + windowsCache + '"')};if(Test-Path -LiteralPath ${ps(windowsCache)}){throw 'Windows cache remains'}}`,
    );
  if (device === verificationLocal.linux.host) {
    linux(`sudo -u iori-dev -H rm -rf -- ${sh(linuxCache)}`);
    await rm(path.join(localCache, "linux-host"), {
      recursive: true,
      force: true,
    });
  }
  if (device === "android") {
    const androidRoot = path.join(localCache, "android");
    const gradleHome = path.join(androidRoot, "gradle-home");
    for await (const gradle of glob("wrapper/dists/*/*/*/bin/gradle", {
      cwd: gradleHome,
    }))
      await command(path.join(gradleHome, gradle), ["--stop"], {
        env: {
          ...process.env,
          JAVA_HOME: "/root/projects/iori/.local/android-tools/jdk-21.0.12.1+1",
          GRADLE_USER_HOME: gradleHome,
          JAVA_TOOL_OPTIONS: `-Duser.home=${path.join(androidRoot, "java-home")} -Djava.util.prefs.userRoot=${path.join(androidRoot, "java-prefs")}`,
        },
      });
    await rm(androidRoot, { recursive: true, force: true });
  }
  console.log(device + ": verification cache removed");
}
