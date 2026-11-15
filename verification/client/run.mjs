import { spawn } from "node:child_process";
import console from "node:console";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  verificationAndroidPackage,
  verificationIdentifier,
} from "../config.mjs";
import { evidence as buildEvidenceRoot } from "../connection/build.mjs";
import { cleanupFolders } from "../connection/cleanup.mjs";
import { lockEntry } from "../native/locks.mjs";
import { adb, gate } from "../native/remote.mjs";

const defaultSpecs = {
  android: [
    "terminal-input-resize.spec.ts",
    "mobile-terminal-input.spec.ts",
    "usage-status.spec.ts",
    "mobile-background-resume.spec.ts",
  ],
  windows: ["register-first-agent.spec.ts", "terminal-input-resize.spec.ts"],
};

function parseOptions(argv) {
  const options = {
    targets: ["android", "windows"],
    specs: [],
    reuseAndroid: false,
    keepBuild: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--android") {
      options.targets = ["android"];
    } else if (arg === "--client" || arg.startsWith("--client=")) {
      const value = arg.startsWith("--client=") ? arg.slice(9) : argv[++i];
      if (value === "Android") options.targets = ["android"];
      else if (value === "Windows") options.targets = ["windows"];
      else throw new Error(`Unknown --client value: ${value}`);
    } else if (arg === "--apk") {
      options.apk = path.resolve(argv[++i]);
    } else if (arg === "--windows-root") {
      options.windowsRoot = argv[++i];
    } else if (arg === "--windows-exe") {
      options.windowsExe = argv[++i];
    } else if (arg === "--reuse-android") {
      options.reuseAndroid = true;
    } else if (arg === "--keep-build") {
      options.keepBuild = true;
    } else if (arg === "--spec") {
      options.specs.push(argv[++i]);
    } else if (arg === "--evidence") {
      options.evidence = path.resolve(argv[++i]);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function readBuildState() {
  const file = path.join(buildEvidenceRoot, "build-state.json");
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8"));
}

function cleanEnv(extra) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== "CLAUDECODE" && !name.startsWith("CLAUDE_CODE_"),
    ),
  );
  return { ...env, ...extra };
}

function runPlaywright(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.resolve("node_modules/@playwright/test/cli.js"),
        "test",
        "--config=e2e/ui/playwright.config.ts",
        ...args,
      ],
      { stdio: "inherit", env },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve({ exitCode: code ?? 1, signal: signal ?? undefined }),
    );
  });
}

function summarizePlaywrightJson(file) {
  if (!existsSync(file)) return undefined;
  const report = JSON.parse(readFileSync(file, "utf8"));
  const tests = [];
  const visitSuite = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const testEntry of spec.tests ?? []) {
        const lastResult = testEntry.results?.at(-1);
        const annotations = Object.fromEntries(
          (lastResult?.annotations ?? []).map((entry) => [
            entry.type,
            Number.isFinite(Number(entry.description))
              ? Math.round(Number(entry.description))
              : entry.description,
          ]),
        );
        tests.push({
          file: spec.file,
          title: spec.title,
          project: testEntry.projectName,
          status: lastResult?.status ?? "unknown",
          durationMs: lastResult?.duration ?? 0,
          annotations,
        });
      }
    }
    for (const child of suite.suites ?? []) visitSuite(child);
  };
  for (const suite of report.suites ?? []) visitSuite(suite);
  return { stats: report.stats, tests };
}

