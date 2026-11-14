import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { command, root, version, releaseSource } from "./common.mjs";
import { lockEntry } from "../../verification/native/locks.mjs";
import {
  acceptAndroidRelease,
  AndroidDeviceUnavailableError,
} from "../../verification/native/android-release.mjs";
import semver from "semver";

export const acceptanceScenarios = [
  "terminal-daemon-upgrade",
  "host-update",
  "ui-smoke",
  "host-uninstall",
];

export function reportFirstFailures(firstFailures) {
  if (!firstFailures.length) return;
  console.log("[release] 揺れ（同じ配布物での再実行に成功）:");
  for (const { scenario, evidence } of firstFailures)
    console.log(`  ${scenario}: ${evidence}`);
}

export async function androidAcceptance(cwd, apk, env = process.env) {
  const evidenceRoot =
    env.IORI_VERIFICATION_EVIDENCE_ROOT ??
    path.join(root, ".local/evidence/release", version);
  await mkdir(evidenceRoot, { recursive: true });
  // The child records whether the device was reachable, so the signed Release
  // information can say whether the startup was actually verified.
  const resultFile = path.join(evidenceRoot, "android-device.json");
  await rm(resultFile, { force: true });
  await command(
    process.execPath,
    [
      "scripts/release/acceptance.mjs",
      "--android",
      apk,
      "--allow-unavailable-device",
    ],
    {
      cwd,
      env: {
        ...env,
        IORI_VERIFICATION_EVIDENCE_ROOT: evidenceRoot,
        IORI_ANDROID_ACCEPTANCE_RESULT: resultFile,
      },
    },
  );
  let result;
  try {
    result = JSON.parse(await readFile(resultFile, "utf8"));
  } catch (error) {
    throw new Error(`Androidの実機受入の結果を読めません: ${resultFile}`, {
      cause: error,
    });
  }
  console.log(
    `[release] acceptance/android device=${result.device}${result.reason ? ` reason=${result.reason}` : ""}`,
  );
  if (result.device === "verified") return { device: "verified" };
  if (result.device === "skipped")
    // The signed Release information is a product artifact; keep the machine
    // specific adb detail in the build log and evidence instead.
    return {
      device: "skipped",
      reason: "検証端末につながらない、または検証端末を確認できない",
    };
  throw new Error(
    `Androidの実機受入の結果が不正です: ${JSON.stringify(result)}`,
  );
}

