import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fakeModelScenarios } from "../../verification/web/fake-model-scenarios.mjs";
import { command, root, version, releaseSource } from "./common.mjs";
import { lockEntry } from "../../verification/native/locks.mjs";
import {
  acceptAndroidRelease,
  AndroidDeviceUnavailableError,
} from "../../verification/native/android-release.mjs";
import {
  runWebScenario,
  WebRunCleanupError,
} from "../../verification/web/runner.mjs";
import { createSourceCopy } from "../../verification/native/source.mjs";
import semver from "semver";

// Full and scoped acceptance share a queue. Idle runners take the next scenario
// in this order, starting the long scenarios first.
const acceptanceConcurrency = 4;
const fullScenarioOrder = [
  "web-cli",
  "child-lifecycle",
  "team-delegation",
  "terminal-preferences",
  "terminal-daemon",
  "child-cli-failure",
  "web-recovery",
  "automations",
  "automation-webhook",
  "automation-issue",
  "child-running",
  "cli-definition",
  "host-update",
  "clipboard",
  "sidebar-order",
  "opencode-delegation",
  "terminal-width-handoff",
  "host-uninstall",
  "worktree-removal",
  "files-transfer",
  "cli-definition-plugin",
  "board-activity",
  "client-host-update",
  "terminal-clipboard",
  "web-terminal",
  "teams",
  "terminal-file-links",
  "worktree-create",
  "child-rows",
  "team-notifications",
  "mobile-batch-input",
  "mobile-images",
  "client-update",
  "mobile-key-band",
  "forge-token",
  "cli-resize",
  "forge-issue-start",
  "reading-responsiveness",
  "forge-commands",
  "forge-status",
  "model-failure",
  "forge-issues",
  "web-workspace",
  "host-invitation-switch",
  "reading-worktrees",
];

// Names accepted by verification/web/run.mjs --only and e2e/web/scenario.mjs.
const scenarioNames = new Set([
  ...fullScenarioOrder,
  "repo-delegation",
  "host-forget",
  "terminal-size-ownership",
  "sidebar-width",
  "pane-resize",
  "pane-actions",
  "pane-maximize",
  "clipboard-transfer",
  "clipboard-image",
  "clipboard-image:claude",
  "clipboard-image:codex",
  "clipboard-image:pi",
  "cli-launcher",
  "cli-omp",
  "cli-settings",
  "terminal-retention",
  "event-tolerance",
  "long-approval",
]);

export function releaseScenarios(args) {
  const option = args.find((arg) => arg.startsWith("--scenarios="));
  if (option === undefined) {
    if (args.includes("--scenarios"))
      throw new Error("--scenarios=<操作列,…> を指定してください");
    return undefined;
  }
  const scenarios = [
    ...new Set(option.slice("--scenarios=".length).split(",")),
  ];
  const unknown = scenarios.filter((name) => !scenarioNames.has(name));
  if (unknown.length)
    throw new Error(
      `存在しない操作列: ${unknown.map((name) => JSON.stringify(name)).join(", ")}。verification/web/run.mjs --only の操作列名を指定してください`,
    );
  return scenarios;
}

