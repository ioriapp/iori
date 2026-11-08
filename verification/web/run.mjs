import {
  readmeShotsScenario,
  prepareReadmeRepository,
} from "../../e2e/web/readme-shots.mjs";
import { runReadmeThemes } from "./readme-shots.mjs";
import { startFakeModel } from "../fake-model/server.mjs";
import { setRealModels } from "../../e2e/fake-model/marker.mjs";
import { longApprovalCommand } from "../../e2e/fake-model/cli-status.mjs";
import {
  basicWebScenarios,
  teamWebScenarios,
  childLifecycleScenarios,
  cliDefinitionScenarios,
} from "./scenarios.mjs";
import { hostInvitationSwitch } from "./host-invitation-switch.mjs";
import { hostUpdateMark } from "./host-update-mark.mjs";
import { prepareCliErrorFixture } from "./cli-error-fixture.mjs";
import { teamCommand } from "./team-command.mjs";
import { prepareForgeFixture } from "./forge-fixture.mjs";
import { startDisposableForgejo } from "../forge/forgejo-container.mjs";
import { chromiumExecutable } from "./browser.mjs";
import {
  prepareRemovalHost,
  hostUninstallScenario,
  startRemovalHost,
} from "./host-uninstall.mjs";
import {
  prepareHostDistribution,
  startUpdateHost,
} from "../updates/host-distribution.mjs";
import {
  hostMaintenancePreview,
  hostMaintenanceEmpty,
  hostMaintenanceScenario,
} from "./host-maintenance.mjs";
import {
  boundTerminalDaemon,
  terminalDaemonEvidence,
} from "../terminal/daemon-process.mjs";
import { prepareHostReplacement } from "../terminal/host-replacement.mjs";
import { terminalDaemonScenario } from "./terminal-daemon.mjs";
import { updateDistribution } from "./updates.mjs";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { constants } from "node:fs";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  access,
} from "node:fs/promises";
import { basename, dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createSocket } from "node:dgram";
import { createConnection } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  FrameDecoder,
  decodeFrame,
  encodeFrame,
  inviteToText,
  parseResponse,
} from "../../packages/protocol/src/index.ts";
import { startWebHost } from "./host.mjs";
import { startWeb } from "./dev.mjs";
import { localCache } from "../native/cache.mjs";
import { recordCurrentMemoryEvidence } from "../process-memory.mjs";
import { cleanStaleRuns, pruneScreenshots } from "./cleanup.mjs";
import {
  ui,
  waitFor,
  Cdp,
  observeOperations,
  observeCliQuiet,
  withUiAbort,
} from "../ui.mjs";
import {
  prepareCliHome,
  stopCliProcesses,
  piAgentDirectory,
} from "../cli/home.mjs";
import { cliRecordSummary, teamDeliverySummary } from "../cli/records.mjs";
import { HostStore } from "../../apps/host/src/store.ts";
import { removeCliHooks } from "../../apps/host/src/cli/hook-install.ts";
import { discoverShells } from "../../apps/host/src/terminal/shells.ts";
import { focusTerminal } from "../../e2e/cli-screen/scenario.mjs";
import { submitToCli } from "../../e2e/cli-screen/input.mjs";
import { prepareReadingTree } from "../reading/responsiveness-fixture.mjs";
import {
  observeLauncher,
  launcherObservation,
} from "./launcher-observation.mjs";

setRealModels(process.argv.includes("--real-models"));
const { fakeModelScenarios } = await import("./fake-model-scenarios.mjs");
const { webScenario } = await import("../../e2e/web/scenario.mjs");

const updateHosts = [];
const root = resolve(import.meta.dirname, "../..");
const started = performance.now();
const evidenceRoot = resolve(
  root,
  process.env.IORI_VERIFICATION_EVIDENCE_ROOT ?? ".local/evidence/web",
);
const evidence = resolve(
  evidenceRoot,
  `run-${Date.now()}-${randomUUID().slice(0, 8)}`,
);
const result = {
  passed: false,
  phases: [],
  cleanup: false,
  ptyDimensions: [],
  node: { version: process.version, executable: process.execPath },
};
let hostLog = "";
let phaseStart = { at: new Date().toISOString(), time: performance.now() };
function recordPhase(name, details = {}) {
  const now = performance.now();
  result.phases.push({
    name,
    ...details,
    startedAt: phaseStart.at,
    seconds: Number(((now - phaseStart.time) / 1000).toFixed(3)),
  });
  phaseStart = { at: new Date().toISOString(), time: now };
}
const termination = new globalThis.AbortController();
const stopObserving = observeOperations((name, phase) => {
  if (phase) {
    result.phases.push(phase);
    if (phase.failed) result.failedPhase = phase.name;
    return;
  }
  result.currentOperation = name;
  if (name) {
    result.lastOperation = name;
    delete result.failedPhase;
  }
}, termination.signal);
const stopObservingCliQuiet = observeCliQuiet(
  () =>
    page?.evaluate(`(async () => {
      const { connection } = await import('/src/connection.ts');
      await window.cliQuietObservation;
      const hosts = connection.getSnapshot().connectedHosts;
      const responses = await Promise.all(hosts.map(async host => {
        try { return await connection.requestHost(host, 'terminal.list', {}); }
        catch { return undefined; }
      }));
      return {
        failed: !responses.some(response => response?.ok),
        terminals: responses.flatMap(response => response?.ok ? response.result.terminals : []),
        progress: window.cliQuietProgress.count,
      };
    })()`),
  (quiet) => {
    if (
      !result.longestCliQuiet ||
      quiet.seconds > result.longestCliQuiet.seconds
    )
      result.longestCliQuiet = quiet;
  },
);
// `timeout` signals both this process and its process group, so SIGTERM can
// arrive twice. Keep the handler until finally so neither ends the process.
const terminate = () => {
  if (termination.signal.aborted) return;
  result.interrupted = "SIGTERM";
  result.interruptedOperation =
    result.currentOperation ?? result.lastUiOperation;
  termination.abort(
    new Error(`SIGTERM: ${result.interruptedOperation ?? "操作列の準備"}`),
  );
};
process.on("SIGTERM", terminate);
function startObservedWebHost(distribution, options = {}) {
  return startWebHost(distribution, {
    ...options,
    cliEnvironment: cliHome?.environment,
    ...(only === "readme-shots" ? { fixtureHostName: "workstation" } : {}),
    onPtyDimensions: (entry) => result.ptyDimensions.push(entry),
    onLog: (chunk) => {
      hostLog = (hostLog + chunk.toString("utf8")).slice(-65536);
    },
  });
}
let runRoot,
  browser,
  host,
  web,
  page,
  cliHome,
  hostDistribution,
  additionalHost,
  forgeFixture,
  forgeTokenFixture,
  cliErrorFixture,
  fakeModel;
const originalHome = process.env.HOME;
const diagnostics = [];
let listRequests = 0;
let eventFault;
let childrenUnavailable = false;
let failedChildConversation;
const childListRequests = [];
let childDisplayBoard;
let childDisplayChild;
let childDisplayTerminal;
let notificationEmit;
let unavailableChildrenRequests = 0;
let deliveryWorker;
const launcherHistory = [];
// host.uninstall results: the statuses the Host answered before it stopped.
const uninstallStatuses = [];
const cliUpdates = new Map();
const cliUpdateSenders = new Map();
const cliUpdateSources = new Map();
const terminalTransport = new Map();
const completedTerminalResponses = new Set();
// Keep the selected display state on the event stream for the whole fixture,
// just as teams.board responses do. Real queued-child updates can arrive later.
const childDisplayEvent = (json) => {
  if (!childDisplayChild) return json;
  const event = JSON.parse(json);
  const replace = (child) =>
    child.id === childDisplayChild.id ? childDisplayChild : child;
  if (event.type === "teams.child.updated") event.child = replace(event.child);
  else if (event.type === "teams.children")
    event.children = event.children.map(replace);
  else if (
    event.type === "terminal.updated" &&
    event.terminal.id === childDisplayTerminal?.id
  )
    event.terminal = childDisplayTerminal;
  return JSON.stringify(event);
};
const only =
  process.argv.find((arg) => arg.startsWith("--only="))?.split("=")[1] ??
  (process.argv.includes("--only")
    ? process.argv[process.argv.indexOf("--only") + 1]
    : undefined);
if (!only || only.startsWith("--"))
  throw new Error(
    `--only=<操作列> を1つ指定してください。基本の操作列: ${Object.keys(basicWebScenarios).join(", ")}`,
  );
const readmeTheme = process.argv
  .find((arg) => arg.startsWith("--readme-theme="))
  ?.split("=")[1];
