import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { writeFakeCli } from "../../verification/host/environment.mjs";
import { runHostTest } from "../../verification/host/process.mjs";

test("Hostの停止で残った起動指示のコピーは再起動時に片付く", (t) =>
  runHostTest(t, async ({ dataRoot, restart, stage }) => {
    const directory = join(dataRoot, "iori-host", "launch-instructions");
    stage("Hostの停止中に前回の起動指示のコピーが残る");
    await restart({
      whileStopped: async () => {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "leftover.md"), "private instruction");
      },
    });
    stage("再起動後にコピーが残っていない");
    assert.deepEqual(
      await readdir(directory).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      }),
      [],
    );
  }));

test("最初の指示と一緒にClaude Codeへ保存した追加フォルダーを渡す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("引数を記録するClaude Codeを用意する");
    await writeFakeCli(
      join(dataRoot, "bin"),
      "claude",
      'if (process.argv.includes("--version")) console.log("2.1.0"); else { console.log("CLAUDE_ARGS:" + JSON.stringify(process.argv.slice(2))); process.stdin.resume(); }\n',
    );
    await client.request("cli.arguments.set", {
      cliId: "claude",
      arguments: '--add-dir "my extra folder"',
    });
    stage("最初の指示を付けてCLIを起動する");
    const { terminal: created } = await client.request("cli.launch", {
      cliId: "claude",
      cwd: dataRoot,
      instruction: "Work on the issue.",
    });
    const terminal = await client.terminal(created.id);
    const { output } = await terminal.waitFor(({ output }) =>
      /CLAUDE_ARGS:(\[[^\r\n]+\])\r?\n/u.test(output),
    );
    const args = JSON.parse(
      output.match(/CLAUDE_ARGS:(\[[^\r\n]+\])\r?\n/u)[1],
    );
    const promptIndex = args.indexOf("--");
    assert.ok(promptIndex > 0);
    assert.ok(
      args
        .slice(0, promptIndex)
        .some(
          (value, index, all) =>
            value === "--add-dir" && all[index + 1] === "my extra folder",
        ),
    );
    assert.match(
      args[promptIndex + 1],
      /Read .* and follow its instructions\./u,
    );
  }));
