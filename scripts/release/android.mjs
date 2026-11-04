import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { root, output, command } from "./common.mjs";
import { lockEntry } from "../../verification/native/locks.mjs";
import { checkAndroidApkPlugins } from "../../verification/native/android-apk-check.mjs";
import { signAndroid } from "./sign-android.mjs";
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
  // Check the distribution APK before the build scratch (and the Gradle
  // settings it generated) is removed.
  await checkAndroidApkPlugins({
    apk: path.join(output, "iori-android-arm64.apk"),
    sourceRoot: path.join(state.androidRoot, "source"),
    evidence:
      process.env.IORI_RELEASE_ANDROID_STATIC_EVIDENCE ??
      path.join(evidence, "static-apk-check"),
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