if (only === "readme-shots" && !readmeTheme) {
  await runReadmeThemes(import.meta.filename);
  process.exit(0);
}
const basicScenario = basicWebScenarios[only];
const fakeModelScenario = fakeModelScenarios[only];
const fakeModelClis = process.argv.includes("--real-models")
  ? []
  : (fakeModelScenario?.clis ?? []);
result.realModels = process.argv.includes("--real-models");
result.fakeModelClis = fakeModelClis;
result.scenario = only;
const updates = ["client-update", "host-update", "client-host-update"].includes(
  only,
)
  ? await updateDistribution({ clientRestart: only === "client-host-update" })
  : undefined;
const teamScenario = [
  "readme-shots",
  ...teamWebScenarios,
  "automations",
  "repo-delegation",
  "board-activity",
  "opencode-delegation",
  ...childLifecycleScenarios,
  "child-cli-failure",
  "terminal-daemon",
  "host-update",
  "host-uninstall",
].includes(only);
// Team CLI fixtures must not inherit this checkout's CLAUDE.md, rules or MCP.
// /tmp is tmpfs on the verification host; CLI runtime caches belong on disk.
const runsRoot = process.env.IORI_WEB_RUNS_ROOT ?? "/var/tmp/iori-web-runs";

function git(cwd, ...args) {
  const run = spawnSync(
    "git",
    [
      "-c",
      "user.name=iori E2E",
      "-c",
      "user.email=e2e@example.invalid",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error("検証用Git fixtureを作れませんでした");
  return run.stdout;
}
async function hostPort() {
  const socket = createSocket("udp4");
  try {
    await new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, "127.0.0.1", resolve);
    });
    return socket.address().port;
  } finally {
    socket.close();
  }
}
async function invitation(dataRoot) {
  // Same authenticated local Host control as `iori invite`; never record the token/invite.
  const control = JSON.parse(
    await readFile(join(dataRoot, "iori-host/control.json"), "utf8"),
  );
  const socket = createConnection({ host: "127.0.0.1", port: control.port });
  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.end(
      Buffer.from(
        encodeFrame({
          token: control.token,
          operationId: randomUUID(),
          method: "invite.create",
          params: {},
        }),
      ),
    );
    const decoder = new FrameDecoder();
    for await (const chunk of socket) {
      for (const payload of decoder.push(chunk)) {
        const value = decodeFrame(payload);
        if (value && typeof value === "object" && "ok" in value) {
          const response = parseResponse("invite.create", value);
          if (!response.ok) throw new Error("検証Hostの招待を作れませんでした");
          return inviteToText(response.result.invite);
        }
      }
    }
    throw new Error("検証Hostの招待streamが終了しました");
  } finally {
    socket.destroy();
  }
}

