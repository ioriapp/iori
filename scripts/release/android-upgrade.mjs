import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { localCache } from "../../verification/native/cache.mjs";

const tools = path.join(localCache, "android/android-sdk/build-tools/36.0.0");

export async function checkAndroidUpgrade(
  previousApk,
  apk,
  evidence,
  javaHome = process.env.JAVA_HOME,
) {
  await mkdir(evidence, { recursive: true });
  const env = {
    ...process.env,
    ...(javaHome
      ? {
          JAVA_HOME: javaHome,
          PATH: path.join(javaHome, "bin") + path.delimiter + process.env.PATH,
        }
      : {}),
  };
  const result = { previousApk, apk, passed: false };
  try {
    function inspect(file) {
      const signature = execFileSync(
        path.join(tools, "apksigner"),
        ["verify", "--print-certs", file],
        { encoding: "utf8", env },
      );
      const certificates = [
        ...signature.matchAll(
          /^Signer #\d+ certificate SHA-256 digest: (\S+)$/gmu,
        ),
      ]
        .map((match) => match[1])
        .sort();
      const badging = execFileSync(
        path.join(tools, "aapt2"),
        ["dump", "badging", file],
        { encoding: "utf8", env },
      );
      const info = badging.match(
        /^package: name='([^']+)' versionCode='(\d+)'/mu,
      );
      if (!certificates.length || !info)
        throw new Error("APK の署名またはバージョン情報を読めません");
      return {
        certificates,
        applicationId: info[1],
        versionCode: Number(info[2]),
      };
    }
    result.previous = inspect(previousApk);
    result.current = inspect(apk);
    if (
      JSON.stringify(result.previous.certificates) !==
      JSON.stringify(result.current.certificates)
    )
      throw new Error("APK の署名の証明書が異なります");
    if (result.previous.applicationId !== result.current.applicationId)
      throw new Error("APK の applicationId が異なります");
    if (result.current.versionCode <= result.previous.versionCode)
      throw new Error("APK の versionCode が前の公開版より大きくありません");
    result.passed = true;
    console.log(
      `[release] Android APK 上書きの静的検査: ${result.previous.versionCode} → ${result.current.versionCode}、署名と applicationId が一致`,
    );
  } catch (error) {
    result.error = error.message;
    throw error;
  } finally {
    await writeFile(
      path.join(evidence, "upgrade.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
  }
}

if (process.argv[1] === import.meta.filename)
  await checkAndroidUpgrade(
    path.resolve(process.argv[2]),
    path.resolve(process.argv[3]),
    path.resolve(process.argv[4]),
  );
