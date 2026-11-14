import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { adb, gate } from "./remote.mjs";
import { openAndroidLauncherApp } from "./android-launcher.mjs";
import { androidClientTextVisible } from "./android-system-ui.mjs";
import { cleanupFolders } from "../connection/cleanup.mjs";
import { waitFor } from "../ui.mjs";

// While releases go to Forgejo (development), the release build skips this
// stage with a warning when the verification device is unavailable or locked;
// any other failure still stops the publication.
export class AndroidDeviceUnavailableError extends Error {
  constructor(reason, options) {
    // adb prints several lines; keep the release log and the signed record readable.
    const detail = String(reason).replace(/\s+/gu, " ").trim();
    super(
      "Android の検証端末につながらない、または検証端末を確認できません。Owner に端末の状態（電源、画面のロック、ワイヤレスデバッグ、ペア）を確かめてもらってください。" +
        ` 原因: ${detail}`,
      options,
    );
    this.name = "AndroidDeviceUnavailableError";
    this.reason = detail;
  }
}

export function checkAndroidReleaseDevice(packageName) {
  try {
    gate({ devices: ["android"], requireFreePorts: false });
  } catch (error) {
    throw new AndroidDeviceUnavailableError(error.message, { cause: error });
  }
  if (/isKeyguardShowing=true/u.test(adb(["shell", "dumpsys", "window"])))
    throw new AndroidDeviceUnavailableError(
      "検証端末の画面がロックされています",
    );
  if (
    adb(["shell", "pm", "list", "packages", packageName])
      .split(/\r?\n/u)
      .includes("package:" + packageName)
  )
    throw new Error(
      `検証端末に ${packageName} が既にあります。この受入が導入したアプリではないため、上書き・削除せず停止します。`,
    );
}

// Release WebViews do not expose CDP. Observe the actual foreground screen
// through Android accessibility, using the same launcher as a user.
export async function acceptAndroidRelease({
  apk,
  packageName,
  appLabel,
  evidence,
}) {
  await mkdir(evidence, { recursive: true });
  const result = {
    apk,
    scope: "fresh",
    passed: false,
    steps: [],
    cleanupErrors: [],
  };
  let owned = false;
  try {
    checkAndroidReleaseDevice(packageName);
    owned = true;
    {
      const stage = "fresh";
      result.stage = stage;
      adb(["install", "-r", apk]);
      const since = adb(["shell", "date", "+'%m-%d %H:%M:%S.000'"]);
      const crash = () => {
        const logs = adb(["logcat", "-d", "-b", "crash", "-T", since]);
        const marker = `Process: ${packageName}, PID: `;
        const line = logs.split(/\r?\n/u).find((line) => line.includes(marker));
        if (!line) return undefined;
        const pid = line.split(marker)[1].match(/^\d+/u)?.[0];
        return pid
          ? adb(["logcat", "-d", "-b", "crash", "--pid=" + pid, "-T", since])
          : line;
      };
      const checkCrash = async () => {
        const log = crash();
        if (log) {
          await writeFile(path.join(evidence, `${stage}-crash.log`), log);
          throw new Error(
            `Android APK が起動時に落ちました（${stage}）。${log}`,
          );
        }
      };
      adb(["shell", "cmd", "statusbar", "collapse"]);
      await openAndroidLauncherApp(appLabel);
      await waitFor(async () => {
        await checkCrash();
        return androidClientTextVisible(packageName, [
          "Connect to a Host",
          "Hostに接続する",
        ]);
      });
      await checkCrash();
      await writeFile(
        path.join(evidence, `${stage}.png`),
        adb(["exec-out", "screencap", "-p"], { encoding: null }),
      );
      result.steps.push(`${stage}: 配布用 APK が起動し、Host の登録画面を表示`);
    }
    result.passed = true;
  } catch (error) {
    result.error = error.message;
    throw error;
  } finally {
    if (owned) {
      try {
        result.cleanup = cleanupFolders({ androidPackage: packageName });
      } catch (error) {
        result.passed = false;
        result.cleanupErrors.push(error.message);
      }
    }
    await writeFile(
      path.join(evidence, "result.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    if (result.cleanupErrors.length)
      throw new Error(
        `Android APK の片付けに失敗: ${result.cleanupErrors.join("; ")}`,
      );
  }
}