async function runTarget(target, options, state, runIdBase) {
  const specs = options.specs.length ? options.specs : defaultSpecs[target];
  const runId = `${runIdBase}-${target}`;
  const uiResultsPath = path.resolve(
    ".local/evidence/ui",
    runId,
    "results.json",
  );
  let installMs = 0;

  if (target === "android") {
    const pkg = state.androidPackage ?? verificationAndroidPackage;
    const apk =
      options.apk ??
      (state.androidRoot
        ? path.join(state.androidRoot, "client.apk")
        : undefined);
    const alreadyInstalled = adb([
      "shell",
      "pm",
      "list",
      "packages",
      pkg,
    ]).includes(`package:${pkg}`);
    if (!options.reuseAndroid || !alreadyInstalled) {
      if (!apk || !existsSync(apk)) {
        throw new Error(
          `Android 検証APK が見つかりません (${apk ?? "unset"})。先に verification/connection/build-android.mjs を実行するか --apk を指定してください`,
        );
      }
      const installStarted = performance.now();
      adb(["install", "-r", apk]);
      installMs = Math.round(performance.now() - installStarted);
    }
    const testStarted = performance.now();
    const result = await runPlaywright(
      ["--project=android-client", ...specs],
      cleanEnv({
        IORI_UI_CLIENT_PROJECT: "android-client",
        IORI_UI_SKIP_WEB_SERVER: "1",
        IORI_UI_RUN: runId,
        IORI_UI_ANDROID_PACKAGE: pkg,
        IORI_UI_ANDROID_IDENTIFIER: verificationIdentifier,
        ...(apk ? { IORI_UI_ANDROID_APK: apk } : {}),
      }),
    );
    return {
      target,
      installMs,
      playwrightMs: Math.round(performance.now() - testStarted),
      exitCode: result.exitCode,
      signal: result.signal,
      uiResultsPath,
      summary: summarizePlaywrightJson(uiResultsPath),
    };
  }

  const windowsRoot = options.windowsRoot ?? state.windowsRoot;
  if (!windowsRoot) {
    throw new Error(
      "Windows build root が見つかりません。先に verification/connection/build.mjs --client Windows と run-build.mjs を実行するか --windows-root を指定してください",
    );
  }
  const windowsExe =
    options.windowsExe ??
    `${windowsRoot}\\target\\${state.windowsProfile ?? "debug"}\\iori-client.exe`;
  const testStarted = performance.now();
  const result = await runPlaywright(
    ["--project=windows-client", ...specs],
    cleanEnv({
      IORI_UI_CLIENT_PROJECT: "windows-client",
      IORI_UI_SKIP_WEB_SERVER: "1",
      IORI_UI_RUN: runId,
      IORI_UI_WINDOWS_ROOT: windowsRoot,
      IORI_UI_WINDOWS_EXECUTABLE: windowsExe,
      ...(state.id ? { IORI_UI_WINDOWS_STATE_ID: state.id } : {}),
    }),
  );
  return {
    target,
    installMs: 0,
    playwrightMs: Math.round(performance.now() - testStarted),
    exitCode: result.exitCode,
    signal: result.signal,
    uiResultsPath,
    summary: summarizePlaywrightJson(uiResultsPath),
  };
}

async function main() {
  await lockEntry(import.meta.url);
  const options = parseOptions(process.argv.slice(2));
  const state = readBuildState();
  gate({ requireFreePorts: false });

  const stamp = new Date().toISOString().replaceAll(":", "-");
  const runIdBase = `client-${stamp}-${process.pid}`;
  const evidenceDir =
    options.evidence ?? path.resolve(".local/evidence/client", runIdBase);
  mkdirSync(evidenceDir, { recursive: true });

  const results = [];
  let cleanup;
  try {
    for (const target of options.targets) {
      results.push(await runTarget(target, options, state, runIdBase));
    }
  } finally {
    if (!options.keepBuild && state.id) {
      cleanup = cleanupFolders(state);
    }
    const output = {
      runId: runIdBase,
      keepBuild: options.keepBuild,
      results,
      ...(cleanup ? { cleanup } : {}),
    };
    writeFileSync(
      path.join(evidenceDir, "results.json"),
      JSON.stringify(output, null, 2),
    );
    console.log(JSON.stringify(output, null, 2));
  }

  const failed = results.find((entry) => entry.exitCode !== 0);
  if (failed) {
    process.exitCode = failed.exitCode || 1;
  }
}

await main();
