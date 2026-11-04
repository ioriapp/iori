import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, sign } from "node:crypto";
import path from "node:path";
import semver from "semver";
import { prepareSigning } from "./keys.mjs";
import { apkContainsSource } from "./apk-source.mjs";
import { lockEntry } from "../native/locks.mjs";
import { gate } from "../native/remote.mjs";
import { evidence, command } from "../connection/build.mjs";
import { createSourceCopy } from "../native/source.mjs";
import {
  prepareTls,
  verificationSource,
  verificationReleaseSource,
  endpoint,
} from "./distribution.mjs";
await lockEntry(import.meta.url);
gate({ devices: ["android"], requireFreePorts: false });
const stateFile = path.join(evidence, "build-state.json");
const state = JSON.parse(await readFile(stateFile, "utf8"));
const directory = path.join(state.localRoot, "update-distribution");
state.updateRoot = directory;
await mkdir(path.join(directory, "assets"), { recursive: true });
await prepareTls(directory, "Android");
const publicKey = await prepareSigning(directory, "Android");
const certificate = await readFile(path.join(directory, "tls/ca.pem"), "utf8");
const source = path.join(state.localRoot, "update-android-source");
await createSourceCopy(process.cwd(), source);
execFileSync("git", ["init", "-q"], { cwd: source });
// Keep tracked Android inputs that the repository ignores for new files.
execFileSync("git", ["add", "--force", "."], { cwd: source });
await writeFile(
  path.join(source, "apps/client/src-tauri/src/updates/mod.rs"),
  await verificationSource(process.cwd(), certificate),
);
await writeFile(
  path.join(source, "apps/client/src-tauri/src/updates/release.rs"),
  await verificationReleaseSource(process.cwd()),
);
await writeFile(
  path.join(source, "release-source.txt"),
  endpoint("Android").source + "\n",
);
await writeFile(path.join(source, "release-public-key.txt"), publicKey + "\n");
const current = JSON.parse(
  await readFile("release-version.json", "utf8"),
).version;
const next = semver.inc(current, "patch");
state.updateVersions = { current, next };
await writeFile(stateFile, JSON.stringify(state, null, 2));
try {
  for (const version of [current, next]) {
    await writeFile(
      path.join(source, "release-version.json"),
      JSON.stringify({ version }),
    );
    await command(
      process.execPath,
      [
        "scripts/run-bounded-check.mjs",
        process.execPath,
        "verification/connection/build-android.mjs",
        ...(version === next ? ["--incremental"] : []),
      ],
      {
        cwd: source,
        env: {
          ...process.env,
          IORI_VERIFICATION_EVIDENCE_ROOT: path.resolve(evidence),
          IORI_VERIFICATION_CONFIG: "verification/updates/tauri.conf.json",
        },
      },
    );
    const built = JSON.parse(await readFile(stateFile, "utf8"));
    const sourceUrl = (
      await readFile(
        path.join(built.androidRoot, "source/release-source.txt"),
        "utf8",
      )
    ).trim();
    const apkSource = await apkContainsSource(
      path.join(built.androidRoot, "client.apk"),
      endpoint("Android").source,
    );
    if (sourceUrl !== endpoint("Android").source || !apkSource)
      throw new Error(
        "The Android source copy and APK must contain the verification distribution URL",
      );
    await mkdir(path.join(evidence, "updates"), { recursive: true });
    await writeFile(
      path.join(
        evidence,
        "updates",
        `android-build-${version}-${Date.now()}.json`,
      ),
      JSON.stringify({ version, sourceUrl, apkSource }, null, 2),
    );
    await cp(
      path.join(built.androidRoot, "client.apk"),
      path.join(
        directory,
        version === current ? "old.apk" : "assets/iori-android-arm64.apk",
      ),
    );
  }
  const apk = await readFile(
    path.join(directory, "assets/iori-android-arm64.apk"),
  );
  const manifest = Buffer.from(
    JSON.stringify({
      version: next,
      assets: [
        {
          name: "iori-android-arm64.apk",
          size: apk.length,
          sha256: createHash("sha256").update(apk).digest("hex"),
        },
      ],
    }),
  );
  await writeFile(path.join(directory, "assets/release.json"), manifest);
  await writeFile(
    path.join(directory, "assets/release.json.sig"),
    sign(
      null,
      manifest,
      await readFile(path.join(directory, "signing/release.pem")),
    ),
  );
} finally {
  await rm(source, { recursive: true, force: true });
}
