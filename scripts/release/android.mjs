import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { root, output, command, releaseSource } from "./common.mjs";
import { lockEntry } from "../../verification/native/locks.mjs";
import { checkAndroidApkPlugins } from "../../verification/native/android-apk-check.mjs";
import { signAndroid } from "./sign-android.mjs";
import { checkAndroidUpgrade } from "./android-upgrade.mjs";
import { previousAndroidRelease } from "./acceptance.mjs";
await lockEntry(import.meta.url);
await mkdir(output, { recursive: true });
let failure;
const evidence = path.join(root, ".local/release-build/android");
try {
  await command(
    process.execPath,
    ["verification/connection/build-android.mjs"],
    {
      env: {
        ...process.env,
        IORI_RELEASE_BUILD: "1",
        IORI_VERIFICATION_CONFIG: "apps/client/src-tauri/tauri.conf.json",
        IORI_VERIFICATION_ANDROID_PROFILE: "release",
        IORI_VERIFICATION_EVIDENCE_ROOT: evidence,
      },
    },
  );
  const state = JSON.parse(
    await readFile(path.join(evidence, "build-state.json"), "utf8"),
  );
  await signAndroid(
    path.join(state.androidRoot, "client.apk"),
    state.androidJavaHome,
  );
  const staticEvidence =
    process.env.IORI_RELEASE_ANDROID_STATIC_EVIDENCE ??
    path.join(evidence, "static-apk-check");
  await mkdir(staticEvidence, { recursive: true });
  const previous = await previousAndroidRelease();
  if (previous) {
    const response = await fetch(
      `${releaseSource}/download/${encodeURIComponent(previous.tag_name)}/iori-android-arm64.apk`,
    );
    if (!response.ok)
      throw new Error(
        `前の Release の APK の取得に失敗: HTTP ${response.status}`,
      );
    const previousApk = path.join(state.androidRoot, "previous-release.apk");
    await writeFile(previousApk, Buffer.from(await response.arrayBuffer()));
    await checkAndroidUpgrade(
      previousApk,
      path.join(output, "iori-android-arm64.apk"),
      staticEvidence,
      state.androidJavaHome,
    );
  } else {
    await writeFile(
      path.join(staticEvidence, "upgrade.json"),
      JSON.stringify(
        { skipped: "前の公開版がないため上書きの確認を飛ばしました" },
        null,
        2,
      ) + "\n",
    );
    console.log("[release] 前の公開版がないため上書きの確認を飛ばしました");
  }
  // Check the distribution APK before the build scratch (and the Gradle
  // settings it generated) is removed.
  await checkAndroidApkPlugins({
    apk: path.join(output, "iori-android-arm64.apk"),
    sourceRoot: path.join(state.androidRoot, "source"),
    evidence: staticEvidence,
  });
} catch (error) {
  failure = error;
  throw error;
} finally {
  try {
    const state = JSON.parse(
      await readFile(path.join(evidence, "build-state.json"), "utf8"),
    );
    await rm(state.androidRoot, { recursive: true, force: true });
  } catch (error) {
    if (!failure && error.code !== "ENOENT") throw error;
    if (error.code !== "ENOENT")
      process.stderr.write(
        `Android buildの片付けに失敗しました: ${error.message}\n`,
      );
  }
}
