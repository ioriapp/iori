// --refresh-android-notices: prepare the Android project without copying the saved notices.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  configPath,
  verificationIdentifier,
  verificationAndroidPackage,
} from "../config.mjs";

import { lockEntry } from "../native/locks.mjs";
import { localCache } from "../native/cache.mjs";
import { copyAndroidNotice } from "../../scripts/licenses/android.mjs";
import {
  createSourceCopy as copySource,
  refreshSourceMtimes,
} from "../native/source.mjs";
await lockEntry(import.meta.url);
const release = process.env.IORI_VERIFICATION_ANDROID_PROFILE === "release";
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
import { evidence } from "./build.mjs";
await mkdir(evidence, { recursive: true });
const stateFile = path.join(evidence, "build-state.json");
let state;
try {
  state = JSON.parse(await readFile(stateFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  state = { id: `${Date.now()}-${process.pid}` };
}
const buildRoot =
  state.androidRoot ??
  path.join(repoRoot, `.local/verification-runs/android-${state.id}`);
state.androidRoot = buildRoot;
state.androidPackage = verificationAndroidPackage;
const sourceRoot = path.join(buildRoot, "source");
const cacheRoot = path.join(localCache, "android");
const sharedAndroidSdk = "/root/projects/iori/.local/android-sdk";
const androidSdk = path.join(cacheRoot, "android-sdk");
const androidCargo = "/root/projects/iori/.local/android-cargo";
const rustupHome = "/root/projects/iori/.local/android-rustup";
const javaHome = "/root/projects/iori/.local/android-tools/jdk-21.0.12.1+1";
state.androidJavaHome = javaHome;
await writeFile(stateFile, JSON.stringify(state, null, 2));
const scannerDependency =
  '    implementation("com.journeyapps:zxing-android-embedded:4.3.0")';

function fail(message) {
  throw new Error(message);
}

async function run(command, args, options = {}) {
  process.stdout.write(`> ${command} ${args.join(" ")}\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal ?? code})`));
    });
  });
}

async function resolveClientVersion() {
  const configFile = path.join(
    sourceRoot,
    "apps/client/src-tauri/tauri.conf.json",
  );
  const config = JSON.parse(await readFile(configFile, "utf8"));
  config.version = JSON.parse(
    await readFile(path.join(sourceRoot, "release-version.json"), "utf8"),
  ).version;
  // Passing the base config as a CLI override otherwise reintroduces its JSON path
  // into TAURI_CONFIG during Gradle's nested android-studio-script invocation.
  await writeFile(configFile, JSON.stringify(config, null, 2) + "\n");
}

async function createSourceCopy() {
  await mkdir(buildRoot, { recursive: true });
  await rm(sourceRoot, { recursive: true, force: true });
  await mkdir(sourceRoot, { recursive: true });

  await copySource(repoRoot, sourceRoot);
  await resolveClientVersion();

  const clientManifest = path.join(
    sourceRoot,
    "apps/client/src-tauri/Cargo.toml",
  );
  let manifest = await readFile(clientManifest, "utf8");
  if (!/^\[workspace\]/m.test(manifest)) {
    manifest = `${manifest.trimEnd()}\n\n[workspace]\n`;
    await writeFile(clientManifest, manifest);
  }
}

async function syncIncrementalSource() {
  // Keep generated verification Android files and caches; refresh every production input.
  for (const relative of [
    "apps/client/src",
    "apps/client/public",
    "apps/client/patches",
    "apps/client/third-party",
    "apps/host/patches",
    "apps/client/src-tauri/src",
    "apps/client/src-tauri/plugins",
    "apps/client/src-tauri/capabilities",
    "packages",
    "crates",
  ]) {
    const from = path.join(repoRoot, relative);
    try {
      await lstat(from);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const to = path.join(sourceRoot, relative);
    await rm(to, { recursive: true, force: true });
    await cp(from, to, {
      recursive: true,
      filter: (file) =>
        !["node_modules", "target", ".local"].includes(path.basename(file)),
    });
  }
  for (const relative of [
    "apps/client/package.json",
    "apps/host/package.json",
    "apps/client/components.json",
    "apps/client/vite.config.ts",
    "apps/client/tsconfig.json",
    "apps/client/tsconfig.app.json",
    "apps/client/tsconfig.node.json",
    "apps/client/src-tauri/Cargo.toml",
    "apps/client/src-tauri/Cargo.lock",
    "release-version.json",
    "apps/client/src-tauri/tauri.conf.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "package.json",
    configPath,
  ]) {
    const from = path.join(repoRoot, relative);
    try {
      await lstat(from);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    await cp(from, path.join(sourceRoot, relative));
  }
  const manifestPath = path.join(
    sourceRoot,
    "apps/client/src-tauri/Cargo.toml",
  );
  const manifest = await readFile(manifestPath, "utf8");
  if (!/^\[workspace\]/m.test(manifest))
    await writeFile(manifestPath, manifest.trimEnd() + "\n\n[workspace]\n");
  await syncAndroidSources(
    path.join(sourceRoot, "apps/client/src-tauri/gen/android/app/src/main"),
  );
  await run(
    "pnpm",
    [
      "install",
      "--frozen-lockfile",
      "--store-dir",
      path.join(cacheRoot, "pnpm-store"),
    ],
    { cwd: sourceRoot, env: buildEnv },
  );
}

async function linkExistingEntries(source, destination, entryType) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    try {
      await lstat(to);
    } catch {
      await symlink(from, to, entryType);
    }
  }
}