export async function previousAndroidRelease(
  fetcher = fetch,
  currentVersion = version,
) {
  const source = new URL(releaseSource);
  const [owner, repo] = source.pathname.split("/").filter(Boolean);
  const releases = [];
  for (let page = 1; ; page++) {
    const response = await fetcher(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100&page=${page}`,
    );
    if (!response.ok)
      throw new Error(`前の Release 一覧の取得に失敗: HTTP ${response.status}`);
    const batch = await response.json();
    releases.push(
      ...batch.filter(
        (item) =>
          !item.draft &&
          item.tag_name.startsWith("v") &&
          semver.valid(item.tag_name.slice(1)) !== null &&
          item.tag_name !== `v${currentVersion}`,
      ),
    );
    if (batch.length < 100) break;
  }
  releases.sort(
    (a, b) => Date.parse(b.published_at) - Date.parse(a.published_at),
  );
  return releases[0];
}

async function androidAcceptanceEntry(args) {
  await lockEntry(import.meta.url);
  const evidenceRoot = path.resolve(
    process.env.IORI_VERIFICATION_EVIDENCE_ROOT ??
      path.join(root, ".local/evidence/release", version),
  );
  await mkdir(evidenceRoot, { recursive: true });
  const evidence = await mkdtemp(path.join(evidenceRoot, "android-"));
  console.log(`[release] acceptance/android evidence=${evidence}`);
  const config = JSON.parse(
    await readFile(
      path.join(root, "apps/client/src-tauri/tauri.conf.json"),
      "utf8",
    ),
  );
  const allowUnavailableDevice = args.includes("--allow-unavailable-device");
  let device;
  try {
    try {
      await acceptAndroidRelease({
        apk: path.resolve(args[0]),
        packageName: config.identifier,
        appLabel: config.productName,
        evidence,
      });
      device = { device: "verified" };
    } catch (error) {
      if (
        !allowUnavailableDevice ||
        !(error instanceof AndroidDeviceUnavailableError)
      )
        throw error;
      device = { device: "skipped", reason: error.reason };
      console.warn(
        `[release] ⚠ Android の実機の確認を飛ばしました（検証端末につながらない: ${error.reason}）`,
      );
    }
  } finally {
    if (device && process.env.IORI_ANDROID_ACCEPTANCE_RESULT)
      await writeFile(
        process.env.IORI_ANDROID_ACCEPTANCE_RESULT,
        JSON.stringify({ ...device, evidence }, null, 2) + "\n",
      );
  }
}

export async function acceptance(
  cwd,
  archive,
  env = process.env,
  firstFailures = [],
) {
  const started = performance.now();
  const temporaryRoot = path.join(cwd, ".local");
  await mkdir(temporaryRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryRoot, "acceptance-"));
  const host = path.join(temporary, "host");
  const evidenceRoot =
    env.IORI_VERIFICATION_EVIDENCE_ROOT ??
    path.join(root, ".local/evidence/release", version);
  try {
    await mkdir(evidenceRoot, { recursive: true });
    const executionEvidence = await mkdtemp(
      path.join(evidenceRoot, "acceptance-"),
    );
    await mkdir(host);
    await command("tar", ["-xzf", archive, "-C", host]);
    const targetVersion = JSON.parse(
      await readFile(path.join(host, "release-version.json"), "utf8"),
    ).version;
    const previous = await previousAndroidRelease(fetch, targetVersion);
    if (!previous)
      throw new Error("更新互換の確認に必要な前のReleaseがありません");
    const download = await fetch(
      `${releaseSource}/download/${encodeURIComponent(previous.tag_name)}/iori-host-linux-x64.tar.gz`,
    );
    if (!download.ok)
      throw new Error(`前のReleaseのHostの取得に失敗: HTTP ${download.status}`);
    const previousArchive = path.join(temporary, "previous-host.tar.gz");
    const previousHost = path.join(temporary, "previous-host");
    await writeFile(previousArchive, Buffer.from(await download.arrayBuffer()));
    await mkdir(previousHost);
    await command("tar", ["-xzf", previousArchive, "-C", previousHost]);
    const childEnv = Object.fromEntries(
      Object.entries(env).filter(
        ([name]) => name !== "CLAUDECODE" && !name.startsWith("CLAUDE_CODE_"),
      ),
    );
    const checks = [
      {
        name: "terminal-daemon-upgrade",
        args: [
          process.execPath,
          "--test",
          "--test-timeout=60000",
          "e2e/host/terminal-daemon-upgrade.test.mjs",
        ],
        env: {
          IORI_PREVIOUS_HOST_BUNDLE: previousHost,
          IORI_TARGET_HOST_BUNDLE: host,
        },
      },
      {
        // Removal uses the same installation, so retry this dependent pair together.
        name: "host-update+host-uninstall",
        args: [
          process.execPath,
          "verification/updates/host-linux.mjs",
          `--previous-archive=${previousArchive}`,
          `--target-archive=${archive}`,
          "--uninstall",
        ],
      },
      {
        name: "ui-smoke",
        args: [
          process.execPath,
          "node_modules/@playwright/test/cli.js",
          "test",
          "--config=e2e/ui/playwright.config.ts",
          "--project=desktop",
          "--retries=0",
          "register-first-agent.spec.ts",
          "terminal-input-resize.spec.ts",
        ],
        env: { IORI_UI_HOST_DISTRIBUTION: host },
      },
    ];
    const results = await Promise.allSettled(
      checks.map(async (check) => {
        for (const attempt of ["first-attempt", "retry"]) {
          const evidence = path.resolve(executionEvidence, check.name, attempt);
          const attemptStarted = performance.now();
          console.log(
            `[release] acceptance/${check.name}/${attempt} evidence=${evidence}`,
          );
          try {
            await command(
              process.execPath,
              ["scripts/run-bounded-check.mjs", ...check.args],
              {
                cwd,
                env: {
                  ...childEnv,
                  ...check.env,
                  IORI_VERIFICATION_EVIDENCE_ROOT: evidence,
                  IORI_UI_RUN: path.relative(
                    path.join(cwd, ".local/evidence/ui"),
                    evidence,
                  ),
                },
              },
            );
            if (attempt === "retry")
              firstFailures.push({ scenario: check.name, evidence });
            return;
          } catch (error) {
            if (attempt === "retry")
              throw new Error(`${check.name}: ${error.message}`, {
                cause: error,
              });
            console.error(
              `[release] ${check.name} failed; retrying once with the same distribution: ${error.message}`,
            );
          } finally {
            console.log(
              `[release] acceptance/${check.name}/${attempt} seconds=${((performance.now() - attemptStarted) / 1000).toFixed(3)}`,
            );
          }
        }
      }),
    );
    // All checks must finish their process cleanup before removing the bundles.
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length)
      throw new AggregateError(
        failures,
        `Release受入の失敗: ${failures.map((error) => error.message).join("; ")}`,
      );
  } finally {
    await rm(temporary, { recursive: true, force: true });
    console.log(
      `[release] acceptance seconds=${((performance.now() - started) / 1000).toFixed(3)}`,
    );
  }
}

if (process.argv[1] === import.meta.filename) {
  const firstFailures = [];
  try {
    if (process.argv[2] === "--android")
      await androidAcceptanceEntry(process.argv.slice(3));
    else
      await acceptance(
        root,
        path.resolve(process.argv[2]),
        process.env,
        firstFailures,
      );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    reportFirstFailures(firstFailures);
  }
}
