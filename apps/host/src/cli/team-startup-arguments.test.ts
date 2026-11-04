import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startupArgumentWords,
  teamStartupArguments,
} from "./team-startup-arguments.ts";
import { cliDefinitions, type TeamLaunch } from "./definitions.ts";

const shell = (id: string) => ({ id, label: id, executable: id, args: [] });

test("startup words follow shell quoting and retain the source passed to that shell", () => {
  const cases = [
    [
      "bash",
      `--name "two words" a\\ b '' 'a'\\''b'`,
      ["--name", "two words", "a b", "", "a'b"],
    ],
    [
      "bash",
      String.raw`--path "C:\work\file" --value "a\"b"`,
      ["--path", String.raw`C:\work\file`, "--value", 'a"b'],
    ],
    [
      "bash",
      '--name="$USER words" --value=one\\ two',
      ["--name=$USER words", "--value=one two"],
    ],
    [
      "powershell",
      "--name 'it''s two words' --value \"a`\"b\" a` b ''",
      ["--name", "it's two words", "--value", 'a"b', "a b", ""],
    ],
    [
      "powershell",
      "--path 'C:\\work\\file' --name 'a`b'",
      ["--path", String.raw`C:\work\file`, "--name", "a`b"],
    ],
    [
      "cmd",
      String.raw`--path "C:\work dir\file" --name="two words" '' ""`,
      ["--path", String.raw`C:\work dir\file`, "--name=two words", "''", ""],
    ],
    [
      "cmd",
      String.raw`--name "a\"b" --path "C:\work dir\\"`,
      ["--name", 'a"b', "--path", "C:\\work dir\\"],
    ],
  ] as const;
  for (const [id, source, expected] of cases) {
    const words = startupArgumentWords(source, shell(id));
    assert.deepEqual(
      words?.map((word) => word.value),
      expected,
      `${id}: ${source}`,
    );
    assert.equal(
      teamStartupArguments(source, shell(id), [], []),
      words?.map((word) => word.source).join(" "),
    );
  }
  for (const id of ["bash", "powershell", "cmd"]) {
    assert.equal(
      startupArgumentWords('--name "unclosed', shell(id)),
      undefined,
    );
    assert.equal(
      teamStartupArguments('--name "unclosed', shell(id), [], []),
      "",
    );
  }
  assert.equal(
    startupArgumentWords("--name trailing\\", shell("bash")),
    undefined,
  );
  assert.equal(
    startupArgumentWords('--name "$(echo nested)"', shell("bash")),
    undefined,
  );
});

const launch: TeamLaunch = {
  candidate: {
    id: "candidate",
    cli: "codex",
    model: "team-model",
    effort: "low",
    permission: "never",
    sandbox: "workspace-write",
    tools: ["Read"],
    minimum: "",
  },
  instructionFile: "/team/instructions.md",
  commandDirectory: "/team/bin",
  teamFilesDirectory: "/team/files",
  instructions: "Team instructions",
  initial: "Start",
};

test("model flags are removed only when the CLI definition supplies a role model", () => {
  for (const definition of cliDefinitions) {
    // A command line takes no startup arguments (cli-definitions.md「画面」).
    if (definition.commandLine) continue;
    for (const initial of ["Start", undefined]) {
      const args = definition.teamArguments!({ ...launch, initial });
      const options = definition.managedTeamArguments!;
      assert.equal(
        teamStartupArguments(
          '--model=old --keep "two words"',
          shell("bash"),
          options,
          args,
        ),
        // A CLI without a model argument takes no role model.
        args.includes("team-model")
          ? '--keep "two words"'
          : '--model=old --keep "two words"',
        definition.id,
      );
      const unset = definition.teamArguments!({
        ...launch,
        candidate: { ...launch.candidate, model: "" },
        initial,
      });
      assert.equal(
        teamStartupArguments(
          '--model=old --keep "two words"',
          shell("bash"),
          options,
          unset,
        ),
        '--model=old --keep "two words"',
        definition.id,
      );
    }
  }
});