async function prepareAndroidSdk() {
  await mkdir(androidSdk, { recursive: true });
  for (const name of [
    "cmdline-tools",
    "licenses",
    "ndk",
    "platform-tools",
    "platforms",
  ]) {
    const destination = path.join(androidSdk, name);
    try {
      await lstat(destination);
    } catch {
      await symlink(path.join(sharedAndroidSdk, name), destination, "dir");
    }
  }

  const sharedBuildTools = path.join(sharedAndroidSdk, "build-tools");
  const buildTools = path.join(androidSdk, "build-tools");
  await mkdir(buildTools, { recursive: true });
  for (const name of await readdir(sharedBuildTools)) {
    const destination = path.join(buildTools, name);
    try {
      await lstat(destination);
    } catch {
      await symlink(path.join(sharedBuildTools, name), destination, "dir");
    }
  }

  const requiredBuildTools = path.join(buildTools, "36.0.0");
  try {
    await lstat(requiredBuildTools);
  } catch {
    const sdkManager = path.join(
      sharedAndroidSdk,
      "cmdline-tools/23.0.0/bin/sdkmanager",
    );
    await run(sdkManager, [`--sdk_root=${androidSdk}`, "build-tools;36.0.0"], {
      cwd: repoRoot,
      env: buildEnv,
    });
  }
}

async function prepareCargoHome() {
  const cargoHome = path.join(cacheRoot, "cargo-home");
  const oldRegistry = path.join(androidCargo, "registry");
  const registryNames = await readdir(path.join(oldRegistry, "src"));
  if (registryNames.length === 0) fail("既存Cargo crate cacheが見つかりません");

  await mkdir(cargoHome, { recursive: true });
  const newRegistry = path.join(cargoHome, "registry");
  await mkdir(newRegistry, { recursive: true });
  const indexReadyFile = path.join(cargoHome, ".index-cache-ready");
  try {
    await lstat(indexReadyFile);
  } catch {
    for (const name of registryNames) {
      const destinationIndex = path.join(newRegistry, "index", name);
      await mkdir(path.dirname(destinationIndex), { recursive: true });
      await cp(path.join(oldRegistry, "index", name), destinationIndex, {
        recursive: true,
      });
    }
    await writeFile(indexReadyFile, "ready\n");
  }
  for (const name of registryNames) {
    await linkExistingEntries(
      path.join(oldRegistry, "src", name),
      path.join(newRegistry, "src", name),
      "dir",
    );
    await linkExistingEntries(
      path.join(oldRegistry, "cache", name),
      path.join(newRegistry, "cache", name),
      "file",
    );
  }
  return cargoHome;
}

async function syncAndroidSources(destinationRoot) {
  const androidPath = "apps/client/src-tauri/gen/android";
  const mainPath = `${androidPath}/app/src/main`;
  // Same listing as createSourceCopy: tracked and unignored files. The
  // release build runs in a `git init` copy where nothing is tracked yet.
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      mainPath,
    ],
    { cwd: repoRoot },
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  if (!files.length) fail(`${mainPath} から写すファイルがありません`);
  for (const file of files) {
    if (file.endsWith("/MainActivity.kt")) continue;
    const destination = path.join(
      destinationRoot,
      path.relative(mainPath, file),
    );
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(repoRoot, file), destination);
  }
}

