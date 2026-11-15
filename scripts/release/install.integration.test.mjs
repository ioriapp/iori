import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const storageModuleUrl = new URL(
  "../../apps/host/src/storage.ts",
  import.meta.url,
).href;

/** Extracts `Environment="KEY=VALUE"` lines from a generated systemd unit. */
function parseUnitEnvironment(unitText, homeDir) {
  const env = {};
  for (const line of unitText.split(/\r?\n/u)) {
    const match = /^Environment="(XDG_DATA_HOME)=((?:[^"\\]|\\.)*)"$/u.exec(
      line,
    );
    if (!match) continue;
    const unescaped = match[2].replace(/\\(.)/gu, (_, ch) => ch);
    env[match[1]] = unescaped.replace(/%(.)/gu, (full, spec) => {
      if (spec === "%") return "%";
      if (spec === "h") return homeDir;
      return full;
    });
  }
  return env;
}

async function createInstallFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "iori-install-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const home = join(root, "home");
  const bin = join(root, "bin");
  const bundleSrc = join(root, "bundle-src");
  const serviceEvents = join(root, "service-events.jsonl");
  await mkdir(home, { recursive: true });
  await mkdir(bin, { recursive: true });
  await mkdir(bundleSrc, { recursive: true });

  await writeFile(join(bundleSrc, "terminal-daemon.mjs"), "process.exit(0);\n");
  await writeFile(
    join(bundleSrc, "cli.mjs"),
    `import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { storageRoot } from ${JSON.stringify(storageModuleUrl)};

const args = process.argv.slice(2);
if (args.length === 0) {
  const dir = storageRoot();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "control.json"), JSON.stringify({ port: 49999, token: "test-token" }));
  appendFileSync(
    ${JSON.stringify(serviceEvents)},
    JSON.stringify({ xdgDataHome: process.env.XDG_DATA_HOME ?? null, root: dir }) + "\\n",
  );
} else if (args[0] === "invite") {
  const dir = storageRoot();
  try {
    readFileSync(join(dir, "control.json"), "utf8");
  } catch {
    process.stderr.write("Hostが起動していません。先にHostを起動してください。\\n");
    process.exitCode = 1;
  }
  if (!process.exitCode) {
    process.stdout.write("INVITE_OK:" + dir + "\\niori://pair?test=1\\n");
  }
}
`,
  );
  await writeFile(
    join(bundleSrc, "iori-host"),
    `#!/bin/sh\nroot=$(CDPATH= cd -- "$(dirname -- "$(readlink -f -- "$0")")" && pwd)\nexec "${process.execPath}" "$root/cli.mjs" "$@"\n`,
    { mode: 0o755 },
  );

  const archivePath = join(root, "iori-host-linux-x64.tar.gz");
  await run("tar", ["-czf", archivePath, "-C", bundleSrc, "."]);
  const archiveBytes = await readFile(archivePath);
  const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");

  const server = createServer((req, res) => {
    if (req.url === "/releases/latest/download/iori-host-linux-x64.tar.gz") {
      res.writeHead(200, { "Content-Length": archiveBytes.length });
      res.end(archiveBytes);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  const { port } = server.address();

  const installerTemplate = await readFile(
    resolve("scripts/release/install.sh"),
    "utf8",
  );
  const installerScript = installerTemplate.replace(
    "__IORI_RELEASE_SOURCE__",
    () => `http://127.0.0.1:${port}/releases`,
  );
  const installerPath = join(root, "install.sh");
  await writeFile(installerPath, installerScript, { mode: 0o755 });

  await writeFile(
    join(bin, "loginctl"),
    `#!/bin/sh
if [ "$1" = "show-user" ]; then
  printf 'yes\\n'
fi
exit 0
`,
    { mode: 0o755 },
  );

  // Shim systemctl: runs ExecStart in a clean manager environment without the
  // invoking shell's XDG_DATA_HOME, applying only unit Environment= lines.
  const systemctlScript = `#!${process.execPath}
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const home = process.env.HOME;
const unitPath = join(home, ".config/systemd/user/iori-host.service");
const parseEnv = ${parseUnitEnvironment.toString()};

const isStart =
  (args[0] === "--user" && args[1] === "enable" && args[2] === "--now") ||
  (args[0] === "--user" && args[1] === "restart");

if (isStart) {
  const unitText = readFileSync(unitPath, "utf8");
  const unitEnv = parseEnv(unitText, home);
  const execMatch = /^ExecStart="(.*)"$/mu.exec(unitText);
  if (!execMatch) throw new Error("ExecStart missing in unit");
  execFileSync(execMatch[1], [], {
    env: {
      HOME: home,
      PATH: process.env.PATH,
      ...unitEnv,
    },
    stdio: "inherit",
  });
}
`;
  await writeFile(join(bin, "systemctl"), systemctlScript);
  await chmod(join(bin, "systemctl"), 0o755);

  const unitPath = join(home, ".config/systemd/user/iori-host.service");

  async function runInstall(extraEnv = {}) {
    return run("sh", [installerPath], {
      env: {
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        IORI_EXPECTED_SHA256: archiveSha256,
        ...extraEnv,
      },
    });
  }

  async function readUnit() {
    return readFile(unitPath, "utf8");
  }

  async function readServiceEvents() {
    const raw = await readFile(serviceEvents, "utf8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  return { root, home, runInstall, readUnit, readServiceEvents };
}

test(
  "初めての導入で空白・%・引用符を含む XDG_DATA_HOME が unit に書かれ、Host と招待が同じ保存先を見る",
  { skip: process.platform !== "linux" },
  async (t) => {
    const fx = await createInstallFixture(t);
    const customXdg = join(fx.root, 'data "quoted" %h \\ dir');
    const { stdout } = await fx.runInstall({ XDG_DATA_HOME: customXdg });
    const unit = await fx.readUnit();
    assert.match(
      unit,
      /^Environment="XDG_DATA_HOME=.*data \\"quoted\\" %%h \\\\ dir"$/mu,
    );
    assert.equal(parseUnitEnvironment(unit, fx.home).XDG_DATA_HOME, customXdg);
    assert.equal((await fx.readServiceEvents()).at(-1).xdgDataHome, customXdg);
    assert.match(stdout, /iori:\/\/pair\?test=1/u);
    assert.ok(stdout.includes(`INVITE_OK:${join(customXdg, "iori-host")}`));
  },
);

test(
  "XDG_DATA_HOME が未設定・相対パス・制御文字を含む初回導入では unit に書かず既定の保存先を見る",
  { skip: process.platform !== "linux" },
  async (t) => {
    for (const extraEnv of [
      {},
      { XDG_DATA_HOME: "relative/data" },
      { XDG_DATA_HOME: "/tmp/bad\ndir" },
    ]) {
      const fx = await createInstallFixture(t);
      const { stdout } = await fx.runInstall(extraEnv);
      assert.doesNotMatch(await fx.readUnit(), /XDG_DATA_HOME/u);
      assert.equal((await fx.readServiceEvents()).at(-1).xdgDataHome, null);
      const defaultRoot = join(fx.home, ".local/share/iori-host");
      assert.ok(stdout.includes(`INVITE_OK:${defaultRoot}`));
    }
  },
);

test(
  "更新時は前の unit の XDG_DATA_HOME 行がそのまま残り、シェルの値が違っても変わらない",
  { skip: process.platform !== "linux" },
  async (t) => {
    const fx = await createInstallFixture(t);
    const originalXdg = join(fx.root, 'orig "data" %h \\ dir');
    await fx.runInstall({ XDG_DATA_HOME: originalXdg });
    const firstLine = (await fx.readUnit())
      .split("\n")
      .find((line) => line.startsWith('Environment="XDG_DATA_HOME='));
    assert.ok(firstLine);

    await fx.runInstall({ XDG_DATA_HOME: join(fx.root, "other-shell-xdg") });
    assert.ok((await fx.readUnit()).split("\n").includes(firstLine));
    assert.equal(
      (await fx.readServiceEvents()).at(-1).xdgDataHome,
      originalXdg,
    );

    await fx.runInstall();
    assert.ok((await fx.readUnit()).split("\n").includes(firstLine));
    assert.equal(
      (await fx.readServiceEvents()).at(-1).xdgDataHome,
      originalXdg,
    );
  },
);

test(
  "更新時に前の unit に XDG_DATA_HOME がなければシェルの値があっても書かない",
  { skip: process.platform !== "linux" },
  async (t) => {
    const fx = await createInstallFixture(t);
    await fx.runInstall();
    assert.doesNotMatch(await fx.readUnit(), /XDG_DATA_HOME/u);

    await fx.runInstall({ XDG_DATA_HOME: join(fx.root, "later-shell-xdg") });
    assert.doesNotMatch(await fx.readUnit(), /XDG_DATA_HOME/u);
    assert.equal((await fx.readServiceEvents()).at(-1).xdgDataHome, null);
  },
);
