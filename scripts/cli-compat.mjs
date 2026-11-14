import { run } from "node:test";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants, globSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { capabilities } from "../e2e/cli/capabilities.mjs";
import { verificationHostEnvironment } from "../verification/cli/environment.mjs";
import { prepareTemporaryDirectory } from "./cli-compat/temporary.mjs";

const definitions = new Map(
  await Promise.all(
    globSync("apps/host/src/cli/*/definition.json").map(async (file) => {
      const definition = JSON.parse(await readFile(file, "utf8"));
      return [definition.id, definition];
    }),
  ),
);
const preferredOrder = [
  "claude",
  "codex",
  "pi",
  "opencode",
  "omp",
  "cursor",
  "antigravity",
  "muse-code",
];
const order = [
  ...preferredOrder,
  ...[...definitions.keys()]
    .filter((cli) => !preferredOrder.includes(cli))
    .sort(),
];
const selections = process.argv.filter((arg) => arg.startsWith("--only="));
const only = selections[0]?.slice(7);
const realModel = process.argv.includes("--real-model");
if (realModel && (selections.length !== 1 || only !== "claude"))
  throw new Error(
    "本物のモデルの照合は Claude の専用トークンだけで実行します（Owner の決定）",
  );
if (only && !order.includes(only)) throw new Error(`Unknown CLI: ${only}`);
const root = resolve(
  process.env.IORI_CLI_COMPAT_ROOT ??
    join(homedir(), ".local/share/iori-cli-compat"),
);
const startedAt = new Date().toISOString();
await mkdir(join(root, "evidence"), { recursive: true, mode: 0o700 });
const evidence = await mkdtemp(
  join(root, "evidence", `${startedAt.replaceAll(":", "-")}-`),
);
// Volta shims need their installed tool directory even with an isolated HOME.
// Without this, a shim can resolve itself from PATH and repeatedly spawn itself.
process.env.VOLTA_HOME ??= join(homedir(), ".volta");
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const mainSha = execFileSync("git", ["merge-base", "HEAD", "origin/main"], {
  encoding: "utf8",
}).trim();
// Keep Host homes, CLI caches and Unix sockets on disk rather than /tmp tmpfs.
const controller = new AbortController();
let activeAttempt;
let stopping = false;
const temporaryDirectory = await prepareTemporaryDirectory(root, async () => {
  stopping = true;
  controller.abort();
  await activeAttempt?.catch(() => {});
});
process.env.TMPDIR = temporaryDirectory.directory;
const clis = [];

async function installed(command) {
  for (const directory of process.env.PATH.split(delimiter)) {
    try {
      await access(join(directory, command), constants.X_OK);
      return true;
    } catch (error) {
      if (!["ENOENT", "EACCES"].includes(error.code)) throw error;
    }
  }
  return false;
}