async function installScannerPlugin() {
  const config = path.join(sourceRoot, configPath);
  const clientTauri = path.join(sourceRoot, "apps/client/src-tauri");
  const androidRoot = path.join(clientTauri, "gen/android");
  await rm(androidRoot, { recursive: true, force: true });

  await run(
    "pnpm",
    [
      "--filter",
      "@iori/client",
      "exec",
      "tauri",
      "android",
      "init",
      "--ci",
      "--skip-targets-install",
      "--config",
      config,
    ],
    { cwd: sourceRoot, env: buildEnv },
  );

  const gradleFile = path.join(androidRoot, "app/build.gradle.kts");
  let gradle = await readFile(gradleFile, "utf8");
  if (!gradle.includes(scannerDependency)) {
    const dependencyBlock = /^dependencies\s*\{\r?\n/m;
    if (!dependencyBlock.test(gradle)) {
      fail("生成したAndroid build.gradle.ktsにdependencies blockがありません");
    }
    gradle = gradle.replace(
      dependencyBlock,
      (match) => `${match}${scannerDependency}\n`,
    );
    await writeFile(gradleFile, gradle);
  }

  const sdkSettings = [
    [/compileSdk\s*=\s*\d+/, "compileSdk = 36"],
    [/targetSdk\s*=\s*\d+/, "targetSdk = 36"],
  ];
  for (const [pattern, replacement] of sdkSettings) {
    if (!pattern.test(gradle))
      fail(`Android SDK設定が見つかりません: ${pattern}`);
    gradle = gradle.replace(pattern, replacement);
  }
  gradle = gradle.replace(
    /buildToolsVersion\s*=\s*"[^"]+"\r?\n?/,
    'buildToolsVersion = "36.0.0"\n',
  );
  if (!/buildToolsVersion\s*=/.test(gradle)) {
    gradle = gradle.replace(
      /android\s*\{\r?\n/,
      (match) => `${match}    buildToolsVersion = "36.0.0"\n`,
    );
  }
  await writeFile(gradleFile, gradle);

  const manifestFile = path.join(
    androidRoot,
    "app/src/main/AndroidManifest.xml",
  );
  await syncAndroidSources(path.dirname(manifestFile));

  const gradleAfterInit = await readFile(gradleFile, "utf8");
  if (!gradleAfterInit.includes(`namespace = "${verificationIdentifier}"`)) {
    fail("verification identifierからAndroid namespaceが生成されませんでした");
  }
  const mainActivityRoot = path.join(androidRoot, "app/src/main/java");
  const mainActivity = await findFile(mainActivityRoot, "MainActivity.kt");
  if (!mainActivity) fail("生成されたMainActivity.ktが見つかりません");
  const mainActivitySource = await readFile(mainActivity, "utf8");
  if (!mainActivitySource.includes("package " + verificationIdentifier)) {
    fail("MainActivity packageが検証identifierと一致しません");
  }
}

async function findFile(root, expectedName) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.isFile() && entry.name === expectedName) return file;
    if (entry.isDirectory()) {
      const found = await findFile(file, expectedName);
      if (found) return found;
    }
  }
  return undefined;
}

async function syncVerificationMainActivity() {
  // Tauri init regenerates MainActivity for the verification identifier.
  // Keep the real application's window/inset handling in full and incremental builds.
  const source = await readFile(
    path.join(
      repoRoot,
      "apps/client/src-tauri/gen/android/app/src/main/java/io/github/ioriapp/iori/MainActivity.kt",
    ),
    "utf8",
  );
  // The package follows the verification config in use (connection, workspace…).
  await writeFile(
    path.join(
      sourceRoot,
      "apps/client/src-tauri/gen/android/app/src/main/java",
      ...verificationIdentifier.split("."),
      "MainActivity.kt",
    ),
    source.replace(
      "package io.github.ioriapp.iori",
      "package " + verificationIdentifier,
    ),
  );
}

async function findApks(root, output = []) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return output;
    throw error;
  }
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) await findApks(file, output);
    else if (entry.isFile() && entry.name.endsWith(".apk")) output.push(file);
  }
  return output;
}

