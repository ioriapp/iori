import { cp, mkdir, rm, mkdtemp, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const requiredNode = (
  await readFile(path.join(root, ".node-version"), "utf8")
).trim();
if (process.versions.node !== requiredNode)
  throw new Error(
    `Node ${requiredNode}で配布物を作ってください（現在: ${process.versions.node}）`,
  );
const { output, version, git, command } = await import("./common.mjs");
const { writeUpdater } = await import("./updater.mjs");
const { writeManifest } = await import("./manifest.mjs");
const { acceptance, reportFirstFailures, releaseScenarios, androidAcceptance } =
  await import("./acceptance.mjs");
await command(process.execPath, [
  "scripts/publish/check-forbidden.mjs",
  "--head",
]);
await command(process.execPath, ["scripts/licenses/check.mjs", "--head"]);
// Reject unknown names before creating or removing any build output.
const scenarios = releaseScenarios(process.argv.slice(2));
let androidDevice;
for (const name of ["release.json", "release.json.sig"])
  await rm(path.join(output, name), { force: true });
const commit = git("rev-parse", "HEAD");
const builds = path.join(root, ".local/release-build");
await mkdir(builds, { recursive: true });
await mkdir(output, { recursive: true });
const source = await mkdtemp(path.join(builds, "source-"));
const archive = source + ".tar";
const started = performance.now();
const firstFailures = [];
async function timed(name, action) {
  const start = performance.now();
  console.log(`[release] ${name} start ${new Date().toISOString()}`);
  try {
    return await action();
  } finally {
    console.log(
      `[release] ${name} seconds=${((performance.now() - start) / 1000).toFixed(3)}`,
    );
  }
}
try {
  // Every platform uses the same HEAD snapshot, even with local edits.
  execFileSync("git", ["archive", "--format=tar", "-o", archive, commit], {
    cwd: root,
  });
  const store = path.join(builds, "pnpm-store");
  const env = {
    ...process.env,
    CI: "true",
    npm_config_store_dir: store,
    pnpm_config_store_dir: store,
  };
  const platformAssets = {
    linux: ["iori-host-linux-x64.tar.gz", "install.sh"],
    android: ["iori-android-arm64.apk"],
    // writeUpdater signs these after collection.
    "linux-client": ["iori-linux-x64.deb", "iori-linux-x64.AppImage"],
    windows: [
      "iori-host-windows-x64.zip",
      "iori-setup-windows-x64.exe",
      "install.ps1",
    ],
  };
  // Separate snapshots keep native generation and source transfer independent.
  const results = await Promise.allSettled(
    Object.entries(platformAssets).map(async ([platform, names]) => {
      const cwd = path.join(source, platform);
      await mkdir(cwd);
      await command("tar", ["-mxf", archive, "-C", cwd]);
      execFileSync("git", ["init", "-q"], { cwd });
      await timed(platform, async () => {
        if (platform === "linux")
          await timed("dependencies", () =>
            command(
              process.execPath,
              [
                "scripts/run-bounded-check.mjs",
                "--memory-only",
                "pnpm",
                "install",
                "--frozen-lockfile",
                "--store-dir",
                store,
              ],
              { cwd, env },
            ),
          );
        await command(
          process.execPath,
          [
            "scripts/run-bounded-check.mjs",
            "--memory-only",
            process.execPath,
            `scripts/release/${platform}.mjs`,
          ],
          {
            cwd,
            env:
              platform === "android"
                ? {
                    ...env,
                    // Keep the result after the build scratch is removed.
                    IORI_RELEASE_ANDROID_STATIC_EVIDENCE: path.join(
                      env.IORI_VERIFICATION_EVIDENCE_ROOT ??
                        path.join(root, ".local/evidence/release", version),
                      "android-static",
                    ),
                  }
                : env,
          },
        );
        for (const name of names)
          await cp(
            path.join(cwd, ".local/release", version, name),
            path.join(output, name),
          );
        if (platform === "linux-client") {
          await rm(path.join(output, "appimage-sources"), {
            recursive: true,
            force: true,
          });
          await cp(
            path.join(cwd, ".local/release", version, "appimage-sources"),
            path.join(output, "appimage-sources"),
            { recursive: true, force: true },
          );
        }
      });
      if (platform === "linux")
        await acceptance(
          cwd,
          path.join(output, "iori-host-linux-x64.tar.gz"),
          env,
          firstFailures,
          scenarios,
        );
      if (platform === "android")
        await timed("acceptance/android", async () => {
          androidDevice = await androidAcceptance(
            cwd,
            path.join(output, "iori-android-arm64.apk"),
            env,
          );
        });
    }),
  );
  // Finish child cleanup before removing any source, including on failure.
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  await timed("updater", () => writeUpdater());
  const acceptanceResult = {
    ...(scenarios ? { type: "scoped", scenarios } : { type: "full" }),
    ...(androidDevice ? { android: androidDevice } : {}),
  };
  await timed("manifest", () => writeManifest(commit, acceptanceResult));
  console.log(`配布物と署名済みRelease情報: ${output}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await rm(archive, { force: true });
  await rm(source, { recursive: true, force: true });
  console.log(
    `[release] total seconds=${((performance.now() - started) / 1000).toFixed(3)}`,
  );
  reportFirstFailures(firstFailures);
}
