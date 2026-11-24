import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { command, root, version, releaseSource } from "./common.mjs";
import { lockEntry } from "../../verification/native/locks.mjs";
import {
  acceptAndroidRelease,
  AndroidDeviceUnavailableError,
} from "../../verification/native/android-release.mjs";
import semver from "semver";
import {
  normalizePreviousSpec,
  parsePreviousArgs,
  selectPreviousRelease,
} from "./previous-release.mjs";

export const acceptanceScenarios = [
  "terminal-daemon-upgrade",
  "host-update",
  "ui-smoke",
  "host-uninstall",
  "windows-host",
  "windows-client",
  "linux-client",
];

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function cleanChildEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => name !== "CLAUDECODE" && !name.startsWith("CLAUDE_CODE_"),
    ),
  );
}

function resolveEvidenceRoot(env) {
  return path.resolve(
    env.IORI_VERIFICATION_EVIDENCE_ROOT ??
      path.join(root, ".local/evidence/release", version),
  );
}

async function runAcceptanceChecks(
  cwd,
  executionEvidence,
  checks,
  childEnv,
  firstFailures,
  label = "acceptance",
) {
  const results = await Promise.allSettled(
    checks.map(async (check) => {
      const checkCwd = check.cwd ?? cwd;
      for (const attempt of ["first-attempt", "retry"]) {
        const evidence = path.resolve(executionEvidence, check.name, attempt);
        const attemptStarted = performance.now();
        console.log(
          `[release] ${label}/${check.name}/${attempt} evidence=${evidence}`,
        );
        try {
          await command(
            process.execPath,
            ["scripts/run-bounded-check.mjs", ...check.args],
            {
              cwd: checkCwd,
              env: {
                ...childEnv,
                ...check.env,
                IORI_VERIFICATION_EVIDENCE_ROOT: evidence,
                IORI_UI_RUN: path.relative(
                  path.join(checkCwd, ".local/evidence/ui"),
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
            `[release] ${label}/${check.name}/${attempt} seconds=${((performance.now() - attemptStarted) / 1000).toFixed(3)}`,
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
      `Release受け入れの失敗: ${failures.map((error) => error.message).join("; ")}`,
    );
}

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

export async function previousRelease(
  fetcher = fetch,
  currentVersion = version,
  previous = process.env.IORI_RELEASE_PREVIOUS,
) {
  const spec = normalizePreviousSpec(previous);
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
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  return selectPreviousRelease(releases, { currentVersion, previous: spec });
}

export const previousAndroidRelease = previousRelease;

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
  options = {},
) {
  const started = performance.now();
  const temporaryRoot = path.join(cwd, ".local");
  await mkdir(temporaryRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryRoot, "acceptance-"));
  const host = path.join(temporary, "host");
  const evidenceRoot = resolveEvidenceRoot(env);
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
    const previous = await previousRelease(
      fetch,
      targetVersion,
      options.previous ?? env.IORI_RELEASE_PREVIOUS ?? null,
    );
    if (!previous)
      throw new Error("更新互換の確認に必要な前のReleaseがありません");
    console.log(`[release] acceptance previous=${previous.tag_name}`);
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
    const childEnv = cleanChildEnv(env);
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
          "--workers=2",
          "--retries=0",
          "register-first-agent.spec.ts",
          "terminal-input-resize.spec.ts",
        ],
        env: { IORI_UI_HOST_DISTRIBUTION: host },
      },
    ];
    await runAcceptanceChecks(
      cwd,
      executionEvidence,
      checks,
      childEnv,
      firstFailures,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
    console.log(
      `[release] acceptance seconds=${((performance.now() - started) / 1000).toFixed(3)}`,
    );
  }
}

export async function windowsAcceptance(
  cwd,
  artifactsDir,
  env = process.env,
  firstFailures = [],
  options = {},
) {
  const started = performance.now();
  const resolvedArtifacts = path.resolve(artifactsDir);
  const temporaryRoot = path.join(cwd, ".local");
  await mkdir(temporaryRoot, { recursive: true });
  const temporary = await mkdtemp(
    path.join(temporaryRoot, "acceptance-windows-"),
  );
  const evidenceRoot = resolveEvidenceRoot(env);
  const buildStateFile =
    env.IORI_WINDOWS_BUILD_STATE ??
    path.join(resolvedArtifacts, "windows-build.json");
  let buildDir;
  try {
    buildDir = JSON.parse(await readFile(buildStateFile, "utf8")).remote;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const childEnv = cleanChildEnv(env);
  try {
    await mkdir(evidenceRoot, { recursive: true });
    const executionEvidence = await mkdtemp(
      path.join(evidenceRoot, "acceptance-windows-"),
    );
    const targetVersion = JSON.parse(
      await readFile(path.join(cwd, "release-version.json"), "utf8"),
    ).version;
    const previous = await previousRelease(
      fetch,
      targetVersion,
      options.previous ?? env.IORI_RELEASE_PREVIOUS ?? null,
    );
    if (!previous)
      throw new Error("更新互換の確認に必要な前のReleaseがありません");
    console.log(`[release] acceptance/windows previous=${previous.tag_name}`);
    const baseUrl = `${releaseSource}/download/${encodeURIComponent(previous.tag_name)}`;
    const previousZip = path.join(temporary, "previous-host-windows-x64.zip");
    const previousInstaller = path.join(
      temporary,
      "previous-setup-windows-x64.exe",
    );
    await Promise.all([
      (async () => {
        const response = await fetch(`${baseUrl}/iori-host-windows-x64.zip`);
        if (!response.ok)
          throw new Error(
            `前のReleaseのWindows Hostの取得に失敗: HTTP ${response.status}`,
          );
        await writeFile(previousZip, Buffer.from(await response.arrayBuffer()));
      })(),
      (async () => {
        const response = await fetch(`${baseUrl}/iori-setup-windows-x64.exe`);
        if (!response.ok)
          throw new Error(
            `前のReleaseのWindows Clientの取得に失敗: HTTP ${response.status}`,
          );
        await writeFile(
          previousInstaller,
          Buffer.from(await response.arrayBuffer()),
        );
      })(),
    ]);
    // Both Windows checks serialize on the exclusive Windows verification lock;
    // run sequentially so neither spends its bounded-check budget queued on flock.
    const checks = [
      {
        name: "windows-host",
        cwd: root,
        args: [
          process.execPath,
          "verification/updates/host-windows.mjs",
          `--previous-zip=${previousZip}`,
          `--target-zip=${path.join(resolvedArtifacts, "iori-host-windows-x64.zip")}`,
          ...(buildDir ? [`--build-dir=${buildDir}`] : [`--source=${cwd}`]),
        ],
      },
      {
        name: "windows-client",
        cwd: root,
        args: [
          process.execPath,
          "verification/updates/client-windows-overwrite.mjs",
          `--previous-installer=${previousInstaller}`,
          `--target-installer=${path.join(resolvedArtifacts, "iori-setup-windows-x64.exe")}`,
        ],
      },
    ];
    for (const check of checks)
      await runAcceptanceChecks(
        root,
        executionEvidence,
        [check],
        childEnv,
        firstFailures,
        "acceptance/windows",
      );
  } finally {
    await rm(temporary, { recursive: true, force: true });
    if (buildDir) {
      try {
        await command(
          process.execPath,
          [
            "scripts/run-bounded-check.mjs",
            process.execPath,
            "verification/updates/host-windows.mjs",
            `--cleanup-build-dir=${buildDir}`,
          ],
          { cwd: root, env: childEnv },
        );
        await rm(buildStateFile, { force: true });
      } catch (error) {
        console.error(
          `Windows buildフォルダーの片付けに失敗しました: ${error.message}`,
        );
      }
    }
    console.log(
      `[release] acceptance/windows seconds=${((performance.now() - started) / 1000).toFixed(3)}`,
    );
  }
}

export async function linuxClientAcceptance(
  cwd,
  artifactsDir,
  env = process.env,
  firstFailures = [],
) {
  const started = performance.now();
  const resolvedArtifacts = path.resolve(artifactsDir);
  const evidenceRoot = resolveEvidenceRoot(env);
  try {
    await mkdir(evidenceRoot, { recursive: true });
    const executionEvidence = await mkdtemp(
      path.join(evidenceRoot, "acceptance-linux-client-"),
    );
    const childEnv = cleanChildEnv(env);
    await runAcceptanceChecks(
      cwd,
      executionEvidence,
      [
        {
          name: "linux-client",
          args: [
            process.execPath,
            "verification/linux-client/ubuntu.mjs",
            resolvedArtifacts,
            "--smoke",
          ],
        },
      ],
      childEnv,
      firstFailures,
      "acceptance/linux-client",
    );
  } finally {
    console.log(
      `[release] acceptance/linux-client seconds=${((performance.now() - started) / 1000).toFixed(3)}`,
    );
  }
}

function parseMinisignPublicKey(encoded) {
  if (typeof encoded !== "string" || !encoded.trim())
    throw new Error("updater の公開鍵がありません");
  const lines = Buffer.from(encoded.trim(), "base64")
    .toString("utf8")
    .split(/\r?\n/u);
  if (lines.length < 2) throw new Error("updater の公開鍵の書式が不正です");
  const raw = Buffer.from(lines[1].trim(), "base64");
  if (raw.length !== 42 || raw.subarray(0, 2).toString("ascii") !== "Ed")
    throw new Error("updater の公開鍵が Ed25519 形式ではありません");
  const keyId = raw.subarray(2, 10);
  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw.subarray(10)]),
    format: "der",
    type: "spki",
  });
  return {
    keyId: Buffer.from(keyId),
    keyIdHex: keyId.toString("hex"),
    publicKey,
  };
}