function verifyApk(apk, aapt) {
  const badging = spawnSync(aapt, ["dump", "badging", apk], {
    encoding: "utf8",
  });
  if (badging.error || badging.status !== 0) {
    fail(`aaptでAPKを読めません: ${badging.error?.message ?? badging.stderr}`);
  }
  if (
    !badging.stdout.includes(`package: name='${verificationAndroidPackage}'`)
  ) {
    fail("APK applicationIdが検証専用identifierではありません");
  }

  const permissions = spawnSync(aapt, ["dump", "permissions", apk], {
    encoding: "utf8",
  });
  if (permissions.error || permissions.status !== 0) {
    fail(
      `APK permissionsを読めません: ${permissions.error?.message ?? permissions.stderr}`,
    );
  }
  if (!permissions.stdout.includes("android.permission.CAMERA")) {
    fail("APKにcamera permissionが含まれていません");
  }

  const contents = spawnSync("unzip", ["-l", apk], { encoding: "utf8" });
  if (contents.error || contents.status !== 0) {
    fail(
      `APKの内容を読めません: ${contents.error?.message ?? contents.stderr}`,
    );
  }
  if (!contents.stdout.includes("lib/arm64-v8a/libiori_client_lib.so")) {
    fail("APKにarm64-v8aのClient native libraryが含まれていません");
  }
}

const buildEnv = { ...process.env };
delete buildEnv.ANDROID_SDK_HOME;
buildEnv.ANDROID_HOME = androidSdk;
buildEnv.ANDROID_SDK_ROOT = androidSdk;
buildEnv.ANDROID_USER_HOME = path.join(cacheRoot, "android-user");
buildEnv.GRADLE_USER_HOME = path.join(cacheRoot, "gradle-home");
buildEnv.CARGO_HOME = path.join(cacheRoot, "cargo-home");
buildEnv.CARGO_TARGET_DIR = path.join(cacheRoot, "cargo-target");
buildEnv.CARGO_BUILD_JOBS = "1";
buildEnv.RUSTUP_HOME = rustupHome;
buildEnv.JAVA_HOME = javaHome;
buildEnv.JAVA_TOOL_OPTIONS = `-Duser.home=${path.join(cacheRoot, "java-home")} -Djava.util.prefs.userRoot=${path.join(cacheRoot, "java-prefs")}`;
buildEnv.CI = "1";
buildEnv.PATH = [
  path.join(androidCargo, "bin"),
  path.join(javaHome, "bin"),
  path.join(androidSdk, "platform-tools"),
  process.env.PATH,
]
  .filter(Boolean)
  .join(path.delimiter);

