import { _android } from "@playwright/test";
import console from "node:console";
import path from "node:path";
import process from "node:process";
import {
  verificationAndroidPackage,
  verificationIdentifier,
} from "../config.mjs";
import { adb, adbPath, androidDevice } from "../native/remote.mjs";
import { androidActivityResumed } from "../native/android-system-ui.mjs";
import { waitFor } from "../ui.mjs";

let tapPatched = false;
const touchFallbackPages = new WeakSet();

function installAndroidTapFallback(page) {
  touchFallbackPages.add(page);
  if (tapPatched) return;
  tapPatched = true;
  const proto = Object.getPrototypeOf(page.locator("body"));
  const originalTap = proto.tap;
  proto.tap = async function tap(options) {
    const targetPage = this.page();
    if (!touchFallbackPages.has(targetPage)) {
      return originalTap.call(this, options);
    }
    // Playwright's _android.webView() creates a BrowserContext with hasTouch=false
    // and exposes no option to enable it; preserve actionability checks via
    // trial click, then dispatch a CDP touch tap to the Android WebView.
    await this.click({ ...options, trial: true });
    await this.scrollIntoViewIfNeeded(options);
    const box = await this.boundingBox(options);
    if (!box) {
      throw new Error("tap target has no bounding box");
    }
    const x = options?.position
      ? box.x + options.position.x
      : box.x + box.width / 2;
    const y = options?.position
      ? box.y + options.position.y
      : box.y + box.height / 2;
    const session = await targetPage.context().newCDPSession(targetPage);
    try {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } finally {
      await session.detach();
    }
  };
}

function ensureAdbOnPath() {
  const adbDirectory = path.dirname(adbPath);
  const current = process.env.PATH ?? "";
  if (!current.split(path.delimiter).includes(adbDirectory)) {
    process.env.PATH = current
      ? `${adbDirectory}${path.delimiter}${current}`
      : adbDirectory;
  }
}

export async function startAndroidUiClient({
  pkg = process.env.IORI_UI_ANDROID_PACKAGE ?? verificationAndroidPackage,
  identifier = process.env.IORI_UI_ANDROID_IDENTIFIER ?? verificationIdentifier,
  apk = process.env.IORI_UI_ANDROID_APK,
  install = false,
} = {}) {
  ensureAdbOnPath();
  const mainActivity = `${pkg}/${identifier}.MainActivity`;

  adb(["shell", "cmd", "statusbar", "collapse"]);
  const installed = adb(["shell", "pm", "list", "packages", pkg]).includes(
    `package:${pkg}`,
  );
  if (install || !installed) {
    if (!apk) {
      throw new Error(
        `検証用APK (${pkg}) が導入されていません。IORI_UI_ANDROID_APK または --apk を指定してください`,
      );
    }
    adb(["install", "-r", apk]);
  }

  adb(["shell", "am", "force-stop", pkg]);
  adb(["shell", "pm", "clear", pkg]);
  try {
    adb(["shell", "pm", "grant", pkg, "android.permission.POST_NOTIFICATIONS"]);
  } catch {
    // Older Android releases do not define runtime POST_NOTIFICATIONS.
  }
  adb(["shell", "am", "start", "-n", mainActivity]);

  const devices = await _android.devices({ omitDriverInstall: true });
  const device = devices.find(
    (candidate) => candidate.serial() === androidDevice,
  );
  if (!device) {
    throw new Error("Playwright _android で Android 検証機を見つけられません");
  }

  try {
    const webView = await device.webView({ pkg });
    const page = await webView.page();
    installAndroidTapFallback(page);
    return {
      page,
      async back() {
        adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
      },
      async background() {
        if (androidActivityResumed([pkg])) {
          adb(["shell", "input", "keyevent", "KEYCODE_HOME"]);
          await waitFor(() => !androidActivityResumed([pkg]));
        }
      },
      async resume() {
        adb(["shell", "am", "start", "-n", mainActivity]);
        await waitFor(() => androidActivityResumed([pkg]));
      },
      async close() {
        touchFallbackPages.delete(page);
        await device.close().catch((error) => {
          console.error(`Android device close failed: ${String(error)}`);
        });
        adb(["shell", "am", "force-stop", pkg]);
      },
    };
  } catch (error) {
    await device.close().catch(() => {});
    adb(["shell", "am", "force-stop", pkg]);
    throw error;
  }
}
