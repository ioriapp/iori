import { spawn, spawnSync } from "node:child_process";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rustChecksHash } from "./ci-rust-hash.mjs";

const evidence = ".local/ci-steps";
const logs = join(evidence, "logs");
const steps = new Map();
const output = [];
let evidenceWritten = Promise.resolve();

function saveSteps() {
  const json = JSON.stringify([...steps.values()], null, 2) + "\n";
  evidenceWritten = evidenceWritten.then(async () => {
    const file = join(evidence, "steps.json");
    await writeFile(file + ".tmp", json);
    await rename(file + ".tmp", file);
  });
  return evidenceWritten;
}

async function execute(log, command, args) {
  const file = await open(log, "w");
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ["ignore", file.fd, file.fd],
      });
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
  } finally {
    await file.close();
  }
}

async function step(name, operation) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const file = join(logs, name + ".log");
  let exitCode;
  if (operation) {
    try {
      exitCode = await operation(file);
    } catch (error) {
      await writeFile(file, error.stack + "\n");
      exitCode = 1;
    }
  }
  const status =
    exitCode === undefined ? "skipped" : exitCode === 0 ? "passed" : "failed";
  const seconds = Number(((performance.now() - started) / 1000).toFixed(3));
  steps.set(name, {
    name,
    startedAt,
    endedAt: new Date().toISOString(),
    seconds,
    status,
    exitCode: exitCode ?? null,
    log: operation ? "logs/" + name + ".log" : null,
  });
  await saveSteps();

  const label = `[${name}] ${status} (${seconds.toFixed(3)}s)`;
  const log = operation ? await readFile(file, "utf8") : "";
  output.push(label);
  process.stdout.write(
    label + "\n" + log + (log && !log.endsWith("\n") ? "\n" : ""),
  );
  return exitCode;
}

const command = (name, executable, ...args) =>
  step(name, (log) => execute(log, executable, args));
const bounded = (name, ...args) =>
  command(name, process.execPath, "scripts/run-bounded-check.mjs", ...args);

const rustSteps = [
  ["rust-fmt-root", "fmt", "--manifest-path", "Cargo.toml", "--all", "--check"],
  [
    "rust-clippy-root",
    "clippy",
    "--manifest-path",
    "Cargo.toml",
    "--workspace",
    "--all-targets",
    "--locked",
    "--",
    "-D",
    "warnings",
  ],
  [
    "rust-fmt-client",
    "fmt",
    "--manifest-path",
    "apps/client/src-tauri/Cargo.toml",
    "--all",
    "--check",
  ],
  [
    "rust-clippy-client",
    "clippy",
    "--manifest-path",
    "apps/client/src-tauri/Cargo.toml",
    "--workspace",
    "--locked",
    "--",
    "-D",
    "warnings",
  ],
  [
    "rust-test-client",
    "test",
    "--manifest-path",
    "apps/client/src-tauri/Cargo.toml",
    "--lib",
    "--locked",
    "--",
    "host_setup::ssh::",
    "updates::release::",
  ],
];

async function checkRust(hash, marker) {
  let cached;
  if (hash) {
    try {
      cached = (await readFile(marker, "utf8")).trim();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  for (const [name, ...args] of rustSteps) {
    if (hash && hash === cached) await step(name);
    else await bounded(name, "cargo", ...args);
  }
  return hash && hash !== cached;
}

function rustInputHash(imageFingerprint) {
  const tools = [
    ["rustc", "--version"],
    ["cargo", "clippy", "--version"],
    ["cargo", "fmt", "--version"],
  ].map(([tool, ...args]) => spawnSync(tool, args, { encoding: "utf8" }));
  if (tools.some(({ status }) => status !== 0)) return undefined;
  const versions = tools.map(({ stdout }) => stdout.trim());
  return rustChecksHash(".", { imageFingerprint, versions });
}

async function main() {
  const docsOnly = process.argv.includes("--docs-only");
  const {
    CARGO_TARGET_DIR: cargoTarget,
    IORI_CI_IMAGE_FINGERPRINT: imageFingerprint,
  } = process.env;
  // Hash the source snapshot before install/build steps generate files.
  const hash =
    !docsOnly && cargoTarget && imageFingerprint
      ? rustInputHash(imageFingerprint)
      : undefined;
  const marker = hash && join(cargoTarget, ".iori-rust-checks-hash");
  await mkdir(logs, { recursive: true });

  const markers = await command(
    "fake-model-markers",
    "bash",
    "-Eeuo",
    "pipefail",
    "-c",
    String.raw`if grep -RFn --include="*.mjs" "[fake-model:" e2e verification | grep -v -e "^e2e/fake-model/marker.mjs:" -e "^verification/fake-model/server.mjs:" -e "^e2e/cli/fixture.mjs:"; then
      echo "偽モデルの印はfakeMarker helperを使ってください。" >&2
      exit 1
    fi`,
  );
  if (markers) return markers;
  if (!docsOnly && cargoTarget && imageFingerprint) {
    const prep = await command(
      "cargo-prepare",
      "node",
      "scripts/clean-copied-cargo.mjs",
    );
    if (prep) return prep;
  }
  const install = await command(
    "pnpm-install",
    "pnpm",
    "install",
    "--frozen-lockfile",
    "--prefer-offline",
  );
  if (install) return install;

  const docsChecks = [
    bounded("wording", "node", "scripts/wording/check.mjs"),
    bounded("docs", "pnpm", "check:docs"),
  ];
  let saveHash;
  if (docsOnly) {
    await Promise.all([
      ...docsChecks,
      bounded("format", "pnpm", "format:check"),
    ]);
  } else {
    const parallelSuites = process.env.IORI_CI_PARALLEL_SUITES === "1";
    const licenses = bounded("licenses", "node", "scripts/licenses/check.mjs");
    // NAPI writes the native addon and regenerates its TypeScript declarations.
    const native = await bounded(
      "build-native",
      "pnpm",
      "--filter",
      "@iori/host",
      "build:native",
    );
    const clientBuild = bounded(
      "client-build",
      "pnpm",
      "--filter",
      "@iori/client",
      "build",
    );
    const checkStatic = () =>
      Promise.all([
        licenses,
        ...docsChecks,
        bounded("format", "pnpm", "format:check"),
        bounded("typecheck", "pnpm", "check"),
        bounded("lint", "pnpm", "lint"),
        !native &&
          bounded(
            "terminal-daemon-compatibility",
            "node",
            "scripts/terminal-daemon-compatibility.mjs",
          ),
      ]);
    const checks = parallelSuites ? undefined : checkStatic();
    await clientBuild;
    const tests = !native && bounded("test", "pnpm", "test");
    const testUi = () =>
      !native &&
      bounded(
        "e2e-ui",
        "node",
        "node_modules/@playwright/test/cli.js",
        "test",
        "--config=e2e/ui/playwright.config.ts",
      );
    if (parallelSuites) {
      // Run static checks after the browser workers exit, while Host API tests finish.
      await testUi();
      await checkStatic();
      await tests;
      saveHash = await checkRust(hash, marker);
    } else {
      await checks;
      saveHash = await checkRust(hash, marker);
      await tests;
      await testUi();
    }
  }
  await command("git-diff", "git", "diff", "--check", "HEAD");
  if ([...steps.values()].some(({ status }) => status === "failed")) return 1;
  if (saveHash) {
    const temporary = marker + "." + process.pid;
    await writeFile(temporary, hash + "\n");
    await rename(temporary, marker);
  }
  return 0;
}

try {
  process.exitCode = await main();
} finally {
  process.stdout.write("\nCI step timings\n" + output.join("\n") + "\n");
}