async function verifyMinisignArtifact(
  assetPath,
  signatureText,
  parsedKey,
  expectedAssetName,
  expectedVersion,
) {
  const lines = Buffer.from(signatureText.trim(), "base64")
    .toString("utf8")
    .split(/\r?\n/u);
  if (lines.length < 4 || !lines[2].startsWith("trusted comment: "))
    throw new Error(`${expectedAssetName}: updater 署名の書式が不正です`);
  const sigRaw = Buffer.from(lines[1].trim(), "base64");
  if (sigRaw.length !== 74 || sigRaw.subarray(0, 2).toString("ascii") !== "ED")
    throw new Error(
      `${expectedAssetName}: updater 署名が hashed Ed25519 形式ではありません`,
    );
  if (!sigRaw.subarray(2, 10).equals(parsedKey.keyId))
    throw new Error(
      `${expectedAssetName}: updater 署名の keyId が公開鍵と一致しません`,
    );
  const sigBytes = sigRaw.subarray(10);
  const trustedCommentBody = lines[2].slice("trusted comment: ".length);
  const commentFields = Object.fromEntries(
    trustedCommentBody
      .split("\t")
      .map((part) => {
        const sep = part.indexOf(":");
        return sep < 0 ? null : [part.slice(0, sep), part.slice(sep + 1)];
      })
      .filter(Boolean),
  );
  if (commentFields.file && commentFields.file !== expectedAssetName)
    throw new Error(
      `${expectedAssetName}: 署名の file が一致しません (${commentFields.file})`,
    );
  if (commentFields.version && commentFields.version !== expectedVersion)
    throw new Error(
      `${expectedAssetName}: 署名の version が一致しません (${commentFields.version})`,
    );
  const digest = createHash("blake2b512")
    .update(await readFile(assetPath))
    .digest();
  if (!verify(null, digest, parsedKey.publicKey, sigBytes))
    throw new Error(
      `${expectedAssetName}: updater 署名の本体検証に失敗しました`,
    );
  const globalSig = Buffer.from(lines[3].trim(), "base64");
  if (
    globalSig.length !== 64 ||
    !verify(
      null,
      Buffer.concat([sigBytes, Buffer.from(trustedCommentBody, "utf8")]),
      parsedKey.publicKey,
      globalSig,
    )
  )
    throw new Error(
      `${expectedAssetName}: updater 署名の trusted comment 検証に失敗しました`,
    );
  return commentFields;
}