async function main() {
  const incremental = process.argv.includes("--incremental");
  if (incremental) {
    const requiredPaths = [
      path.join(sourceRoot, "node_modules"),
      path.join(
        sourceRoot,
        "apps/client/src-tauri/gen/android/app/build.gradle.kts",
      ),
      path.join(androidSdk, "build-tools/36.0.0/aapt"),
      buildEnv.CARGO_HOME,
      buildEnv.GRADLE_USER_HOME,
    ];
    for (const requiredPath of requiredPaths) {
      try {
        await lstat(requiredPath);
      } catch {
        fail(`増分build用の既存scratchがありません: ${requiredPath}`);
      }
    }

    await syncIncrementalSource();
    process.stdout.write("既存scratchへ現行Client・通信・依存を同期しました\n");
  } else {
    await mkdir(cacheRoot, { recursive: true });
    const cargoHomePromise = prepareCargoHome();
    await Promise.all([
      mkdir(buildEnv.ANDROID_USER_HOME, { recursive: true }),
      mkdir(buildEnv.GRADLE_USER_HOME, { recursive: true }),
      mkdir(buildEnv.CARGO_TARGET_DIR, { recursive: true }),
      mkdir(path.join(cacheRoot, "java-prefs"), { recursive: true }),
      cargoHomePromise,
    ]);
    await prepareAndroidSdk();
    await createSourceCopy();

    await run(
      "pnpm",
      [
        "install",
        "--frozen-lockfile",
        "--store-dir",
        path.join(cacheRoot, "pnpm-store"),
      ],
      { cwd: sourceRoot, env: buildEnv },
    );
    await installScannerPlugin();
  }

  await resolveClientVersion();
  await syncVerificationMainActivity();
  const androidRoot = path.join(
    sourceRoot,
    "apps/client/src-tauri/gen/android",
  );
  const projectCache = path.join(
    cacheRoot,
    "gradle-project",
    verificationIdentifier,
  );
  for (const relative of [".gradle", "build", "app/build"]) {
    const destination = path.join(projectCache, relative);
    await mkdir(destination, { recursive: true });
    const link = path.join(androidRoot, relative);
    // Replace only the run-local directory/link, never the cached destination.
    await rm(link, { recursive: true, force: true });
    await symlink(destination, link, "dir");
  }
  await writeFile(
    path.join(androidRoot, "gradle.properties"),
    // Tauri regenerates the plugin projects for each source copy. A shared
    // configuration cache can retain the previous copy's plugin dependencies.
    // Keep task/output caching, but configure the current projects every time.
    (
      await readFile(path.join(androidRoot, "gradle.properties"), "utf8")
    ).replace(
      /^org\.gradle\.configuration-cache=.*$/m,
      "org.gradle.configuration-cache=false",
    ) +
      "\norg.gradle.caching=true\nkotlin.compiler.execution.strategy=in-process\norg.gradle.daemon=false\n",
  );
  // buildSrc is a separate Gradle build and does not inherit root properties.
  await writeFile(
    path.join(androidRoot, "buildSrc/gradle.properties"),
    "kotlin.compiler.execution.strategy=in-process\n",
  );

  // Tauri's android build already builds aarch64 and populates jniLibs before
  // starting Gradle. Keep android-studio-script's runtime-symbol validation,
  // but reuse that library instead of rebuilding Rust inside the Gradle JVM.
  const rustTask = path.join(
    androidRoot,
    "buildSrc/src/main/java",
    ...verificationIdentifier.split("."),
    "kotlin/BuildTask.kt",
  );
  const nm = path.join(
    androidSdk,
    "ndk/27.2.12479018/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-nm",
  );
  await writeFile(
    rustTask,
    (await readFile(rustTask, "utf8")).replace(
      /    @TaskAction\s+fun assemble\(\) \{[\s\S]*?(?=    fun runTauriCli)/u,
      `    @TaskAction
    fun assemble() {
        val library = File(projectDir, "src/main/jniLibs/arm64-v8a/libiori_client_lib.so")
        val symbols = java.io.ByteArrayOutputStream()
        execOperations.exec {
            executable(${JSON.stringify(nm)})
            args("-D", library.path)
            standardOutput = symbols
        }.assertNormalExitValue()
        if (!symbols.toString("UTF-8").lineSequence().any {
            it.trim().split(Regex("\\\\s+")).last() == "Java_app_tauri_plugin_PluginManager_handlePluginResponse"
        }) {
            throw GradleException("Library does not include required Tauri runtime symbols")
        }
        logger.lifecycle("Reused initial Rust build: $target, release=$release")
    }

`,
    ),
  );

  if (release && !process.argv.includes("--refresh-android-notices"))
    await copyAndroidNotice(path.join(androidRoot, "app/src/main/assets"));
  await refreshSourceMtimes(sourceRoot);
  await run(
    "pnpm",
    [
      "--filter",
      "@iori/client",
      "exec",
      "tauri",
      "android",
      "build",
      ...(release ? [] : ["--debug"]),
      "--apk",
      "--target",
      "aarch64",
      "--ci",
      "--config",
      path.join(sourceRoot, configPath),
    ],
    { cwd: sourceRoot, env: buildEnv },
  );

  const apkRoot = path.join(
    sourceRoot,
    "apps/client/src-tauri/gen/android/app/build/outputs/apk",
    "universal",
    release ? "release" : "debug",
  );
  const apks = await findApks(apkRoot);
  if (apks.length !== 1) {
    fail(`APKは1個の想定ですが ${apks.length} 個見つかりました`);
  }
  const buildTools = await readdir(path.join(androidSdk, "build-tools"));
  const buildToolVersion = buildTools
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    )
    .at(-1);
  if (!buildToolVersion) fail("Android build-toolsが見つかりません");
  const aapt = path.join(androidSdk, "build-tools", buildToolVersion, "aapt");
  verifyApk(apks[0], aapt);

  const kotlinClass = await findFile(
    path.join(
      sourceRoot,
      "apps/client/src-tauri/gen/android/app/build/tmp/kotlin-classes",
    ),
    "IoriNativePlugin.class",
  );
  if (!kotlinClass)
    fail("Android APK buildでKotlin native pluginがcompileされませんでした");

  const outputApk = path.join(buildRoot, "client.apk");
  await cp(apks[0], outputApk);
  process.stdout.write(
    `${JSON.stringify(
      {
        apk: outputApk,
        applicationId: verificationAndroidPackage,
        nativePlugin: "io.github.ioriapp.iori.IoriNativePlugin",
        cameraPermission: true,
        incremental,
        scratchRoot: buildRoot,
      },
      null,
      2,
    )}\n`,
  );
}

await main();
