import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { linkGit, writeFakeCli } from "../../verification/host/environment.mjs";
import { runHostTest } from "../../verification/host/process.mjs";
import {
  actorCommand,
  registerScriptedCli,
} from "../../verification/host/scripted-definition.mjs";

async function writeDelayedCli(dataRoot, cli) {
  // VT Code 0.182.4 startup OSC 7501 output, recorded from the real CLI.
  const vtSignals = [
    "\x1b]7501;state=idle:id=t5a365cec394d298b67b452b5413a30:app=vtcode:title=VlQgQ29kZQ==:msg=SWRsZQ==\x1b\\",
    "\x1b]7501;state=working:id=t5a365cec394d298b67b452b5413a30:app=vtcode:title=VlQgQ29kZQ==:msg=SW5pdGlhbGl6aW5nIHNlc3Npb24=\x1b\\",
    "\x1b]7501;state=idle:id=t5a365cec394d298b67b452b5413a30:app=vtcode:title=VlQgQ29kZQ==:msg=SWRsZQ==\x1b\\",
  ].join("");
  await writeFakeCli(
    join(dataRoot, "bin"),
    cli === "kimi-code" ? "kimi" : "vtcode",
    `
if (process.argv.includes("--version")) { console.log("delayed-cli 1.0.0"); process.exit(0); }
process.stdin.setRawMode(true);
process.stdin.resume();
let ready = false, buffer = "", requests = 0;
process.stdin.on("data", data => {
  if (!ready) { console.log("INPUT_BEFORE_READY"); return; }
  buffer += data.toString().replaceAll("\\x1b[200~", "").replaceAll("\\x1b[201~", "");
  const lines = buffer.split(/[\\r\\n]/u);
  buffer = lines.pop();
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("[iori] Parent ")) console.log("INITIAL_INPUT_COUNT=" + requests);
    else { requests++; console.log("INITIAL_REQUEST_RECEIVED:" + line); }
  }
});
console.log("NO_READY_SCREEN");
await new Promise(resolve => setTimeout(resolve, 650));
process.stdout.write("\\x1b[?2004h");
${cli === "vtcode" ? `process.stdout.write(${JSON.stringify(vtSignals)});` : ""}
ready = true;
`,
  );
}

for (const childDefinition of [undefined, "kimi-code", "vtcode"])
  test(
    childDefinition
      ? `${childDefinition}の子は起動中に出力が止まっても準備の合図まで最初の依頼を待つ`
      : "hookもpasteの印もない子のPTYに最初の依頼が一度だけ届く",
    (t) =>
      runHostTest(t, async ({ client, dataRoot, stage }) => {
        stage("親と子のCLIの定義を登録する");
        const parentCli = await registerScriptedCli(client, dataRoot);
        const childCli =
          childDefinition ??
          (await registerScriptedCli(client, dataRoot, {
            noReady: true,
          }));
        if (childDefinition) await writeDelayedCli(dataRoot, childDefinition);
        const candidate = {
          id: "worker-candidate",
          cli: childCli,
          model: "",
          tools: [],
          minimum: "",
        };
        stage("子の候補を持つチームを作って有効にする");
        const team = await client.request("teams.create", {
          definition: {
            name: "Initial input",
            description: "",
            instruction: "",
            parent: { ...candidate, id: "parent", cli: parentCli },
            roles: [
              {
                id: "worker",
                name: "Worker",
                when: "",
                limit: "",
                reuse: true,
                split: false,
                instruction: "",
                request: "",
                report: "",
                candidates: { high: [], medium: [candidate], low: [] },
              },
            ],
          },
        });
        await client.request("teams.settings", {
          enabled: true,
          defaultTeam: team.saved.id,
          limits: {},
        });
        stage("チームの親のPTYが入力を受け付ける");
        const events = await client.events();
        await events.waitFor((event) => event.type === "snapshot");
        const { terminal: parent } = await client.request("team.launch", {
          teamId: team.saved.id,
          cwd: dataRoot,
        });
        const parentPty = await client.terminal(parent.id);
        await parentPty.output("ACTOR_READY");
        // The parent definition takes its instructions as typed input.
        await parentPty.output("ACTOR_PROMPT:");
        stage("親のPTYから子へ委譲する");
        const delegated = await actorCommand(parentPty, "delegate", [
          "delegate",
          "--role",
          "Worker",
          "--difficulty",
          "low",
          "--title",
          "First request",
          "--worktree",
          "parent",
          "--body",
          "Receive the first request.",
        ]);
        const childId = delegated.data.child;
        stage("委譲した子のPTYを開いて最初の画面を受け取る");
        const changed = await events.waitFor(
          (event) =>
            event.type === "teams.child.updated" &&
            event.child.id === childId &&
            event.child.terminalId,
        );
        const child = await client.terminal(changed.child.terminalId);
        await child.output("NO_READY_SCREEN");
        stage("子のPTYに最初の依頼が届く");
        await child.waitFor(({ output }) =>
          /INITIAL_REQUEST_RECEIVED:Read .+ and follow its instructions\. Then open the file .+ with your file-reading tool/u.test(
            output,
          ),
        );
        stage("親のPTYから子へ後続の依頼を送る");
        await actorCommand(parentPty, "barrier", [
          "send",
          childId,
          "--kind",
          "request",
          "--body",
          "INITIAL_INPUT_BARRIER",
        ]);
        stage("子が後続の依頼を受け、初回依頼が一度だけ届いたと返す");
        const { output } = await child.waitFor(({ output }) =>
          /INITIAL_INPUT_COUNT=\d+\r?\n/u.test(output),
        );
        assert.equal(
          Number(output.match(/INITIAL_INPUT_COUNT=(\d+)\r?\n/u)[1]),
          1,
        );
        assert.doesNotMatch(output, /INPUT_BEFORE_READY/u);
      }),
  );

