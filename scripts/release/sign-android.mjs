import { readFile } from "node:fs/promises";
import path from "node:path";
import { output, command } from "./common.mjs";
import { localCache } from "../../verification/native/cache.mjs";
export async function signAndroid(apk, javaHome = process.env.JAVA_HOME) {
  const signing = "/root/.config/iori-release/android-signing";
  const credentials = JSON.parse(
    await readFile(path.join(signing, "credentials.json"), "utf8"),
  );
  const tools = path.join(localCache, "android/android-sdk/build-tools/36.0.0");
  await command(
    path.join(tools, "apksigner"),
    [
      "sign",
      "--v4-signing-enabled",
      "false",
      "--ks",
      path.join(signing, "iori-release.keystore"),
      "--ks-key-alias",
      credentials.alias,
      "--ks-pass",
      "env:IORI_APK_STORE_PASSWORD",
      "--key-pass",
      "env:IORI_APK_KEY_PASSWORD",
      "--out",
      path.join(output, "iori-android-arm64.apk"),
      apk,
    ],
    {
      env: {
        ...process.env,
        ...(javaHome
          ? {
              JAVA_HOME: javaHome,
              PATH:
                path.join(javaHome, "bin") + path.delimiter + process.env.PATH,
            }
          : {}),
        IORI_APK_STORE_PASSWORD: credentials.storePassword,
        IORI_APK_KEY_PASSWORD: credentials.keyPassword,
      },
    },
  );
}
if (process.argv[1] === import.meta.filename) {
  await signAndroid(path.resolve(process.argv[2]));
}