export function reportFirstFailures(firstFailures) {
  if (!firstFailures.length) return;
  console.log("分類が要る1回目の失敗（公開前に製品の不具合か確認）:");
  for (const { group, scenario, evidence } of firstFailures)
    console.log(`  ${group}/${scenario}: ${evidence}`);
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
  const option = args.indexOf("--previous-apk");
  let previousApk = option < 0 ? undefined : path.resolve(args[option + 1]);
  const temporary = await mkdtemp(
    path.join(root, ".local/acceptance-android-"),
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
        upgradeOnly: args.includes("--upgrade-only"),
        loadPreviousApk: async () => {
          if (previousApk) return previousApk;
          const previous = await previousAndroidRelease();
          if (!previous) return undefined;
          const download = await fetch(
            `${releaseSource}/download/${encodeURIComponent(previous.tag_name)}/iori-android-arm64.apk`,
          );
          if (!download.ok)
            throw new Error(
              `前の Release の APK の取得に失敗: HTTP ${download.status}`,
            );
          previousApk = path.join(temporary, "previous.apk");
          await writeFile(
            previousApk,
            Buffer.from(await download.arrayBuffer()),
          );
          return previousApk;
        },
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
    await rm(temporary, { recursive: true, force: true });
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
  scenarios,
) {
  const started = performance.now();
  const selected = scenarios ?? fullScenarioOrder;
  const verified = JSON.parse(
    await readFile(
      path.join(cwd, "verification/fake-model/verified.json"),
      "utf8",
    ),
  );
  const checkedClis = Object.keys(verified.clis);
  const versions = {};
  const unavailableVersions = new Set();
  for (const cli of checkedClis) {
    try {
      versions[cli] = execFileSync(cli, ["--version"], {
        cwd,
        env,
        encoding: "utf8",
      }).trim();
    } catch {
      unavailableVersions.add(cli);
      console.log(`[release] ${cli}: 版を取れない`);
    }
  }
  // A release build uses a clean HEAD snapshot in cwd; standalone acceptance
  // uses the worktree itself, including uncommitted instruction changes.
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const diff = spawnSync(
    "git",
    [
      "diff",
      "--quiet",
      verified.instructionsCommit,
      ...(cwd === root ? [] : [head]),
      "--",
      ...verified.instructionFiles,
    ],
    { cwd: root },
  );
  const instructionsChanged =
    diff.error || (diff.status !== 0 && diff.status !== 1) || diff.status === 1;
  if (diff.error || (diff.status !== 0 && diff.status !== 1))
    console.log(
      "[release] 記録の commit を比べられないため指示のファイルを変更扱い",
    );
  const changedClis = [...checkedClis].filter(
    (cli) =>
      unavailableVersions.has(cli) || versions[cli] !== verified.clis[cli],
  );
  if (instructionsChanged)
    console.log(
      `[release] 指示のファイルが変更: 実モデルの対象CLI ${Object.keys(versions).join(", ")}`,
    );
  const verificationScenarios = fullScenarioOrder.filter(
    (scenario) => fakeModelScenarios[scenario],
  );
  const excludedScenarios = Object.keys(fakeModelScenarios).filter(
    (scenario) => !fullScenarioOrder.includes(scenario),
  );
  const realScenarios = new Set(
    selected.filter((scenario) =>
      fakeModelScenarios[scenario]?.clis.some(
        (cli) => instructionsChanged || changedClis.includes(cli),
      ),
    ),
  );
  if (realScenarios.size)
    console.log(
      `[release] 確認済み更新の対象外（全体受入に含まれない操作列）: ${excludedScenarios.join(", ")}`,
    );
  for (const scenario of realScenarios) {
    const reasons = [
      ...(instructionsChanged ? ["指示のファイルが変更"] : []),
      ...fakeModelScenarios[scenario].clis
        .filter((cli) => changedClis.includes(cli))
        .map(
          (cli) =>
            `${cli}: ${verified.clis[cli]} → ${versions[cli] ?? "版を取れない"}`,
        ),
    ];
    console.log(
      `[release] 実モデル ${scenario} (CLI: ${fakeModelScenarios[scenario].clis.join(", ")}): ${reasons.join("、")}`,
    );
  }
  const outOfRangeClis = changedClis.filter(
    (cli) =>
      ![...realScenarios].some((scenario) =>
        fakeModelScenarios[scenario].clis.includes(cli),
      ),
  );
  const outOfRangeMessage = (cli) => {
    const declaredScenarios = Object.keys(fakeModelScenarios).filter(
      (scenario) => fakeModelScenarios[scenario].clis.includes(cli),
    );
    return `[release] ${cli}: ${verified.clis[cli]} → ${versions[cli] ?? "版を取れない"}、宣言に含む操作列が範囲に無い（${declaredScenarios.join(", ")}）`;
  };
  for (const cli of outOfRangeClis) console.log(outOfRangeMessage(cli));
  const completedReal = new Set();
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
    const pending = [...(scenarios ?? fullScenarioOrder)];
    const groups = Array.from(
      { length: Math.min(pending.length, acceptanceConcurrency) },
      (_, index) => `group-${index + 1}`,
    );
    const results = await Promise.allSettled(
      groups.map(async (group, index) => {
        const start = performance.now();
        console.log(
          `[release] acceptance/${group} start ${new Date().toISOString()}`,
        );
        try {
          const source =
            index === 0 ? cwd : path.join(temporary, `source-${group}`);
          if (source !== cwd) {
            // Vite and dependency generation must not share a writable source.
            await createSourceCopy(cwd, source);
            for (const binary of [
              "native/iori_iroh_host_native.node",
              "terminal-native/iori_terminal_native.node",
            ])
              await cp(
                path.join(cwd, "apps/host", binary),
                path.join(source, "apps/host", binary),
              );
            await command(
              process.execPath,
              [
                "scripts/run-bounded-check.mjs",
                "pnpm",
                "install",
                "--frozen-lockfile",
              ],
              { cwd: source, env },
            );
          }
          const failures = [];
          for (
            let scenario = pending.shift();
            scenario !== undefined;
            scenario = pending.shift()
          ) {
            let fakeSucceeded = false;
            for (const realModels of realScenarios.has(scenario)
              ? [false, true]
              : [false]) {
              if (realModels && !fakeSucceeded) {
                console.log(
                  `[release] ${group}/${scenario} 偽の操作列が成功しなかったため実モデルを省略`,
                );
                continue;
              }
              for (const attempt of ["first-attempt", "retry"]) {
                const evidence = path.resolve(
                  executionEvidence,
                  scenario,
                  ...(realModels ? ["real-models"] : []),
                  attempt,
                );
                console.log(
                  `[release] acceptance/${group}/${scenario}${realModels ? "/real-models" : ""}/${attempt} evidence=${evidence}`,
                );
                const attemptStarted = performance.now();
                try {
                  await runWebScenario({
                    cwd: source,
                    host,
                    scenario,
                    evidence,
                    env,
                    realModels,
                  });
                  if (realModels) completedReal.add(scenario);
                  else fakeSucceeded = true;
                  break;
                } catch (error) {
                  if (attempt === "first-attempt")
                    firstFailures.push({
                      group,
                      scenario: realModels
                        ? `${scenario}/real-models`
                        : scenario,
                      evidence,
                    });
                  if (error instanceof WebRunCleanupError) {
                    failures.push(error);
                    break;
                  }
                  if (attempt === "first-attempt") {
                    console.error(
                      `[release] ${group}/${scenario} failed; retrying once with the same distribution: ${error.message}`,
                    );
                  } else
                    failures.push(
                      new Error(`${scenario}: ${error.message}`, {
                        cause: error,
                      }),
                    );
                } finally {
                  console.log(
                    `[release] acceptance/${group}/${scenario}${realModels ? "/real-models" : ""}/${attempt} seconds=${((performance.now() - attemptStarted) / 1000).toFixed(3)}`,
                  );
                }
              }
            }
          }
          if (failures.length)
            throw new AggregateError(
              failures,
              failures.map((error) => error.message).join("; "),
            );
        } catch (error) {
          throw new Error(`${group}: ${error.message}`, { cause: error });
        } finally {
          console.log(
            `[release] acceptance/${group} seconds=${((performance.now() - start) / 1000).toFixed(3)}`,
          );
        }
      }),
    );
    // All runners must finish their own process cleanup before removing source.
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length)
      throw new AggregateError(
        failures,
        `Release受入の失敗: ${failures.map((error) => error.message).join("; ")}`,
      );
    if (realScenarios.size) {
      const proposed = { ...verified, clis: { ...verified.clis } };
      for (const cli of checkedClis) {
        const required = verificationScenarios.filter((scenario) =>
          fakeModelScenarios[scenario].clis.includes(cli),
        );
        const alternatives = Object.keys(fakeModelScenarios).filter(
          (scenario) => fakeModelScenarios[scenario].clis.includes(cli),
        );
        const missing = required.filter(
          (scenario) => !completedReal.has(scenario),
        );
        const confirmed = required.length
          ? !missing.length
          : alternatives.some((scenario) => completedReal.has(scenario));
        if (confirmed && !unavailableVersions.has(cli))
          proposed.clis[cli] = versions[cli];
        else if (!confirmed && changedClis.includes(cli))
          console.log(
            `[release] ${cli} 未確認の操作列: ${(required.length ? missing : alternatives).join(", ")}`,
          );
      }
      const missing = verificationScenarios.filter(
        (scenario) => !completedReal.has(scenario),
      );
      if (instructionsChanged && !missing.length) {
        const uncommittedDiff = spawnSync(
          "git",
          ["diff", "--quiet", head, "--", ...verified.instructionFiles],
          { cwd: root },
        );
        if (uncommittedDiff.status === 0) proposed.instructionsCommit = head;
        else if (uncommittedDiff.status === 1)
          console.log(
            "[release] 指示のファイルに未 commit の変更があるため instructionsCommit は更新しない",
          );
      } else if (instructionsChanged && missing.length) {
        console.log(
          `[release] 指示のファイル 未確認の操作列: ${missing.join(", ")}`,
        );
      }
      const proposalFile = path.join(executionEvidence, "verified.json");
      await writeFile(proposalFile, JSON.stringify(proposed, null, 2) + "\n");
      console.log(
        `[release] verified.json をこの内容へ更新して commit する: ${proposalFile}`,
      );
    }
    for (const cli of outOfRangeClis) console.log(outOfRangeMessage(cli));
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
        releaseScenarios(process.argv.slice(3)),
      );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    reportFirstFailures(firstFailures);
  }
}