export async function checkUpdaterStatic(
  cwd,
  artifactsDir,
  env = process.env,
  options = {},
) {
  const resolvedArtifacts = path.resolve(artifactsDir);
  const evidenceDir = path.join(resolveEvidenceRoot(env), "updater-static");
  await mkdir(evidenceDir, { recursive: true });
  const result = { artifactsDir: resolvedArtifacts, passed: false };
  try {
    const targetUpdater = JSON.parse(
      await readFile(path.join(resolvedArtifacts, "updater.json"), "utf8"),
    );
    const targetConf = JSON.parse(
      await readFile(
        path.join(cwd, "apps/client/src-tauri/tauri.conf.json"),
        "utf8",
      ),
    );
    const expectedVersion = JSON.parse(
      await readFile(path.join(cwd, "release-version.json"), "utf8"),
    ).version;
    if (
      targetUpdater.version !== expectedVersion ||
      semver.valid(targetUpdater.version) === null
    )
      throw new Error(
        `updater.json の version が不正です: ${targetUpdater.version} !== ${expectedVersion}`,
      );
    const targetPubkey = targetConf?.plugins?.updater?.pubkey;
    const targetKey = parseMinisignPublicKey(targetPubkey);
    result.version = targetUpdater.version;
    result.keyId = targetKey.keyIdHex;

    let previousTag = options.previousTag;
    if (!previousTag) {
      const previous = await previousRelease(
        fetch,
        targetUpdater.version,
        options.previous ?? env.IORI_RELEASE_PREVIOUS ?? null,
      );
      previousTag = previous?.tag_name;
    } else if (!previousTag.startsWith("v")) previousTag = `v${previousTag}`;

    let verificationKey = targetKey;
    let previousPlatforms = null;
    if (previousTag) {
      result.previousTag = previousTag;
      const source = new URL(releaseSource);
      const [owner, repo] = source.pathname.split("/").filter(Boolean);
      const [prevUpdaterRes, prevConfRes] = await Promise.all([
        fetch(
          `${releaseSource}/download/${encodeURIComponent(previousTag)}/updater.json`,
        ),
        fetch(
          `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(previousTag)}/apps/client/src-tauri/tauri.conf.json`,
        ),
      ]);
      if (!prevUpdaterRes.ok)
        throw new Error(
          `前のReleaseの updater.json の取得に失敗: HTTP ${prevUpdaterRes.status}`,
        );
      if (!prevConfRes.ok)
        throw new Error(
          `前のReleaseの tauri.conf.json の取得に失敗: HTTP ${prevConfRes.status}`,
        );
      const previousUpdater = await prevUpdaterRes.json();
      const previousConf = await prevConfRes.json();
      const previousPubkey = previousConf?.plugins?.updater?.pubkey;
      if (previousPubkey !== targetPubkey)
        throw new Error(
          "apps/client/src-tauri/tauri.conf.json の updater 公開鍵が前の公開バージョンと一致しません",
        );
      verificationKey = parseMinisignPublicKey(previousPubkey);
      result.pubkeyMatched = true;
      previousPlatforms = previousUpdater.platforms ?? {};
      const expectedKeys = Object.keys(previousPlatforms).sort();
      const actualKeys = Object.keys(targetUpdater.platforms ?? {}).sort();
      if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys))
        throw new Error(
          `updater.json の platform 一覧が前の公開バージョンと一致しません (${actualKeys.join(",")} !== ${expectedKeys.join(",")})`,
        );
    }

    const platformEntries = Object.entries(targetUpdater.platforms ?? {});
    if (!platformEntries.length)
      throw new Error("updater.json に platforms がありません");
    result.platforms = {};
    for (const [platform, entry] of platformEntries) {
      if (!entry?.url || !entry?.signature)
        throw new Error(
          `${platform}: updater.json の url または signature がありません`,
        );
      const assetName = path.posix.basename(new URL(entry.url).pathname);
      if (previousPlatforms) {
        const expectedAssetName = path.posix.basename(
          new URL(previousPlatforms[platform].url).pathname,
        );
        if (assetName !== expectedAssetName)
          throw new Error(
            `${platform}: updater.json の配布物名が前のClientの期待と一致しません (${assetName} !== ${expectedAssetName})`,
          );
      }
      const expectedUrl = `${releaseSource}/download/v${targetUpdater.version}/${assetName}`;
      if (entry.url !== expectedUrl)
        throw new Error(
          `${platform}: updater.json の URL が想定と一致しません (${entry.url} !== ${expectedUrl})`,
        );
      const sigFile = (
        await readFile(path.join(resolvedArtifacts, `${assetName}.sig`), "utf8")
      ).trim();
      if (sigFile !== entry.signature.trim())
        throw new Error(
          `${assetName}.sig と updater.json の署名が一致しません`,
        );
      const commentFields = await verifyMinisignArtifact(
        path.join(resolvedArtifacts, assetName),
        entry.signature,
        verificationKey,
        assetName,
        targetUpdater.version,
      );
      result.platforms[platform] = {
        assetName,
        url: entry.url,
        file: commentFields.file ?? null,
        version: commentFields.version ?? null,
        verified: true,
      };
    }
    result.passed = true;
    console.log(
      `[release] updater.json の静的検査に成功 (${previousTag ?? "初回"} → v${targetUpdater.version}, platforms=${Object.keys(result.platforms).join(",")})`,
    );
  } catch (error) {
    result.error = error.message;
    throw error;
  } finally {
    await writeFile(
      path.join(evidenceDir, "check.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
  }
}

if (process.argv[1] === import.meta.filename) {
  const firstFailures = [];
  try {
    const { previous, args } = parsePreviousArgs(process.argv.slice(2));
    const [mode, ...rest] = args;
    if (mode === "--android") await androidAcceptanceEntry(rest);
    else if (mode === "--windows") {
      if (!rest[0]) throw new Error("配布物フォルダーを指定してください");
      await windowsAcceptance(
        root,
        path.resolve(rest[0]),
        process.env,
        firstFailures,
        { previous },
      );
    } else if (mode === "--linux-client") {
      if (!rest[0]) throw new Error("配布物フォルダーを指定してください");
      await linuxClientAcceptance(
        root,
        path.resolve(rest[0]),
        process.env,
        firstFailures,
      );
    } else if (mode === "--updater-static") {
      const previousArg = rest.find((arg) => arg.startsWith("--previous-tag="));
      const dirArg = rest.find((arg) => !arg.startsWith("-"));
      if (!dirArg) throw new Error("配布物フォルダーを指定してください");
      await checkUpdaterStatic(root, path.resolve(dirArg), process.env, {
        previousTag: previousArg?.slice("--previous-tag=".length),
        previous,
      });
    } else {
      if (!mode || mode.startsWith("-"))
        throw new Error(
          "使い方: node scripts/release/acceptance.mjs [--previous=stable|<tag>] <archive>",
        );
      await acceptance(root, path.resolve(mode), process.env, firstFailures, {
        previous,
      });
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    reportFirstFailures(firstFailures);
  }
}
