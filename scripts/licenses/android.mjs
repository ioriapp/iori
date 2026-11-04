import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const directory = path.join(import.meta.dirname, "sources/android");
const inputs = [
  "apps/client/src-tauri/gen/android/settings.gradle",
  "apps/client/src-tauri/gen/android/build.gradle.kts",
  "apps/client/src-tauri/gen/android/app/build.gradle.kts",
  "apps/client/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties",
  "apps/client/src-tauri/plugins/apk-installer/android/build.gradle.kts",
  "apps/client/src-tauri/plugins/clipboard-image/android/build.gradle.kts",
];
export async function androidHashes() {
  const hashes = Object.fromEntries(
    await Promise.all(
      inputs.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
  );
  const lock = await readFile(
    path.join(root, "apps/client/src-tauri/Cargo.lock"),
    "utf8",
  );
  const crates = lock
    .split("[[package]]")
    .map((entry) => {
      const name = /^name = "(tauri[^"\n]*)"$/m.exec(entry)?.[1];
      const version = /^version = "([^"\n]+)"$/m.exec(entry)?.[1];
      return name && version ? `${name}@${version}` : undefined;
    })
    .filter(Boolean)
    .sort();
  hashes["apps/client/src-tauri/Cargo.lock#tauri"] = createHash("sha256")
    .update(crates.join("\n"))
    .digest("hex");
  const script = await readFile(
    path.join(root, "verification/connection/build-android.mjs"),
    "utf8",
  );
  const scanner = /const scannerDependency\s*=\s*([\s\S]*?);/.exec(script)?.[0];
  if (!scanner) throw new Error("Android scanner dependency not found");
  hashes["verification/connection/build-android.mjs#scannerDependency"] =
    createHash("sha256").update(scanner).digest("hex");
  const gradleSetup = /const gradleFile\s*=[\s\S]*?const manifestFile\s*=/.exec(
    script,
  )?.[0];
  if (!gradleSetup) throw new Error("Android Gradle setup not found");
  hashes["verification/connection/build-android.mjs#gradleSetup"] = createHash(
    "sha256",
  )
    .update(gradleSetup)
    .digest("hex");
  return hashes;
}
export async function copyAndroidNotice(destination) {
  let index;
  try {
    index = JSON.parse(
      await readFile(path.join(directory, "index.json"), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(
      "Android dependency licenses missing; run node scripts/licenses/update-android.mjs",
    );
  }
  const actual = await androidHashes();
  for (const [name, hash] of Object.entries(actual))
    if (index.inputs[name] !== hash)
      throw new Error(
        `${name}: Android dependency licenses are stale; run node scripts/licenses/update-android.mjs`,
      );
  for (const [name, item] of Object.entries(index.packages)) {
    if (!item.files?.length)
      throw new Error(
        `${name}: license text missing; run node scripts/licenses/update-android.mjs`,
      );
    for (const file of item.files) {
      try {
        await access(path.join(directory, "objects", file.hash));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        throw new Error(
          `${name}: license text missing; run node scripts/licenses/update-android.mjs`,
        );
      }
    }
  }
  await mkdir(destination, { recursive: true });
  try {
    await cp(
      path.join(directory, "THIRD-PARTY-ANDROID.txt"),
      path.join(destination, "THIRD-PARTY-ANDROID.txt"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(
      "Android dependency notices missing; run node scripts/licenses/update-android.mjs",
    );
  }
  console.log(`Android Gradle licenses: ${index.count}`);
}