try {
  await cleanStaleRuns(runsRoot, import.meta.filename);
  await pruneScreenshots(evidenceRoot, basename(evidence), result.scenario);
  // Use the existing LXC installation only. No package/browser download fallback.
  const modulePath =
    process.env.IORI_PLAYWRIGHT_MODULE ??
    "/root/.pi/agent/npm/node_modules/playwright/index.mjs";
  let chromium;
  try {
    ({ chromium } = await import(pathToFileURL(resolve(modulePath))));
  } catch {
    throw new Error(
      "既存のPlaywrightを読み込めません。IORI_PLAYWRIGHT_MODULEで既存の導入先を指定してください。自動installはしません。",
    );
  }
  let executablePath = await chromiumExecutable(chromium);
  await mkdir(evidence, { recursive: true });
  runRoot = await mkdtemp(join(runsRoot, "run-"));
  process.env.TMPDIR = join(runRoot, "tmp");
  await mkdir(process.env.TMPDIR);
  await writeFile(join(runRoot, "owner.pid"), String(process.pid), {
    mode: 0o600,
  });
  // Chromium temporarily changes cwd to its binary directory when loading
  // SwiftShader. Isolate that directory so its CPU renderer can use two workers
  // without modifying the installed browser or disabling WebGL coverage.
  // https://swiftshader.googlesource.com/SwiftShader/+/HEAD/docs/RuntimeConfiguration.md
  const browserConfig = "[Processor]\nThreadCount=2\n";
  const browserVersion = execFileSync(executablePath, ["--version"], {
    encoding: "utf8",
  }).trim();
  const browserKey = createHash("sha256")
    .update(
      JSON.stringify([resolve(executablePath), browserVersion, browserConfig]),
    )
    .digest("hex");
  // This cache also survives release source copies and is shared by all groups.
  const browserCache = join(localCache, "web-browser");
  const browserRoot = join(browserCache, browserKey);
  try {
    await access(browserRoot);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(browserCache, { recursive: true });
    const preparing = await mkdtemp(join(browserCache, ".preparing-"));
    try {
      await cp(dirname(executablePath), preparing, {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
      });
      await writeFile(join(preparing, "SwiftShader.ini"), browserConfig);
      try {
        // Only a complete directory becomes visible to other runs. If another
        // run published first, keep its copy and remove only our temporary one.
        await rename(preparing, browserRoot);
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
      }
    } finally {
      await rm(preparing, { recursive: true, force: true });
    }
  }
  executablePath = join(browserRoot, basename(executablePath));
  const dataRoot = join(runRoot, "host-data");
  // No daily data/49171, no SSH/ADB. Only this run's directories/process handles.
  process.env.XDG_DATA_HOME = dataRoot;
  process.env.IORI_HOST_PORT = String(await hostPort());
  const inputrc = join(runRoot, "inputrc");
  await writeFile(inputrc, "set enable-bracketed-paste on\n");
  // Only this run's child shells read the fixture; the user's file is intact.
  process.env.INPUTRC = inputrc;
  // Both CLIs use their standard directories in this run's isolated HOME.
  // omp also reads Pi's legacy directory variables: setting them for Pi
  // makes even `omp models --json` migrate Pi's settings out of its way.
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  const repository =
    only === "readme-shots"
      ? join(runRoot, "cli-home", "projects", "acme-web")
      : join(runRoot, "repository");
  const worktree =
    only === "readme-shots"
      ? join(runRoot, "cli-home", "projects", "acme-web-login")
      : join(runRoot, "worktree");
  const secondRepository = join(runRoot, "second-repository");
  if (only === "repo-delegation") {
    await mkdir(join(secondRepository, "nested"), { recursive: true });
    git(secondRepository, "init", "-b", "main");
    await writeFile(
      join(secondRepository, "sample.txt"),
      "Second repository\n",
    );
    await writeFile(
      join(secondRepository, ".gitignore"),
      ".iori-child-setup-root\n",
    );
    git(secondRepository, "add", ".");
    git(secondRepository, "commit", "-m", "Create second repository");
    git(secondRepository, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(secondRepository, "checkout", "-b", "local-only");
    await writeFile(
      join(secondRepository, "local-only.txt"),
      "Not the default base\n",
    );
    git(secondRepository, "add", ".");
    git(
      secondRepository,
      "commit",
      "-m",
      "Distinguish local HEAD from origin/main",
    );
  }
  await mkdir(repository, { recursive: true });
  git(repository, "init", "-b", "main");
  await writeFile(join(repository, "sample.txt"), "変更前の行\n");
  git(repository, "add", "sample.txt");
  git(repository, "commit", "-m", "Create browser fixture");
  const initialCommit = git(repository, "rev-parse", "HEAD").trim();
  await mkdir(join(repository, "commit-files"));
  // More than the actual page of 128 files, while its first page remains small.
  await Promise.all(
    Array.from({ length: 160 }, (_, index) =>
      writeFile(
        join(
          repository,
          "commit-files",
          `file-${String(index).padStart(3, "0")}.txt`,
        ),
        `commit file ${index}\n`,
      ),
    ),
  );
  git(repository, "add", "commit-files");
  git(repository, "commit", "-m", "再接続後もcommitのファイルを読む");
  const commits = {
    initial: initialCommit,
    large: git(repository, "rev-parse", "HEAD").trim(),
  };
  git(repository, "worktree", "add", "-b", "browser", worktree);
  await writeFile(
    join(worktree, "sample.txt"),
    "ブラウザーからファイルを読む\n",
  );

  if (only === "readme-shots")
    await prepareReadmeRepository({ repository, worktree });

  forgeFixture = ["forge-status", "forge-issues", "forge-issue-start"].includes(
    only,
  )
    ? await prepareForgeFixture(runRoot)
    : undefined;
  forgeTokenFixture = [
    "forge-token",
    "forge-commands",
    "automation-issue",
  ].includes(only)
    ? await startDisposableForgejo(runRoot, {
        automationIssue: only === "automation-issue",
      })
    : undefined;

  if (only === "reading-responsiveness") await prepareReadingTree(worktree);

  if (only !== "readme-shots")
    await writeFile(
      join(worktree, "approval-command.txt"),
      longApprovalCommand,
    );
  if (fakeModelClis.length)
    fakeModel = await startFakeModel({
      scripts: fakeModelScenario.scripts,
    });
  cliHome = await prepareCliHome(runRoot, {
    ...(only === "readme-shots" ? { claudeTheme: readmeTheme } : {}),
    fakeModel,
    fakeModelClis,
    fakeModelCodexAccount: fakeModelScenario?.codexAccount ?? false,
    clis: basicScenario?.clis ?? fakeModelScenario?.clis ?? [],
    repositories:
      only === "repo-delegation"
        ? [repository, secondRepository]
        : only === "automation-issue"
          ? [repository, forgeTokenFixture.clonePath]
          : [repository],
    codexDefaults: teamScenario,
    // A CLI from a definition also starts trusted and runs team commands.
    teamCommands:
      teamScenario ||
      only === "cli-omp" ||
      cliDefinitionScenarios.includes(only) ||
      only === "cli-definition-plugin",
    // Claude Code starts in these folders as in folders the user trusted.
    ...(only === "worktree-create" ? { trustedFolders: [repository] } : {}),
    ...(only === "forge-issue-start"
      ? {
          trustedFolders: [
            repository,
            forgeFixture.repository,
            forgeFixture.githubRepository,
            ...(forgeTokenFixture ? [forgeTokenFixture.clonePath] : []),
          ],
        }
      : {}),
    // Show shell-mode results without a model reading/acknowledging notices again.
    // https://code.claude.com/docs/en/interactive-mode#shell-mode-with--prefix
    ...(teamScenario ? { respondToBashCommands: false } : {}),
  });
  if (only === "automation-issue")
    await forgeTokenFixture.issueSetup.configureGit(cliHome.home);
  if (only === "team-notifications") {
    const bin = join(cliHome.home, "notification-bin");
    await mkdir(bin);
    await writeFile(
      join(bin, "opencode"),
      `#!${process.execPath}
import {writeFileSync} from 'node:fs';
if(process.argv.includes('--version')){console.log('1.19.2');process.exit(0);}
writeFileSync(${JSON.stringify(join(runRoot, "notification-hook-url"))}, process.env.IORI_CLI_HOOK_URL ?? '', {mode:0o600});
process.stdin.resume();
`,
      { mode: 0o700 },
    );
    const profile = join(cliHome.home, ".profile");
    await writeFile(
      profile,
      (await readFile(profile, "utf8")) + `export PATH='${bin}':"$PATH"\n`,
    );
    await mkdir(join(dataRoot, "iori-host"), { recursive: true });
    const store = new HostStore(join(dataRoot, "iori-host", "host.sqlite"));
    store.setLastUsedCli("opencode");
    store.close();
  }
  result.cli = cliHome.versions;
  process.env.HOME = cliHome.home;
  process.env.CODEX_HOME = join(cliHome.home, ".codex");
  process.env.CLAUDE_CONFIG_DIR = join(cliHome.home, ".claude");
  process.env.VOLTA_HOME ??= join(originalHome, ".volta");
  process.env.XDG_CONFIG_HOME = join(cliHome.home, ".config");
  if (only === "child-cli-failure") {
    // The TUI replaces unknown model IDs with a working default. Register
    // the model and let the real CLI receive a non-retryable API error.
    cliErrorFixture = await prepareCliErrorFixture(
      "iori-verification-unavailable-model",
    );
    const config = join(process.env.XDG_CONFIG_HOME, "opencode");
    await mkdir(config, { recursive: true });
    await writeFile(
      join(config, "opencode.json"),
      JSON.stringify({
        provider: {
          opencode: {
            npm: "@ai-sdk/openai-compatible",
            options: {
              baseURL: cliErrorFixture.baseURL,
              apiKey: "verification",
            },
            models: {
              "iori-verification-unavailable-model": {
                name: "Unavailable verification model",
                limit: { context: 32000, output: 1000 },
              },
            },
          },
        },
      }),
    );
  }
  if (only === "opencode-delegation") {
    // Make both approvals explicit: the product plugin may allow team-files,
    // while the scenario must still answer the report command's bash approval.
    const config = join(process.env.XDG_CONFIG_HOME, "opencode");
    await mkdir(config, { recursive: true });
    await writeFile(
      join(config, "opencode.json"),
      JSON.stringify({
        ...JSON.parse(
          await readFile(join(config, "opencode.json"), "utf8").catch(
            () => "{}",
          ),
        ),
        permission: { bash: "ask", external_directory: "ask" },
        ...(Number(cliHome.versions.opencode?.match(/\bv?(\d+)\./u)?.[1]) >= 2
          ? { model: "opencode/deepseek-v4.1-flash-free" }
          : {}),
      }),
    );
  }
  if (
    teamScenario ||
    ["forge-issue-start", "automation-issue"].includes(only)
  ) {
    // This fixture represents a Host whose user already opened both CLIs.
    // Host prepares their real hooks; no lifecycle events are fabricated.
    await mkdir(join(dataRoot, "iori-host"), { recursive: true });
    const store = new HostStore(join(dataRoot, "iori-host", "host.sqlite"));
    store.setLastUsedCli("claude");
    store.setLastUsedCli("codex");
    if (only === "opencode-delegation") store.setLastUsedCli("opencode");
    store.close();
  }
  const notificationParent = join(worktree, "notification-parent.mjs");
  if (
    [
      "team-notifications",
      "child-running",
      "child-rows",
      "worktree-removal",
    ].includes(only)
  )
    await writeFile(
      notificationParent,
      `import {createInterface} from 'node:readline';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {appendFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(join(runRoot, "notification-pids"))},JSON.stringify({pid:process.pid,cwd:process.cwd()})+'\\n');
const input=createInterface({input:process.stdin}); console.log('Notification parent ready');
input.on('line',async line=>{if(!line.startsWith('DELEGATE'))return;const options=line==='DELEGATE'?{}:JSON.parse(line.slice(9));try{const output=await promisify(execFile)('iori',['delegate','--role','Worker','--difficulty',options.difficulty??'low','--title',options.title??'Candidate notification','--worktree',options.worktree??'parent','--body','Check candidate availability.','--json']);console.log(output.stdout);}catch(error){console.error(error.message);}});`,
    );
  const replacement = process.argv.includes("--replace-host-distribution")
    ? await prepareHostReplacement(runRoot)
    : undefined;
  if (replacement) result.terminalRuntimeFootprint = replacement.footprint;
  if (only === "host-uninstall") {
    hostDistribution = await prepareRemovalHost(runRoot, cliHome.home);
    host = await startRemovalHost(hostDistribution, dataRoot, {
      cliEnvironment: cliHome.environment,
    });
  } else if (["host-update", "client-host-update"].includes(only)) {
    hostDistribution = await prepareHostDistribution(runRoot);
    host = await startUpdateHost(hostDistribution, dataRoot, {
      cliEnvironment: cliHome.environment,
    });
    if (only === "client-host-update") hostDistribution.publishGood();
  } else host = await startObservedWebHost(replacement?.distribution);
  termination.signal.throwIfAborted();
  await mkdir(join(worktree, "offline-folder"));
  // Vite reports an optimizer failure in its log and still exits 0, so keep
  // the output in the run log.
  const [preparationCode, preparationSignal] = await once(
    spawn(
      process.execPath,
      [resolve(root, "verification/web/dev.mjs"), "--prepare-dependencies"],
      { signal: termination.signal, stdio: "inherit" },
    ),
    "exit",
  );
  if (preparationCode !== 0)
    throw new Error(
      `Viteの依存の準備が失敗: exit ${preparationSignal ?? preparationCode}`,
    );
  let heldChildrenResponse;
  web = await startWeb({
    storageRoot: join(runRoot, "client-data"),
    updateSource: updates?.source,
    hostUninstall: only === "host-uninstall",
    port: 0,
    onTerminalEvent: ({ stage, streamId, kind, waiting }) => {
      const state = terminalTransport.get(streamId) ?? {
        streamId,
        received: 0,
        acknowledged: 0,
      };
      if (stage === "receive") {
        state.received++;
        state.lastFrameKind = kind;
        state.lastReceivedAt = Date.now();
      } else if (waiting) {
        state.acknowledged++;
        state.lastAcknowledgedAt = Date.now();
      }
      terminalTransport.set(streamId, state);
    },
    onHostEventStream: ({ connectionId, subscriptionId }, emit) => {
      cliUpdateSenders.set(connectionId, {
        subscriptionId,
        emit: (json) => emit(childDisplayEvent(json)),
      });
      cliUpdateSources.set(connectionId, "events");
      notificationEmit = emit;
    },
    onEvent: (payload, emit) => {
      const event = JSON.parse(payload.json);
      // A visible Terminal acknowledges done immediately and becomes idle.
      // Retain the actual hook completion, rather than polling past it.
      if (
        event.type === "terminal.updated" &&
        event.terminal.cliStatus?.state === "done"
      )
        completedTerminalResponses.add(event.terminal.id);
      // Files/Git watch streams also carry events; injected Host events belong
      // on the Host event stream, not on whichever stream spoke last.
      if (event.type === "reading.changed") return;
      if (
        cliUpdateSenders.get(payload.connectionId)?.subscriptionId ===
        payload.subscriptionId
      )
        cliUpdateSources.set(payload.connectionId, event.type ?? "response");
      payload.json = childDisplayEvent(payload.json);
      eventFault?.(payload, emit);
    },
    onResponse: async (method, json) => {
      if (method === "teams.children" && heldChildrenResponse?.armed) {
        heldChildrenResponse.armed = false;
        heldChildrenResponse.snapshot = JSON.parse(json);
        await heldChildrenResponse.released;
      }
      // Trust the created path before the Client can launch Claude Code there.
      // Its exact path also covers worktrees whose names the Host generated.
      if (only === "worktree-create" && method === "worktrees.create") {
        const response = JSON.parse(json);
        if (response.ok && response.result.state === "created")
          await cliHome.trustFolders([response.result.path]);
        return;
      }
      if (method === "host.uninstall" || method === "host.uninstall.result") {
        const response = JSON.parse(json);
        if (response.ok) uninstallStatuses.push(response.result);
        return;
      }
      if (method !== "cli.list") return;
      const response = JSON.parse(json);
      if (!response.ok) return;
      // Usage may be unavailable, or unchanged since before this subscription.
      // Its absence is also a valid update (it removes a previously shown value).
      // Reuse the Host's actual list values, never a made-up remaining quota.
      for (const cli of response.result.clis) {
        if (cli.supportsUsage)
          cliUpdates.set(
            "cli.usage",
            JSON.stringify({
              type: "cli.usage",
              cliId: cli.id,
              usage: cli.usage,
            }),
          );
        if (cli.version)
          cliUpdates.set(
            "cli.version",
            JSON.stringify({
              type: "cli.version",
              shell: response.result.shell,
              cliId: cli.id,
              version: cli.version,
            }),
          );
      }
    },
    onRequest: (method, params) => {
      if (method === "teams.children") {
        const failed =
          !!failedChildConversation &&
          params?.conversation === failedChildConversation;
        childListRequests.push({ conversation: params?.conversation, failed });
        if (failed)
          return JSON.stringify({
            ok: false,
            error: { code: "internal_error" },
          });
      }
      if (method === "files.list") listRequests++;
      if (method === "teams.board" && childDisplayBoard)
        return JSON.stringify({ ok: true, result: childDisplayBoard });
      if (method === "teams.children" && childrenUnavailable) {
        unavailableChildrenRequests++;
        return JSON.stringify({ ok: false, error: { code: "internal_error" } });
      }
    },
    transformResponse: (method, json) => {
      if (
        !childDisplayChild ||
        !["teams.children", "terminal.list"].includes(method)
      )
        return json;
      const response = JSON.parse(json);
      if (!response.ok) return json;
      if (method === "teams.children")
        response.result.children = response.result.children.map((child) =>
          child.id === childDisplayChild.id ? childDisplayChild : child,
        );
      else if (childDisplayTerminal) {
        const terminals = response.result.terminals;
        response.result.terminals = terminals.map((terminal) =>
          terminal.id === childDisplayTerminal.id
            ? childDisplayTerminal
            : terminal,
        );
        if (
          !terminals.some((terminal) => terminal.id === childDisplayTerminal.id)
        )
          response.result.terminals.push(childDisplayTerminal);
      }
      return JSON.stringify(response);
    },
  });
  // The finally block closes Chromium after the failure screenshot.
  browser = await chromium.launch({
    executablePath,
    handleSIGTERM: false,
    headless: true,
    // Keep scrollbars visible as in the desktop Client.
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: ["--no-sandbox"],
  });
  result.playwright = {
    modulePath,
    executablePath,
    browserVersion: browser.version(),
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: only === "readme-shots" ? "en-US" : "ja-JP",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const clientFor = async (targetPage) => {
    await targetPage.addInitScript({
      content: `if (window.location.origin === ${JSON.stringify(new URL(web.url).origin)}) {
        window.cliQuietObservation = import('/src/connection.ts').then(({ connection }) => {
        const fingerprints = new Map();
        const progress = window.cliQuietProgress = { count: 0 };
        connection.subscribeHostEvents((host, event) => {
          if (event.type !== 'terminal.updated') return;
          const { id, cliStatus } = event.terminal;
          const fingerprint = JSON.stringify({
            state: cliStatus?.state,
            outcome: cliStatus?.outcome,
            attention: cliStatus?.attention,
            activity: cliStatus?.activity,
            since: cliStatus?.since,
          });
          const key = JSON.stringify([host, id]);
          if (fingerprints.get(key) !== fingerprint) {
            fingerprints.set(key, fingerprint);
            progress.count++;
          }
        });
      });
      }`,
    });
    // Android WebView overlays scrollbars instead of reserving their width.
    await targetPage.addInitScript({
      content: `document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "@media (max-width: 767px) { * { scrollbar-width: none !important; } }";
        document.head.appendChild(style);
      });`,
    });
    await observeLauncher(targetPage, web.url);
    targetPage.on("pageerror", (error) => {
      diagnostics.push(
        error.message.includes("invalid location")
          ? "Dockview: invalid location"
          : "Chromiumで未処理のJavaScript例外",
      );
      (result.pageErrors ??= []).push({
        at: new Date().toISOString(),
        message: error.message,
        stack: error.stack?.split("\n").slice(0, 5),
      });
    });
    targetPage.on("console", (message) => {
      if (message.type() === "error")
        diagnostics.push("Chromium console error");
    });
    const cdp = await targetPage.context().newCDPSession(targetPage);
    const evaluate = (expression) =>
      withUiAbort(() => targetPage.evaluate(expression));
    const client = {
      screenshot: (name) =>
        targetPage.screenshot({ path: join(evidence, name + ".png") }),
      screen: ui(evaluate, {
        key: async (key) => {
          await targetPage.bringToFront();
          await targetPage.keyboard.press(key);
        },
        evaluateAsync: evaluate,
        tap: (at) =>
          Cdp.prototype.tap.call(
            { call: (method, params) => cdp.send(method, params) },
            at,
          ),
        longPress: (at) =>
          Cdp.prototype.longPress.call(
            { call: (method, params) => cdp.send(method, params) },
            at,
          ),
        longPressDrag: (from, to, held) =>
          Cdp.prototype.longPressDrag.call(
            { call: (method, params) => cdp.send(method, params) },
            from,
            to,
            held,
          ),
        swipe: (from, to) =>
          Cdp.prototype.swipe.call(
            { call: (method, params) => cdp.send(method, params) },
            from,
            to,
          ),
        drag: (from, to) =>
          Cdp.prototype.drag.call(
            { call: (method, params) => cdp.send(method, params) },
            from,
            to,
          ),
      }),
      browser: {
        drag: (from, to) =>
          Cdp.prototype.drag.call(
            { call: (method, params) => cdp.send(method, params) },
            from,
            to,
          ),
        viewport: (size) => targetPage.setViewportSize(size),
        evaluate,
        evaluateAsync: evaluate,
        call: (method, params) => cdp.send(method, params),
      },
    };
    const click = client.screen.click;
    client.screen.click = async (selector, options) => {
      result.lastUiOperation = selector;
      await targetPage.bringToFront();
      return click(selector, options);
    };
    const wait = client.screen.wait;
    client.screen.wait = async (selector) => {
      result.lastUiOperation = selector;
      return wait(selector);
    };
    return client;
  };
  termination.signal.throwIfAborted();
  page = await context.newPage();
  let client = await clientFor(page);
  await page.goto(web.url);
  recordPhase("準備");
  const observeAfterReload = async () => {
    const { observe } = await import("../../e2e/terminal/scenario.mjs");
    await observe(
      client,
      "(await import('/src/native-platform-web.ts')).listen",
    );
  };
  await (
    only === "host-update-mark"
      ? hostUpdateMark
      : only === "host-invitation-switch"
        ? hostInvitationSwitch
        : only === "readme-shots"
          ? readmeShotsScenario
          : ["terminal-daemon", "host-update", "host-uninstall"].includes(only)
            ? terminalDaemonScenario
            : webScenario
  )({
    readmeTheme,
    readmeRecording: (() => {
      let recordingContext, videoStarted;
      return {
        async open() {
          const previousPage = page;
          recordingContext = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            locale: "en-US",
            colorScheme: readmeTheme,
            permissions: ["clipboard-read", "clipboard-write"],
            recordVideo: {
              dir: join(evidence, "video"),
              size: { width: 1440, height: 1000 },
            },
          });
          videoStarted = Date.now();
          page = await recordingContext.newPage();
          client = await clientFor(page);
          await previousPage.close();
          await page.goto(web.url);
          await client.screen.wait('[data-iori-state="connected"]');
          return client;
        },
        mark: () => (Date.now() - videoStarted) / 1000,
        async close() {
          const video = page.video();
          page = undefined;
          await recordingContext.close();
          return video.path();
        },
      };
    })(),
    readmePrivacyFile: join(originalHome, ".config", "iori", "publish.json"),
    readmeEvidence: evidence,
    fakeModelRequests: fakeModel?.requests,
    hostRemoval:
      only === "host-uninstall"
        ? async () =>
            hostUninstallScenario({
              client,
              fixture: hostDistribution,
              dataRoot,
              worktree,
              cliHome,
              uninstallStatuses,
              invitation: () => invitation(dataRoot),
              disconnect: () => host.close(),
              reload: () => page.reload(),
              reinstall: async () => {
                await host.close();
                host = await startRemovalHost(hostDistribution, dataRoot, {
                  cliEnvironment: cliHome.environment,
                });
              },
              record: (name, details) => recordPhase(name, details),
              shot: (name) =>
                page.screenshot({ path: join(evidence, name + ".png") }),
              mobile: () => page.setViewportSize({ width: 400, height: 900 }),
              desktop: () =>
                page.setViewportSize({ width: 1440, height: 1000 }),
            })
        : undefined,
    hostMaintenanceEmpty:
      only === "host-update"
        ? () =>
            hostMaintenanceEmpty({
              client,
              hostRoot: join(dataRoot, "iori-host"),
              shot: (name) =>
                page.screenshot({ path: join(evidence, name + ".png") }),
            })
        : undefined,
    hostMaintenancePreview:
      only === "host-update"
        ? (details) =>
            hostMaintenancePreview({
              client,
              worktree,
              hostRoot: join(dataRoot, "iori-host"),
              ...details,
              record: (name, details) => recordPhase(name, details),
              shot: (name) =>
                page.screenshot({ path: join(evidence, name + ".png") }),
            })
        : undefined,
    hostMaintenance:
      only === "host-update"
        ? async (details) =>
            hostMaintenanceScenario({
              client,
              fixture: hostDistribution,
              updates,
              hostRoot: join(dataRoot, "iori-host"),
              unit: host.unit,
              ...details,
              record: (name, details) => recordPhase(name, details),
              shot: async (name) =>
                page.screenshot({ path: join(evidence, name + ".png") }),
              mobile: () => page.setViewportSize({ width: 400, height: 900 }),
              desktop: () =>
                page.setViewportSize({ width: 1440, height: 1000 }),
            })
        : undefined,
    clipboardFiles: async (id) => {
      const directory = join(dataRoot, "iori-host", "terminal-images", id);
      let names;
      try {
        names = await readdir(directory);
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
      return Promise.all(
        names
          .filter((name) => /\.(png|jpe?g)$/u.test(name))
          .map(async (name) => {
            const bytes = await readFile(join(directory, name));
            return {
              name,
              path: join(directory, name),
              size: bytes.length,
              png: bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
            };
          }),
      );
    },
    only,
    forgeFixture,
    forgeTokenFixture,
    hostData: join(runRoot, "host-data", "iori-host"),
    createPlainFolder: () => mkdtemp(join(runRoot, "folder-")),
    additionalHost: async ({ interruptions = false } = {}) => {
      const dataRoot = join(
        runRoot,
        only === "client-host-update"
          ? `additional-host-data-${updateHosts.length}`
          : "additional-host-data",
      );
      if (only === "host-update-mark") {
        hostDistribution = await prepareHostDistribution(runRoot);
        additionalHost = await startObservedWebHost(hostDistribution.bundle, {
          dataRoot,
          port: await hostPort(),
        });
      } else if (only === "client-host-update") {
        const bundle = join(
          runRoot,
          `additional-host-bundle-${updateHosts.length}`,
        );
        await cp(hostDistribution.bundle, bundle, { recursive: true });
        if (interruptions) {
          // A real older terminal daemon requires stopping its running work.
          const protocol = join(bundle, "src/terminal/daemon/protocol.js");
          const source = await readFile(protocol, "utf8");
          await writeFile(
            protocol,
            source.replace(
              /DAEMON_PROTOCOL = (\d+)/u,
              (_, value) => `DAEMON_PROTOCOL = ${Number(value) - 1}`,
            ),
          );
        }
        additionalHost = await startUpdateHost(
          { ...hostDistribution, bundle },
          dataRoot,
          { port: await hostPort() },
        );
        updateHosts.push(additionalHost);
      } else
        additionalHost = await startObservedWebHost(undefined, {
          dataRoot,
          port: await hostPort(),
        });
      return invitation(dataRoot);
    },
    stopAdditionalUpdateHost: async (start = false) => {
      execFileSync("systemctl", [
        "--user",
        start ? "start" : "stop",
        updateHosts[0].unit,
      ]);
    },
    reload: () => page.reload(),
    // The two-approval script exists only in the fake model; a real model
    // is not asked to follow it, and the notification check needs no model.
    missedWaiting: result.realModels
      ? undefined
      : async (terminalId) => {
          const hostInfo = await page.evaluate(async () => {
            const { connection } = await import("/src/connection.ts");
            return connection.getSnapshot().host;
          });
          await page.goto("about:blank");
          await web.sendTerminalInput(
            hostInfo.publicKey,
            hostInfo.addresses,
            terminalId,
            "\r",
          );
          await waitFor(
            async () => {
              const response = await web.requestHost(
                hostInfo.publicKey,
                hostInfo.addresses,
                "terminal.list",
                {},
              );
              return (
                response.ok &&
                response.result.terminals.find(
                  (terminal) => terminal.id === terminalId,
                )?.cliStatus
              );
            },
            (status) =>
              status?.state === "waiting" &&
              status.attention?.summary?.includes("approval-b"),
          );
          await page.addInitScript({
            content:
              "window.__reopenedNotices=[];window.addEventListener('iori:notification-request',e=>window.__reopenedNotices.push(e.detail));",
          });
          await page.goto(web.url);
          await observeAfterReload();
        },
    changeReadingFile: (contents) =>
      writeFile(join(worktree, "sample.txt"), contents),
    updates,
    replayCliUpdate: async (connectionId, type) => {
      // A metadata value need not change during this run. Use the real Host's
      // current list, including versions probed after the initial list response.
      const json = await waitFor(
        async () => {
          await page.evaluate(
            async ({ id, request }) => {
              const { native } = await import("/src/native.ts");
              await native.request(id, request);
            },
            {
              id: connectionId,
              request: JSON.stringify({
                kind: "request",
                operationId: randomUUID(),
                method: "cli.list",
                params: {},
              }),
            },
          );
          return cliUpdates.get(type);
        },
        Boolean,
        undefined,
        `再送するHostの${type}イベント`,
      );
      const emit = await waitFor(
        () => cliUpdateSenders.get(connectionId)?.emit,
        Boolean,
        undefined,
        "再読込後のHostイベントの送信先",
      );
      (result.replayedCliEvents ??= []).push({
        type,
        valueSource: "cli.list",
        senderSource: cliUpdateSources.get(connectionId),
      });
      emit(json);
    },
    notificationHook:
      only === "team-notifications"
        ? async (payload) => {
            const url = await waitFor(async () =>
              readFile(join(runRoot, "notification-hook-url"), "utf8").catch(
                () => "",
              ),
            );
            // The payload stands in for OpenCode's iori plugin, which
            // names its CLI.
            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...payload, iori_cli: "opencode" }),
            });
            assert.equal(response.status, 204);
          }
        : undefined,
    notificationCommand: `${process.execPath} ${notificationParent}`,
    childListFault: {
      requests: childListRequests,
      fail: (conversation) => {
        failedChildConversation = conversation;
      },
      reload: async () => {
        await page.reload();
        await client.screen.wait('[data-iori-state="connected"]');
      },
    },
    notificationBeforeChildrenSnapshot: async (terminalId) => {
      await page.evaluate(async () => {
        const { native } = await import("/src/native.ts");
        await native.saveView("notification-seen", {});
      });
      let release;
      heldChildrenResponse = {
        armed: true,
        released: new Promise((resolve) => {
          release = resolve;
        }),
      };
      await page.addInitScript({
        content: `window.__candidateNotifications=[];window.__earlyChildEvents=[];
          window.addEventListener('iori:notification-request',e=>window.__candidateNotifications.push(e.detail));
          import('/src/connection.ts').then(({connection})=>{
            connection.subscribeHostEvents((_host,event)=>{
              if(event.type==='teams.child.updated')window.__earlyChildEvents.push(event.child);
            });
            window.__earlyChildReady=true;
          });`,
      });
      try {
        await page.reload();
        const snapshot = await waitFor(
          () => heldChildrenResponse.snapshot,
          Boolean,
          undefined,
          "最初の子の一覧を保留",
        );
        assert.ok(
          snapshot.ok &&
            snapshot.result.children.some((child) => child.notified),
        );
        await waitFor(
          () => page.evaluate("window.__earlyChildReady"),
          Boolean,
          undefined,
          "子の更新の観測を開始",
        );
        await focusTerminal(client, terminalId);
        await submitToCli(
          client,
          'DELEGATE {"title":"Early candidate notification"}',
          undefined,
          "early-candidate-notification",
        );
        await waitFor(
          () => page.evaluate("window.__earlyChildEvents"),
          (children) =>
            children.some(
              (child) =>
                child.title === "Early candidate notification" &&
                child.notified,
            ),
          undefined,
          "保留中の候補なし更新",
        );
      } finally {
        release();
        heldChildrenResponse = undefined;
      }
      await observeAfterReload();
    },
    notificationPids: join(runRoot, "notification-pids"),
    notificationSourceFault: (unavailable, terminal, state) => {
      childrenUnavailable = unavailable;
      if (state) {
        // Deliver the CLI event independently of unchanged team settings.
        notificationEmit(
          JSON.stringify({
            type: "terminal.updated",
            terminal: {
              ...terminal,
              cliStatus: {
                state,
                since: Date.now(),
                ...(state === "waiting"
                  ? {
                      attention: {
                        kind: "approval",
                        summary: "Recorded approval",
                      },
                    }
                  : {}),
              },
            },
          }),
        );
      }
      return unavailableChildrenRequests;
    },
    childDisplayFixture: (child, board, terminal) => {
      childDisplayBoard = board;
      childDisplayChild = board ? child : undefined;
      childDisplayTerminal = board ? terminal : undefined;
      for (const { emit } of cliUpdateSenders.values()) {
        if (terminal)
          emit(JSON.stringify({ type: "terminal.updated", terminal }));
        if (child) emit(JSON.stringify({ type: "teams.child.updated", child }));
      }
    },
    teamCommand: teamCommand(
      join(dataRoot, "iori-host"),
      process.env.CLAUDE_CONFIG_DIR,
    ),
    teamDelivery: async (notice, child) => {
      if (deliveryWorker)
        deliveryWorker.initialHookDone = completedTerminalResponses.has(
          deliveryWorker.terminalId,
        );
      if (deliveryWorker?.terminalId && !deliveryWorker.sessionId) {
        const db = new DatabaseSync(
          join(dataRoot, "iori-host", "host.sqlite"),
          {
            readOnly: true,
          },
        );
        try {
          const cli = db
            .prepare("SELECT value FROM terminal_clis WHERE terminal_id = ?")
            .get(deliveryWorker.terminalId);
          deliveryWorker.sessionId = cli
            ? JSON.parse(cli.value).session?.id
            : undefined;
        } finally {
          db.close();
        }
      }
      const delivery = await teamDeliverySummary(
        join(cliHome.home, ".codex"),
        process.env.CLAUDE_CONFIG_DIR,
        notice,
        child ? { role: child.roleName, title: child.title } : deliveryWorker,
      );
      if (child) {
        result.teamDeliveryByChild ??= {};
        result.teamDeliveryByChild[child.id] = delivery;
      }
      result.teamDelivery = delivery;
      return delivery;
    },
    teamRecords: async () => {
      const db = new DatabaseSync(join(dataRoot, "iori-host", "host.sqlite"), {
        readOnly: true,
      });
      try {
        const children = db
          .prepare("SELECT value_json FROM team_children")
          .all()
          .map((row) => JSON.parse(row.value_json));
        const worker = children.find((entry) => entry.roleName === "Worker");
        if (!deliveryWorker && worker)
          deliveryWorker = {
            role: worker.roleName,
            title: worker.title,
            terminalId: worker.terminalId,
          };
        if (deliveryWorker && !deliveryWorker.terminalId)
          deliveryWorker.terminalId = worker?.terminalId;
        return {
          terminals: db
            .prepare("SELECT terminal_id, value FROM terminal_clis")
            .all()
            .map((row) => ({
              id: row.terminal_id,
              value: JSON.parse(row.value),
            })),
          children,
          tasks: db
            .prepare("SELECT value_json FROM team_tasks")
            .all()
            .map((r) => JSON.parse(r.value_json)),
        };
      } finally {
        db.close();
      }
    },
    withConnectionOffline: async (inspect) => {
      await web.setOffline(true);
      try {
        await inspect();
        await writeFile(join(worktree, ".retention-output"), "");
        await waitFor(
          () =>
            access(join(worktree, ".retention-done")).then(
              () => true,
              () => false,
            ),
          Boolean,
        );
      } finally {
        await web.setOffline(false);
      }
    },
    malformedEvent: (enabled) => {
      eventFault = enabled
        ? (payload, emit) => {
            if (JSON.parse(payload.json).type === "terminal.updated") {
              eventFault = undefined;
              emit("{");
            }
          }
        : undefined;
    },
    oversizedAttention: (enabled) => {
      if (!enabled) {
        assert.equal(result.oversizedAttention?.injected, true);
        assert.equal(result.oversizedAttention.hostCharacters <= 4096, true);
        assert.equal(result.oversizedAttention.hostRedacted, true);
      }
      eventFault = enabled
        ? (payload) => {
            const event = JSON.parse(payload.json);
            if (event.terminal?.cliStatus?.attention?.summary) {
              const hostCharacters =
                event.terminal.cliStatus.attention.summary.length;
              const hostRedacted =
                !event.terminal.cliStatus.attention.summary.includes(
                  "token=x",
                ) &&
                event.terminal.cliStatus.attention.summary.includes(
                  "[redacted]",
                );
              event.terminal.cliStatus.attention.summary +=
                " token=[redacted]".repeat(400);
              result.oversizedAttention = {
                hostCharacters,
                hostRedacted,
                injected: true,
                characters: event.terminal.cliStatus.attention.summary.length,
                redacted:
                  event.terminal.cliStatus.attention.summary.includes(
                    "[redacted]",
                  ),
              };
              payload.json = JSON.stringify(event);
            }
          }
        : undefined;
    },
    hooksReady: async () => {
      const { waitFor } = await import("../ui.mjs");
      await waitFor(
        async () =>
          (
            await readFile(join(cliHome.home, ".codex", "config.toml"), "utf8")
          ).match(/trusted_hash/g)?.length >= 2,
      );
    },
    loseTerminalDaemon: async () => {
      const descriptor = JSON.parse(
        await readFile(
          join(dataRoot, "iori-host", "terminal-daemon", "connection.json"),
          "utf8",
        ),
      );
      process.kill(descriptor.pid, "SIGKILL");
      const { waitFor } = await import("../ui.mjs");
      const root = join(dataRoot, "iori-host");
      await waitFor(async () => {
        const next = await readFile(
          join(root, "terminal-daemon", "connection.json"),
          "utf8",
        )
          .then(JSON.parse)
          .catch(() => undefined);
        return next && next.pid !== descriptor.pid;
      });
      await boundTerminalDaemon(root);
    },
    hostReplacement: Boolean(replacement),
    automationDatabase: join(dataRoot, "iori-host", "host.sqlite"),
    ptyDimensions: () =>
      process.env.IORI_WEB_HOST_DISTRIBUTION ? undefined : result.ptyDimensions,
    restartPreservingHost: async (during) => {
      await host.close();
      const descriptor = join(
        dataRoot,
        "iori-host",
        "terminal-daemon",
        "connection.json",
      );
      const before = JSON.parse(await readFile(descriptor, "utf8")).pid;
      await during?.();
      await replacement?.replace();
      host = await startObservedWebHost(replacement?.distribution);
      const after = JSON.parse(await readFile(descriptor, "utf8")).pid;
      assert.equal(after, before);
      result.terminalReplacement = {
        sameDaemonPid: true,
        installDirectoryReplaced: Boolean(replacement),
      };
    },
    resumeScreenEvidence: (value) => {
      result.resumeScreenEvidence = value;
    },
    restartHostLosingTerminals: async ({ terminalId, whileStopped } = {}) => {
      // These existing scenarios exercise cold recovery after losing the PTYs.
      await host.close({ stopTerminals: true });
      let savedSnapshot;
      if (terminalId) {
        // Capture this one row before a new Host can replace it. Only dimensions
        // and boolean comparisons are reported, never snapshot contents.
        const db = new DatabaseSync(
          join(dataRoot, "iori-host", "host.sqlite"),
          {
            readOnly: true,
          },
        );
        try {
          const saved = db
            .prepare("SELECT snapshot_json FROM terminals WHERE id = ?")
            .get(terminalId);
          savedSnapshot = JSON.parse(saved?.snapshot_json ?? "null");
        } finally {
          db.close();
        }
      }
      await whileStopped?.();
      host = await startObservedWebHost();
      return savedSnapshot;
    },
    session: async (id) => {
      const database = new DatabaseSync(
        join(dataRoot, "iori-host", "host.sqlite"),
        { readOnly: true },
      );
      try {
        const row = database
          .prepare("SELECT value FROM terminal_clis WHERE terminal_id = ?")
          .get(id);
        return row ? JSON.parse(row.value) : undefined;
      } finally {
        database.close();
      }
    },
    assistantReply: async (sessionId, expected) => {
      const sessions = join(cliHome.home, ".codex", "sessions");
      const files = await readdir(sessions, { recursive: true });
      for (const file of files.filter((file) => file.endsWith(".jsonl"))) {
        const lines = (await readFile(join(sessions, file), "utf8")).split(
          "\n",
        );
        let sameSession = false;
        for (const line of lines) {
          let item;
          try {
            item = JSON.parse(line);
          } catch {
            continue;
          }
          if (item.type === "session_meta" && item.payload?.id === sessionId)
            sameSession = true;
          if (
            sameSession &&
            item.type === "response_item" &&
            item.payload?.role === "assistant" &&
            item.payload.content?.some?.((content) =>
              content.text?.includes(expected),
            )
          )
            return true;
        }
      }
      return false;
    },
    verifyUnusedHooks: () => cliHome.checkUnusedHooks(),
    preventHookInstall: () => cliHome.preventHookInstall(),
    client,
    invitation: await invitation(dataRoot),
    repository,
    secondRepository,
    worktree,
    finishBackgroundTerminal: () =>
      writeFile(join(worktree, ".pane-exit"), "\n"),
    commits,
    phone: async () => {
      const phoneContext = await browser.newContext({
        hasTouch: true,
        viewport: { width: 400, height: 900 },
        locale: "ja-JP",
      });
      const phonePage = await phoneContext.newPage();
      const phoneClient = await clientFor(phonePage);
      await phonePage.goto(web.url);
      return phoneClient;
    },
    record: async (phase) => {
      recordPhase(phase);
      console.log(phase);
    },
    disconnectedReads: async (expand) => {
      await host.close();
      host = undefined;
      console.log("通信断で読み取りが空回りしないこと: Host停止済み");
      // The UI deliberately delays its reconnecting indication. Wait for that
      // normal state before timing the operation that can starve the page.
      await client.screen.wait('[data-iori-state="disconnected"]');
      let setupTimer;
      try {
        await Promise.race([
          expand(),
          new Promise((_, reject) => {
            setupTimer = setTimeout(
              () =>
                reject(
                  new Error(
                    "通信断で一覧読み取りが空回りし、画面が応答しません",
                  ),
                ),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(setupTimer);
      }
      const samples = [];
      for (let index = 0; index < 3; index++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        // An offline fetch fails before reaching the bridge. A microtask loop
        // must not starve the page, even if the native request count stays zero.
        let timer;
        try {
          await Promise.race([
            page.evaluate("document.readyState"),
            new Promise((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      "通信断で一覧読み取りが空回りし、画面が応答しません",
                    ),
                  ),
                3000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        samples.push(listRequests);
      }
      // Diagnostic only: offline requests fail before reaching the bridge.
      // The page-response checks above detect the actual microtask loop.
      result.disconnectedListRequests = samples;
      await writeFile(
        join(worktree, "offline-folder", "reconnected.txt"),
        "再接続後の一覧\n",
      );
      host = await startObservedWebHost();
    },
    mobile: async (viewport = { width: 400, height: 900 }) => {
      // xterm registers touch gestures when the Terminal is constructed.
      await client.browser.call("Emulation.setTouchEmulationEnabled", {
        enabled: true,
      });
      launcherHistory.push(...(await launcherObservation(page)));
      await page.setViewportSize(viewport);
      await page.reload();
    },
    desktop: async () => {
      await client.browser.call("Emulation.setTouchEmulationEnabled", {
        enabled: false,
      });
      launcherHistory.push(...(await launcherObservation(page)));
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.reload();
      await observeAfterReload();
      // Reload starts connection initialization again. The next scenario may
      // request a Host fixture immediately, before any other UI wait.
      await client.screen.wait('[data-iori-state="connected"]');
    },
    shot: async (name) => {
      const views = process.env.IORI_TEAMS_CAPTURE_VIEWS?.split(",");
      if (
        views &&
        !views.some(
          (view) =>
            name === `pc-${view}-light` ||
            name === `pc-${view}-dark` ||
            name === `mobile-${view}-dark`,
        )
      )
        return;
      await page.evaluate(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      // Opening and closing menus and dialogs finish before the capture;
      // endless ones such as the cursor blink do not hold it.
      await page.evaluate(
        "Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))",
      );
      if (/^(?:pc|mobile)-children-/u.test(name)) {
        const geometry = await page.evaluate(() => {
          const rows = [
            ...globalThis.document.querySelectorAll(".nav-child-button"),
          ].filter((element) => element.getBoundingClientRect().width > 0);
          const parent = globalThis.document.querySelector(
            "[data-iori-terminal-row]",
          );
          const branch = globalThis.document.querySelector(
            ".nav-child-branch > span",
          );
          const canvas = globalThis.document
            .createElement("canvas")
            .getContext("2d");
          if (canvas && branch)
            canvas.font = globalThis.getComputedStyle(branch).font;
          const branchButton = branch?.parentElement;
          const branchStyle =
            branchButton && globalThis.getComputedStyle(branchButton);
          return {
            parent: parent && {
              height: parent.getBoundingClientRect().height,
              left: parent.getBoundingClientRect().left,
              paddingLeft: globalThis.getComputedStyle(parent).paddingLeft,
            },
            children: rows.map((element) => ({
              height: element.getBoundingClientRect().height,
              markLeft: element
                .querySelector(".state-dot")
                .getBoundingClientRect().left,
              parentTitleLeft: element
                .closest(".nav-children")
                .parentElement.querySelector(
                  ":scope > [data-iori-terminal-row] .nav-session-title",
                )
                .getBoundingClientRect().left,
              paddingLeft: globalThis.getComputedStyle(element).paddingLeft,
              paddingY:
                parseFloat(globalThis.getComputedStyle(element).paddingTop) +
                parseFloat(globalThis.getComputedStyle(element).paddingBottom),
              lines: [
                ...element.querySelectorAll(
                  ".nav-child-title, .nav-child-detail",
                ),
              ].map((line) => line.getBoundingClientRect().height),
            })),
            branch: branch && {
              available:
                branchButton.clientWidth -
                parseFloat(branchStyle.paddingLeft) -
                parseFloat(branchStyle.paddingRight) -
                (branchButton.querySelector("svg")?.getBoundingClientRect()
                  .width ?? 0) -
                parseFloat(branchStyle.columnGap),
              rendered: branch.scrollWidth,
              font: globalThis.getComputedStyle(branch).font,
              sample24: canvas?.measureText(
                "iori/abcdefghijklmnopqrstuvwx-01234567",
              ).width,
            },
          };
        });
        result.childRowsGeometry ??= {};
        result.childRowsGeometry[name] = geometry;
        assert.ok(geometry.children.length > 0);
        for (const child of geometry.children) {
          assert.ok(
            child.height >= geometry.parent.height,
            "2段の子の行は親の行より低くならない",
          );
          assert.equal(
            child.markLeft,
            child.parentTitleLeft,
            "子の先頭の印を親の題名の始まりへそろえる",
          );
          assert.equal(child.paddingLeft, geometry.parent.paddingLeft);
          assert.equal(child.lines.length, 2);
          assert.ok(
            child.lines.reduce((sum, height) => sum + height, 0) +
              child.paddingY <=
              child.height,
            "子の2段の内容を行の内側に収める",
          );
        }
      }
      await page.screenshot({ path: join(evidence, `${name}.png`) });
    },
  });
  recordPhase("操作列の終了");
  assert.deepEqual(diagnostics, [], "ブラウザーのconsoleと未処理例外");
  result.passed = true;
} catch (error) {
  recordPhase("失敗", { failed: true });
  result.operationAtFailure =
    result.interruptedOperation ??
    result.failedPhase ??
    result.currentOperation ??
    result.lastOperation ??
    result.lastUiOperation;
  result.terminalTransport = [...terminalTransport.values()];
  await mkdir(evidence, { recursive: true });
  if (host?.unit) {
    const journal = spawnSync(
      "journalctl",
      ["--user", "-u", host.unit, "-n", "200", "--no-pager", "-o", "cat"],
      { encoding: "utf8" },
    );
    hostLog += journal.stdout ?? "";
  }
  const redact = (value) =>
    value.replace(/iori:\/\/\S+|[a-zA-Z0-9_-]{64,}/g, "[redacted]");
  await writeFile(join(evidence, "host.log"), redact(hostLog.slice(-65536)));
  if (page) {
    const { saveOpenTerminalTails } = await import("./terminal-failure.mjs");
    await saveOpenTerminalTails(
      page,
      process.env.XDG_DATA_HOME,
      evidence,
    ).catch(() => {
      result.terminalCaptureFailed = true;
    });
    const { terminalState } = await import("../../e2e/terminal/scenario.mjs");
    result.terminalState = await terminalState({
      screen: { evaluate: (expression) => page.evaluate(expression) },
    }).catch(() => null);
    if (teamScenario && only !== "readme-shots" && process.env.XDG_DATA_HOME) {
      const { saveOpenChildScreens } = await import("./terminal-failure.mjs");
      await saveOpenChildScreens(
        page,
        process.env.XDG_DATA_HOME,
        evidence,
      ).catch(() => {
        result.childScreenCaptureFailed = true;
      });
    }
  }
  // Only the workspace is safe to photograph; never save a registration/QR screen.
  if (
    page &&
    only !== "readme-shots" &&
    process.env.IORI_TEAMS_CAPTURE_VIEWS !== "none" &&
    !String(error.message).includes("空回り") &&
    (await page
      .locator('[data-iori-view="workspace"]')
      .isVisible()
      .catch(() => false))
  )
    await page
      .screenshot({ path: join(evidence, "failure.png") })
      .catch(() => {});
  // Do not dump DOM, RPC, invite-bearing arguments, or raw browser messages.
  result.error = String(error.message)
    .replace(/iori:\/\/\S+|[a-zA-Z0-9_-]{64,}/g, "[redacted]")
    .slice(0, 1024);
  process.exitCode = 1;
} finally {
  process.off("SIGTERM", terminate);
  stopObserving();
  stopObservingCliQuiet();
  if (page)
    result.launcherObservation = [
      ...launcherHistory,
      ...(await launcherObservation(page)),
    ];
  const cleanupErrors = [];
  for (const [name, close] of [
    ["Chromium", () => browser?.close()],
    ["updates", () => updates?.close()],
    ["bridge/Vite", () => web?.close()],
    ["Forge fixture", () => forgeFixture?.close()],
    ["Disposable Forgejo", () => forgeTokenFixture?.close()],
    ["CLI error fixture", () => cliErrorFixture?.close()],
    [
      "Additional Host",
      async () => {
        if (updateHosts.length) {
          for (const item of updateHosts) await item.close();
        } else await additionalHost?.close({ stopTerminals: true });
      },
    ],
    ["Host", () => host?.close({ stopTerminals: true })],
    ["Host distribution", () => hostDistribution?.close()],
    ["Fake model API", () => fakeModel?.close()],
  ]) {
    try {
      await close();
    } catch {
      cleanupErrors.push(name);
    }
  }
  if (cliHome) {
    try {
      await stopCliProcesses(cliHome.home);
      result.cliProcessesStopped = true;
      if (teamScenario)
        result.teamDelivery = await teamDeliverySummary(
          join(cliHome.home, ".codex"),
          process.env.CLAUDE_CONFIG_DIR,
          undefined,
          deliveryWorker,
        );
      result.cliRecords = await cliRecordSummary(
        join(cliHome.home, ".codex"),
        only === "cli-omp"
          ? undefined
          : join(piAgentDirectory(cliHome.home), "sessions"),
        { claudeHome: process.env.CLAUDE_CONFIG_DIR },
      );
      // Actual CLI records cover model choices at startup and resume. Team
      // delegation also checks that the role's effort overrides user arguments.
      if (result.passed) {
        const usedClis =
          basicScenario?.modelClis ??
          (only === "automations"
            ? ["codex", "claude"]
            : teamScenario
              ? [
                  "child-background",
                  "child-claude-resume",
                  "terminal-daemon",
                  "host-update",
                  "host-uninstall",
                  "opencode-delegation",
                ].includes(only) ||
                (only === "board-activity" &&
                  process.env.IORI_BOARD_ACTIVITY_CLI === "claude")
                ? ["claude"]
                : ["claude", "codex"]
              : only === "clipboard"
                ? ["codex", "pi", "claude"]
                : only?.startsWith("clipboard-image")
                  ? [only.split(":")[1] ?? "claude"]
                  : only === "cli-definition-plugin"
                    ? ["pi"]
                    : [
                          "long-approval",
                          "claude-status",
                          "mobile-batch-input",
                          "cli-definition-session",
                          "cli-definition-team",
                        ].includes(only)
                      ? ["claude"]
                      : []);
        for (const cli of usedClis) {
          const records = result.cliRecords[cli];
          if (cli === "claude")
            assert.equal(
              records.models.length > 0 &&
                records.models.every(
                  (model) =>
                    (only === "readme-shots"
                      ? model === "sonnet" || model.startsWith("claude-sonnet-")
                      : model.startsWith("claude-haiku-4-5")) ||
                    (only === "child-cli-failure" &&
                      model === "iori-verification-unavailable-model"),
                ),
              true,
            );
          else {
            assert.deepEqual(
              [...records.models].sort(),
              cli === "pi"
                ? ["openai/gpt-6-luna"]
                : only === "child-cli-failure"
                  ? // The next-candidate continuation is covered by Host E2E.
                    ["iori-verification-unavailable-model"]
                  : ["gpt-6-luna"],
            );
            if (cli === "codex" && only === "team-child-tabs")
              assert.deepEqual(records.efforts, ["low"]);
          }
        }
      }
    } catch (error) {
      cleanupErrors.push("CLI cleanup or model accounting: " + error.message);
    }
    try {
      const shells = await discoverShells();
      await removeCliHooks(
        shells.shells.find((shell) => shell.id === shells.preferred),
        join(runRoot, "host-data", "iori-host"),
      );
      await cliHome.checkRemoval();
      result.hookRemoval = true;
    } catch (error) {
      cleanupErrors.push("hook removal: " + error.message);
    }
    process.env.HOME = originalHome;
    delete process.env.CODEX_HOME;
    delete process.env.PI_CODING_AGENT_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }
  if (runRoot && cleanupErrors.length === 0) {
    try {
      await rm(runRoot, { recursive: true, force: true });
    } catch {
      cleanupErrors.push("run folder");
    }
  }
  try {
    await pruneScreenshots(evidenceRoot, basename(evidence), result.scenario);
  } catch {
    cleanupErrors.push("screenshots");
  }
  if (fakeModel) {
    result.fakeModelRequests = fakeModel.requests;
    result.codexUsesPreviousResponseId = fakeModel.usesPreviousResponseId;
  }
  result.daemonUnits = terminalDaemonEvidence();
  result.cleanup = cleanupErrors.length === 0;
  result.cleanupErrors = cleanupErrors;
  if (cleanupErrors.length) process.exitCode = 1;
  recordPhase("後始末");
  result.seconds = Number(((performance.now() - started) / 1000).toFixed(3));
  result.diagnostics = diagnostics;
  if (process.env.IORI_MEMORY_EVIDENCE_PATH)
    result.memoryEvidenceError = recordCurrentMemoryEvidence(
      process.env.IORI_MEMORY_EVIDENCE_PATH,
    );
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  const oneLine = (value) => String(value).replace(/\s+/g, " ");
  console.log(
    result.passed && result.cleanup
      ? `PASS: ${result.seconds}秒（起動から後始末）。証拠: ${evidence}`
      : `FAIL: 段=${oneLine(result.failedPhase ?? result.scenario ?? "準備")} 待機=${oneLine(result.operationAtFailure ?? "不明")} 証拠=${evidence}`,
  );
}
