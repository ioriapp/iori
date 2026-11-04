// Real-shell startup checks complement the UI scenario: custom user profiles
// and extracted shells are isolated here, never installed into the user's HOME.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ShellIntegration } from "../../apps/host/src/terminal/shell-integration.ts";
import { HeadlessEmulator } from "../../apps/host/src/terminal/daemon/headless-emulator.ts";

const require = createRequire(
  new URL("../../apps/host/package.json", import.meta.url),
);
const pty = require("node-pty");
const [packageRoot, evidenceRoot] = process.argv
  .slice(2)
  .map((path) => resolve(path));
if (!packageRoot || !evidenceRoot)
  throw new Error(
    "usage: shell-integration.mjs <extracted Debian packages> <evidence directory>",
  );
await mkdir(evidenceRoot, { recursive: true });
const run = await mkdtemp(join(evidenceRoot, "run-"));
const integration = new ShellIntegration(join(run, "host"));
const results = [];
const write = (file, text) => writeFile(file, text, { mode: 0o600 });
for (const [id, historyStyle] of [
  ["bash", ""],
  ["zsh", "explicit"],
  ["zsh", "prezto"],
  ["fish", ""],
]) {
  const name = `${id}-login${historyStyle ? "-" + historyStyle : ""}`;
  const home = join(run, name);
  const bin = join(home, "iori-bin");
  await mkdir(bin, { recursive: true });
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("IORI_")),
    ),
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    TERM: "xterm-256color",
    IORI_COMMAND_BIN: bin,
  };
  delete env.ZDOTDIR;
  delete env.HISTFILE;
  const rc = `export PATH="$HOME/user-bin:/usr/bin:/bin"
alias startup_alias='printf alias-ok > "$HOME/alias-result"'
PS1='IORI-PROMPT> '
`;
  if (id === "bash") {
    await write(
      join(home, ".bash_profile"),
      `printf profile > "$HOME/loaded"\n. "$HOME/.bashrc"\n`,
    );
    await write(
      join(home, ".bash_login"),
      `printf wrong-profile > "$HOME/loaded"\n`,
    );
    await write(
      join(home, ".profile"),
      `printf wrong-profile > "$HOME/loaded"\n`,
    );
    await write(join(home, ".bashrc"), `${rc}HISTFILE="$HOME/.bash_history"\n`);
    await write(join(home, ".bash_logout"), `printf logout > "$HOME/logout"\n`);
  } else if (id === "zsh") {
    await write(
      join(home, ".zshenv"),
      `module_path=("${packageRoot}/usr/lib/x86_64-linux-gnu/zsh/5.9" $module_path)
printf env > "$HOME/loaded"
`,
    );
    await write(join(home, ".zprofile"), `printf profile >> "$HOME/loaded"\n`);
    await write(
      join(home, ".zshrc"),
      `${rc}${
        historyStyle === "prezto"
          ? 'HISTFILE="${HISTFILE:-${ZDOTDIR:-$HOME}/.zhistory}"'
          : 'HISTFILE="$HOME/.zsh_history"'
      }
SAVEHIST=100
HISTSIZE=100
printf rc >> "$HOME/loaded"
`,
    );
    await write(
      join(home, ".zlogin"),
      `printf login >> "$HOME/loaded"\nexport PATH="$HOME/user-bin:/usr/bin:/bin"\n`,
    );
    await write(join(home, ".zlogout"), `printf logout > "$HOME/logout"\n`);
  } else {
    await mkdir(join(home, ".config", "fish"), { recursive: true });
    await write(
      join(home, ".config", "fish", "config.fish"),
      `set -gx PATH "$HOME/user-bin" /usr/bin /bin
set -g fish_greeting
function fish_prompt; printf 'IORI-PROMPT> '; end
alias startup_alias 'printf alias-ok > "$HOME/alias-result"'
printf config > "$HOME/loaded"
`,
    );
  }
  const shell = {
    id,
    label: id,
    executable:
      id === "bash" ? "/bin/bash" : join(packageRoot, "usr", "bin", id),
    args: ["-l"],
  };
  const ordinaryHistory =
    id === "zsh"
      ? execFileSync(
          shell.executable,
          ["-l", "-i", "-c", 'printf "%s" "$HISTFILE"'],
          {
            env,
            cwd: home,
            encoding: "utf8",
          },
        )
      : undefined;
  if (id === "zsh") await rm(join(home, "logout"), { force: true });
  const prepared = await integration.prepare(shell, env);
  assert.ok(prepared);
  const commands = [
    "startup_alias",
    id === "fish"
      ? 'printf "%s\\n" "$PATH[1]" > "$HOME/path-result"'
      : 'printf "%s\\n" "$PATH" > "$HOME/path-result"',
    ...(id === "zsh"
      ? ['printf "%s\\n" "$ZDOTDIR" "$HISTFILE" > "$HOME/zsh-result"']
      : []),
    "exit",
  ];
  let output = "";
  let sent = false;
  const child = pty.spawn(shell.executable, prepared.args, {
    name: "xterm-256color",
    cols: 160,
    rows: 30,
    cwd: home,
    env: { ...env, ...prepared.env },
  });
  const emulator = new HeadlessEmulator({
    cols: 160,
    rows: 30,
    onQueryReply: (data) => child.write(data),
  });
  try {
    const ended = new Promise((accept) => child.onExit(accept));
    child.onData((data) => {
      output += data;
      void emulator.write(data, { forwardQueryReplies: true });
      if (!sent && output.includes("IORI-PROMPT> ")) {
        sent = true;
        child.write(commands.join("\r") + "\r");
      }
    });
    const exit = await ended;
    await write(join(home, "terminal.txt"), output);
    assert.equal(exit.exitCode, 0, name);
    assert.equal(
      await readFile(join(home, "alias-result"), "utf8"),
      "alias-ok",
      name,
    );
    assert.equal(
      (await readFile(join(home, "path-result"), "utf8")).trim().split(":")[0],
      bin,
      name,
    );
    assert.equal(
      await readFile(join(home, "loaded"), "utf8"),
      id === "bash" ? "profile" : id === "zsh" ? "envprofilerclogin" : "config",
      name,
    );
    if (id === "zsh") {
      assert.equal(
        await readFile(join(home, "zsh-result"), "utf8"),
        `${home}\n${ordinaryHistory}\n`,
      );
      assert.equal(await readFile(join(home, "logout"), "utf8"), "logout");
    }
    // Observe the known Bash difference; do not make it an acceptance rule.
    const bashLogout =
      id === "bash"
        ? await readFile(join(home, "logout"), "utf8").then(
            () => "ran",
            (error) => {
              if (error.code === "ENOENT") return "not run";
              throw error;
            },
          )
        : undefined;
    const historyPath =
      id === "fish"
        ? join(home, ".local", "share", "fish", "fish_history")
        : id === "bash"
          ? join(home, ".bash_history")
          : ordinaryHistory;
    const history = await readFile(historyPath, "utf8");
    assert.match(history, /startup_alias/u);
    assert.doesNotMatch(
      history,
      /IORI_COMMAND_BIN|shell-integration|export PATH|set -gx PATH/u,
    );
    results.push({
      shell: name,
      args: prepared.args,
      profiles: "passed",
      alias: "passed",
      prompt: "passed",
      path: "passed",
      history: "passed",
      ...(ordinaryHistory ? { ordinaryHistory } : {}),
      logout:
        id === "bash" ? bashLogout : id === "zsh" ? "passed" : "not applicable",
    });
    console.log(`${name}: PASS`);
  } finally {
    child.kill();
    emulator.dispose();
  }
}
await write(join(run, "result.json"), JSON.stringify(results, null, 2) + "\n");
console.log(run);
