import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { adb } from "./remote.mjs";
import {
  androidSystemControl,
  androidSystemControls,
  tapAndroidSystemControl,
  waitForAndroidForeground,
} from "./android-system-ui.mjs";
import { verificationAndroidPackage } from "../config.mjs";
import { waitFor } from "../ui.mjs";

// Chrome copies the screenshot through its real image menu. A new private tab
// keeps the fixture out of browsing history; only that tab is closed afterward.
export async function copyAndroidScreenshot(client, saveEvidence) {
  const png = adb(["exec-out", "screencap", "-p"], { encoding: null });
  await saveEvidence("source.png", png);
  const route = "/iori-clipboard-" + randomUUID();
  let imageRequested = false;
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.url === route + ".png") {
      imageRequested = true;
      response.writeHead(200, { "Content-Type": "image/png" });
      response.end(png);
    } else if (request.url === route) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>iori clipboard verification</title></head><body style="margin:0;display:grid;place-items:center;height:100vh"><img alt="iori clipboard screenshot" style="max-width:100vw;max-height:100vh" src="${route}.png"></body></html>`,
      );
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const chrome = ["com.android.chrome"];
  let reverse = false;
  let tab = false;
  try {
    adb(["reverse", "--no-rebind", `tcp:${port}`, `tcp:${port}`]);
    reverse = true;
    const launch = adb([
      "shell",
      "am",
      "start",
      "-a",
      "org.chromium.chrome.browser.incognito.OPEN_PRIVATE_TAB",
      "-n",
      "com.android.chrome/org.chromium.chrome.browser.incognito.IncognitoTabLauncher",
    ]);
    if (/Error(?: type|:)/u.test(launch))
      throw new Error("Chromeの検証用シークレットタブを開けませんでした");
    tab = true;
    const address = await androidSystemControl(
      chrome,
      (node) => node["resource-id"] === "com.android.chrome:id/url_bar",
    );
    tapAndroidSystemControl(address);
    adb(["shell", "input", "text", `http://127.0.0.1:${port}${route}`]);
    adb(["shell", "input", "keyevent", "KEYCODE_ENTER"]);
    await waitFor(() => imageRequested);
    const image = await androidSystemControl(
      chrome,
      (node) =>
        node["content-desc"] === "iori clipboard screenshot" ||
        node.text === "iori clipboard screenshot",
    );
    const [left, top, right, bottom] = image.bounds.match(/\d+/gu).map(Number);
    const x = String(Math.round((left + right) / 2));
    const y = String(Math.round((top + bottom) / 2));
    adb(["shell", "input", "swipe", x, y, x, y, "1000"]);
    const copy = await androidSystemControl(chrome, (node) =>
      /^(Copy image|画像をコピー|复制图片)$/u.test(node.text),
    );
    tapAndroidSystemControl(copy);
  } catch (error) {
    // Diagnostics are limited to this run's image page, never existing tabs.
    if (imageRequested) {
      await saveEvidence(
        "copy-failure.png",
        adb(["exec-out", "screencap", "-p"], { encoding: null }),
      );
      await saveEvidence(
        "copy-failure.json",
        JSON.stringify(androidSystemControls(chrome), null, 2),
      );
    }
    throw error;
  } finally {
    try {
      if (tab) adb(["shell", "input", "keycombination", "113", "51"]);
    } finally {
      if (reverse) adb(["reverse", "--remove", `tcp:${port}`]);
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      client.nativeForeground();
      await waitForAndroidForeground(verificationAndroidPackage);
    }
  }
}