async function attempt(cli, number, names) {
  const directory = join(evidence, cli, String(number));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const results = [];
  // run() starts a separate test process; only the fixture's environment reaches its Host.
  process.env.IORI_CLI_COMPAT_EVIDENCE = directory;
  process.env.IORI_CLI_COMPAT_CLI = cli;
  process.env.IORI_CLI_COMPAT_REAL_MODEL = realModel ? "1" : "0";
  let file = join(
    "e2e/cli",
    `${cli}${realModel ? "-real-model" : ""}.test.mjs`,
  );
  try {
    await access(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    file = "e2e/cli/fallback.test.mjs";
  }
  const stream = run({
    signal: controller.signal,
    files: [file],
    concurrency: 1,
    timeout: realModel ? 300000 : 120000,
    ...(names
      ? {
          testNamePatterns: names.map(
            (name) => `^${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`,
          ),
        }
      : {}),
  });
  for await (const event of stream) {
    if (["test:pass", "test:fail"].includes(event.type)) {
      const data = event.data;
      if (
        data.details?.type === "suite" ||
        (names && !names.includes(data.name))
      )
        continue;
      results.push({
        name: data.name,
        status: data.skip
          ? "skipped"
          : data.todo
            ? "todo"
            : event.type === "test:pass"
              ? "passed"
              : "failed",
        durationMs: data.details?.duration_ms,
        ...(data.skip || data.todo ? { reason: data.skip || data.todo } : {}),
        ...(event.type === "test:fail"
          ? {
              error: String(
                data.details?.error?.cause ?? data.details?.error ?? "failed",
              ),
            }
          : {}),
      });
      console.log(`${cli}: ${data.name}: ${results.at(-1).status}`);
    }
    if (["test:diagnostic", "test:stderr", "test:stdout"].includes(event.type))
      await writeFile(
        join(directory, "test.log"),
        JSON.stringify(event) + "\n",
        { flag: "a", mode: 0o600 },
      );
  }
  await writeFile(
    join(directory, "results.json"),
    JSON.stringify(results, null, 2) + "\n",
    { mode: 0o600 },
  );
  return results;
}

try {
  for (const cli of only ? [only] : order) {
    if (stopping) break;
    const definition = definitions.get(cli);
    const [command, ...baseArgs] =
      typeof definition.command === "string"
        ? [definition.command]
        : definition.command.shell.split(/\s+/u);
    if (!(await installed(command))) {
      clis.push({
        cli,
        status: "not-installed",
        reason: "導入なし",
        version: null,
        tests: [],
        durationMs: 0,
      });
      continue;
    }
    const start = performance.now();
    const versionHome = await mkdtemp(join(tmpdir(), "iori-cli-version-"));
    let version;
    let versionError;
    await mkdir(join(versionHome, ".codex"));
    try {
      version = execFileSync(
        command,
        [...baseArgs, ...definition.version.args],
        {
          encoding: "utf8",
          env: {
            ...verificationHostEnvironment(),
            HOME: versionHome,
            CODEX_HOME: join(versionHome, ".codex"),
            CLAUDE_CONFIG_DIR: join(versionHome, ".claude"),
            XDG_CONFIG_HOME: join(versionHome, ".config"),
            XDG_DATA_HOME: join(versionHome, ".local/share"),
            XDG_STATE_HOME: join(versionHome, ".local/state"),
            XDG_CACHE_HOME: join(versionHome, ".cache"),
            PI_CODING_AGENT_DIR: undefined,
            PI_CODING_AGENT_SESSION_DIR: undefined,
            MUSE_NO_AUTO_UPDATE: "1",
            MUSE_LOGIN: "0",
          },
        },
      ).trim();
    } catch (error) {
      version = "unknown";
      versionError = error.code ?? String(error.status);
    } finally {
      await rm(versionHome, { recursive: true, force: true });
    }
    activeAttempt = attempt(cli, 1);
    let tests = await activeAttempt;
    const failed = tests.filter((test) => test.status === "failed");
    if (failed.length && !stopping) {
      activeAttempt = attempt(
        cli,
        2,
        failed.map((test) => test.name),
      );
      const retried = await activeAttempt;
      tests = tests.map((test) =>
        test.status === "failed"
          ? {
              ...(retried.find((retry) => retry.name === test.name) ?? test),
              retried: true,
            }
          : test,
      );
    }
    clis.push({
      cli,
      version,
      ...(versionError ? { versionError } : {}),
      status:
        tests.some((test) => test.status === "failed") || !tests.length
          ? "failed"
          : "passed",
      tests,
      unverified: realModel
        ? []
        : capabilities[cli]?.fakeModel
          ? [
              ...(!capabilities[cli].approval
                ? [{ contract: "承認待ち", reason: "その CLI に機能がない" }]
                : []),
            ]
          : ["入力", "状態", "再開", "子"].map((contract) => ({
              contract,
              reason: "偽の API へ向けられない",
            })),
      durationMs: performance.now() - start,
      evidence: join(evidence, cli),
    });
  }
  await temporaryDirectory.close();
  const failed = clis.flatMap((cli) =>
    cli.tests
      .filter((test) => test.status === "failed")
      .map((test) => ({
        cli: cli.cli,
        version: cli.version,
        test: test.name,
        evidence: cli.evidence,
      })),
  );
  const result = {
    startedAt,
    finishedAt: new Date().toISOString(),
    sha,
    mainSha,
    clis,
    failed,
    evidence,
    ...(realModel ? { realModel: true } : {}),
  };
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  const latest = realModel ? "real-model-latest" : "latest";
  const temporary = join(root, `${latest}-${process.pid}.json`);
  await writeFile(temporary, JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(temporary, join(root, `${latest}.json`));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = clis.some((cli) => cli.status === "failed") ? 1 : 0;
} finally {
  await temporaryDirectory.close();
}