test("単独CLIの最初の依頼はシェルのpasteの印では送信しない", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("入力画面の準備が遅い単独CLIを起動する");
    await writeDelayedCli(dataRoot, "kimi-code");
    const { terminal } = await client.request("cli.launch", {
      cliId: "kimi-code",
      cwd: dataRoot,
      instruction: "Receive the first request.",
    });
    const pty = await client.terminal(terminal.id);
    stage("CLIの印の後で最初の依頼が届く");
    const { output } = await pty.waitFor(({ output }) =>
      /INITIAL_REQUEST_RECEIVED:Read .+ and follow its instructions\./u.test(
        output,
      ),
    );
    assert.doesNotMatch(output, /INPUT_BEFORE_READY/u);
  }));

test("Antigravity CLIの子は追加したリポジトリとそのworktreeで信頼の指定と最初の依頼を受け取る", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("引数を記録するAntigravity CLIとGitのリポジトリを用意する");
    await linkGit(join(dataRoot, "bin"));
    await writeFakeCli(
      join(dataRoot, "bin"),
      "agy",
      'if (process.argv.includes("--version")) console.log("1.5.9"); else { console.log("AGY_ARGS:" + JSON.stringify(process.argv.slice(2))); process.stdin.resume(); }\n',
    );
    const repository = join(dataRoot, "repository");
    await mkdir(repository);
    const git = (...args) =>
      execFileSync("git", ["-C", repository, ...args], { stdio: "pipe" });
    git("init", "-b", "main");
    git("config", "user.name", "Antigravity E2E");
    git("config", "user.email", "antigravity@localhost");
    await writeFile(join(repository, "source.txt"), "source");
    git("add", ".");
    git("commit", "-m", "initial");
    await client.request("folders.open", { path: repository });
    stage("Antigravity CLIを子の候補に持つチームを始める");
    const parentCli = await registerScriptedCli(client, dataRoot);
    const candidate = {
      id: "worker-candidate",
      cli: "antigravity",
      model: "",
      tools: [],
      minimum: "",
    };
    const team = await client.request("teams.create", {
      definition: {
        name: "Antigravity trust",
        description: "",
        instruction: "",
        parent: { ...candidate, id: "parent", cli: parentCli },
        roles: [
          {
            id: "worker",
            name: "Worker",
            when: "",
            limit: "",
            reuse: false,
            split: false,
            instruction: "",
            request: "",
            report: "",
            candidates: { high: [], medium: [candidate], low: [] },
          },
        ],
      },
    });
    await client.request("teams.settings", {
      enabled: true,
      defaultTeam: team.saved.id,
      limits: {},
    });
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal: parent } = await client.request("team.launch", {
      teamId: team.saved.id,
      cwd: repository,
    });
    const parentPty = await client.terminal(parent.id);
    await parentPty.output("ACTOR_READY");
    await parentPty.output("ACTOR_PROMPT:");
    const launched = async (worktree) => {
      const delegated = await actorCommand(parentPty, worktree, [
        "delegate",
        "--role",
        "Worker",
        "--difficulty",
        "medium",
        "--title",
        `Trust ${worktree}`,
        "--worktree",
        worktree,
        "--body",
        "Receive the first request.",
      ]);
      const changed = await events.waitFor(
        (event) =>
          event.type === "teams.child.updated" &&
          event.child.id === delegated.data.child &&
          event.child.terminalId,
      );
      const child = await client.terminal(changed.child.terminalId);
      const { output } = await child.waitFor(({ output }) =>
        /AGY_ARGS:(\[[^\r\n]+\])\r?\n/u.test(output),
      );
      return {
        cwd: changed.child.cwd,
        args: JSON.parse(output.match(/AGY_ARGS:(\[[^\r\n]+\])\r?\n/u)[1]),
      };
    };
    stage(
      "ioriが作ったworktreeの子は、そのフォルダーだけを信頼する指定を受ける",
    );
    const created = await launched("new");
    assert.notEqual(created.cwd, repository);
    const settings = created.args.indexOf("--settings");
    assert.ok(settings >= 0, JSON.stringify(created.args));
    assert.deepEqual(JSON.parse(created.args[settings + 1]), {
      trustedWorkspaces: [created.cwd],
    });
    stage("最初の依頼は起動の引数で届く");
    const prompt = created.args.indexOf("-i");
    assert.ok(prompt >= 0, JSON.stringify(created.args));
    assert.match(
      created.args[prompt + 1],
      /^Read .+ and follow its instructions\. Then open the file .+ and follow the delegated request\.$/u,
    );
    stage("親のフォルダーで動く子も、そのフォルダーだけを信頼する指定を受ける");
    const shared = await launched("parent");
    assert.equal(shared.cwd, repository);
    const sharedSettings = shared.args.indexOf("--settings");
    assert.ok(sharedSettings >= 0, JSON.stringify(shared.args));
    assert.deepEqual(JSON.parse(shared.args[sharedSettings + 1]), {
      trustedWorkspaces: [shared.cwd],
    });
  }));
