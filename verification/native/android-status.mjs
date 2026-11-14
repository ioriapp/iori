import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkAndroidReleaseDevice } from "./android-release.mjs";
import { alreadyLocked, withDeviceLocks } from "./locks.mjs";
import { androidDevice } from "./remote.mjs";

const plan = [{ device: "android", shared: false }];
if (!alreadyLocked(plan)) {
  process.exit(
    await withDeviceLocks(plan, process.execPath, [
      fileURLToPath(import.meta.url),
    ]),
  );
}

try {
  const config = JSON.parse(
    await readFile(
      new URL("../../apps/client/src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  );
  checkAndroidReleaseDevice(config.identifier);
  console.log("Android の検証用の機器: 使える");
} catch (error) {
  const reason = String(error.message).replaceAll(androidDevice, "[接続先]");
  console.error(`Android の検証用の機器: 使えない（${reason}）`);
  process.exitCode = 1;
}
