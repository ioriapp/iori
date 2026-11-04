import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { localCache } from "../../verification/native/cache.mjs";
import { collectAndroid } from "./android-collect.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evidence = await mkdtemp(path.join(tmpdir(), "iori-android-license-"));
const env = {
  ...process.env,
  IORI_VERIFICATION_CONFIG: "apps/client/src-tauri/tauri.conf.json",
  IORI_VERIFICATION_ANDROID_PROFILE: "release",
  IORI_VERIFICATION_EVIDENCE_ROOT: evidence,
};
let androidRoot;
function run(args, options = {}) {
  const result = spawnSync(
    process.execPath,
    ["scripts/run-bounded-check.mjs", "--memory-only", ...args],
    {
      cwd: root,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${args.join(" ")}: exit ${result.status}\n${result.stderr ?? ""}`,
    );
  return result.stdout;
}
try {
  run(
    [
      process.execPath,
      "verification/connection/build-android.mjs",
      "--refresh-android-notices",
    ],
    { stdio: "inherit" },
  );
  const state = JSON.parse(
    await readFile(path.join(evidence, "build-state.json"), "utf8"),
  );
  androidRoot = state.androidRoot;
  const gradleHome = path.join(localCache, "android/gradle-home");
  env.GRADLE_USER_HOME = gradleHome;
  env.JAVA_HOME = state.androidJavaHome;
  env.ANDROID_HOME = path.join(localCache, "android/android-sdk");
  env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
  const project = path.join(
    androidRoot,
    "source/apps/client/src-tauri/gen/android",
  );
  const report = run([
    path.join(project, "gradlew"),
    "-p",
    project,
    "--no-configuration-cache",
    "--console",
    "plain",
    ":app:dependencies",
    "--configuration",
    "universalReleaseRuntimeClasspath",
  ]);
  await collectAndroid(report, gradleHome);
} finally {
  if (!androidRoot) {
    try {
      androidRoot = JSON.parse(
        await readFile(path.join(evidence, "build-state.json"), "utf8"),
      ).androidRoot;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (androidRoot) await rm(androidRoot, { recursive: true, force: true });
  await rm(evidence, { recursive: true, force: true });
}