test("Codex config keys and aliases remove only the settings supplied by the team", () => {
  const definition = cliDefinitions.find((entry) => entry.id === "codex")!;
  for (const id of ["bash", "powershell", "cmd"]) {
    const source =
      '--no-daemon -m old --model=older -moldest -c model_reasoning_effort=high --config=approval_policy=on-request -csandbox_mode=read-only -c developer_instructions=old -c allow_login_shell=true -c tui.theme=dark --config="unrelated=two words"';
    assert.equal(
      teamStartupArguments(
        source,
        shell(id),
        definition.managedTeamArguments!,
        [
          ...definition.launchArguments!("0.156.0", true),
          ...definition.teamArguments!(launch),
        ],
      ),
      '-c tui.theme=dark --config="unrelated=two words"',
    );
  }
  const args = definition.teamArguments!({
    ...launch,
    candidate: {
      ...launch.candidate,
      effort: undefined,
      permission: undefined,
      sandbox: undefined,
    },
  });
  assert.equal(
    teamStartupArguments(
      "-c model_reasoning_effort=high -c approval_policy=on-request -c sandbox_mode=read-only",
      shell("bash"),
      definition.managedTeamArguments!,
      args,
    ),
    "-c model_reasoning_effort=high -c approval_policy=on-request -c sandbox_mode=read-only",
  );
});

test("role permission and sandbox settings remove alternative flags and presets only when specified", () => {
  const codex = cliDefinitions.find((entry) => entry.id === "codex")!;
  const presets =
    "--yolo --dangerously-bypass-approvals-and-sandbox --approve-for-me";
  for (const id of ["bash", "powershell", "cmd"]) {
    for (const permission of [undefined, "on-request"]) {
      for (const sandbox of [undefined, "read-only"]) {
        const args = codex.teamArguments!({
          ...launch,
          candidate: { ...launch.candidate, permission, sandbox },
        });
        assert.equal(
          teamStartupArguments(
            `-a never --ask-for-approval=never -s danger-full-access --sandbox=workspace-write ${presets} --keep value`,
            shell(id),
            codex.managedTeamArguments!,
            args,
          ),
          [
            permission ? "" : "-a never --ask-for-approval=never",
            sandbox ? "" : "-s danger-full-access --sandbox=workspace-write",
            permission || sandbox ? "" : presets,
            "--keep value",
          ]
            .filter(Boolean)
            .join(" "),
        );
      }
    }
  }
  const claude = cliDefinitions.find((entry) => entry.id === "claude")!;
  for (const permission of [undefined, "plan"]) {
    const source =
      "--dangerously-skip-permissions --allow-dangerously-skip-permissions --name keep";
    assert.equal(
      teamStartupArguments(
        source,
        shell("bash"),
        claude.managedTeamArguments!,
        claude.teamArguments!({
          ...launch,
          candidate: { ...launch.candidate, permission },
        }),
      ),
      permission ? "--name keep" : source,
    );
  }
});

test("repeatable directories and prompts retain the user's spelling", () => {
  for (const [id, source] of [
    ["antigravity", '--add-dir "one dir" --add-dir "two dir" --model old'],
    [
      "pi",
      '--append-system-prompt "user instructions" --append-system-prompt file.md --model old',
    ],
  ]) {
    const definition = cliDefinitions.find((entry) => entry.id === id)!;
    assert.equal(
      teamStartupArguments(
        source!,
        shell("bash"),
        definition.managedTeamArguments!,
        definition.teamArguments!(launch),
      ),
      source!.replace(" --model old", ""),
    );
  }
});

test("simple braced variable references survive alongside a removed role option", () => {
  const definition = cliDefinitions.find((entry) => entry.id === "codex")!;
  for (const [id, source] of [
    ["bash", '--profile "${PROFILE}" --add-dir ${HOME}/src'],
    [
      "powershell",
      '--profile "${env:PROFILE}" --add-dir ${env:USERPROFILE}/src',
    ],
  ]) {
    assert.equal(
      teamStartupArguments(
        `${source} --model old`,
        shell(id!),
        definition.managedTeamArguments!,
        definition.teamArguments!(launch),
      ),
      source,
    );
  }
  for (const source of [
    '--profile "${$(echo nested)}"',
    '--profile "${a${b}}"',
    '--profile "${a`echo nested`}"',
    '--profile "${UNCLOSED"',
  ]) {
    assert.equal(startupArgumentWords(source, shell("bash")), undefined);
  }
});

test("Claude variadic managed options remove all values before the next option", () => {
  const definition = cliDefinitions.find((entry) => entry.id === "claude")!;
  assert.equal(
    teamStartupArguments(
      '--allowed-tools "Bash(echo *)" Read --add-dir="one dir" "two dir" --name keep -- --model prompt',
      shell("bash"),
      definition.managedTeamArguments!,
      definition.teamArguments!(launch),
    ),
    "--name keep -- --model prompt",
  );
});
