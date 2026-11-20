import assert from "node:assert/strict";
import test from "node:test";
import { cliDefinitions, type TeamLaunch } from "./definitions.ts";

function team(cli: string): TeamLaunch {
  return {
    candidate: { id: "parent", cli, model: "", tools: [], minimum: "" },
    instructionFile: "/team/instructions.md",
    teamFilesDirectory: "/team",
    trustWorkspace: false,
    instructions: "Team instructions",
    commandDirectory: "/bin",
  };
}

const read = "Read /team/instructions.md and follow its instructions.";
const initial = "Review changes";

for (const [id, promptArgs, fileOption] of [
  ["antigravity", ["-i"]],
  ["opencode", ["--prompt"]],
  ["codebuddy", [], "--append-system-prompt"],
  ["qoder", ["-i"], "--append-system-prompt"],
  ["grok", [], "--rules"],
  ["kiro", []],
  ["vtcode"],
  ["kimi-code"],
  ["amp"],
  ["hermes", ["chat", "-q"]],
  ["vibe", ["--"]],
] as const) {
  test(`${id} は最初の依頼がなければ入力を待ち、依頼があればその本文だけを渡す`, () => {
    const definition = cliDefinitions.find((cli) => cli.id === id)!;
    const launch = team(id);
    const base = definition.teamArguments!({ ...launch, instructionFile: "" });
    const args = fileOption ? [...base, fileOption, read] : base;
    assert.deepEqual(definition.teamArguments!(launch), args);
    assert.equal(definition.teamInput?.(launch), undefined);
    const requested = { ...launch, initial };
    assert.deepEqual(
      definition.teamArguments!(requested),
      promptArgs ? [...args, ...promptArgs, initial] : args,
    );
    assert.equal(
      definition.teamInput?.(requested),
      promptArgs ? undefined : initial,
    );
  });
}

test("Cursor と Muse Code は最初の依頼でチームの指示ファイルを読む", () => {
  for (const id of ["cursor", "muse-code"]) {
    const definition = cliDefinitions.find((cli) => cli.id === id)!;
    const launch = team(id);
    assert.ok(definition.teamArguments!(launch).includes(read));
    assert.ok(
      definition.teamArguments!({ ...launch, initial }).includes(
        read + " Then review changes",
      ),
    );
  }
});

test("OpenCode は依頼なしで会話を再開してもチームの指示を設定から読み、入力を待つ", () => {
  const definition = cliDefinitions.find((cli) => cli.id === "opencode")!;
  for (const version of ["1.2.3", "2.0.0"]) {
    const launch = { ...team("opencode"), version, resume: true };
    const env = definition.launchEnvironment!(launch);
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? "{}");
    assert.ok(config.instructions?.includes(launch.instructionFile), version);
    assert.deepEqual(definition.teamArguments!(launch), []);
    assert.equal(definition.teamInput?.(launch), undefined);
  }
});

test("OpenCode のチームでは既存の設定と指示を残し、V2 のモデルと新しい指示を同時に渡す", () => {
  const definition = cliDefinitions.find((cli) => cli.id === "opencode")!;
  const saved = process.env.OPENCODE_CONFIG_CONTENT;
  try {
    for (const existing of [
      undefined,
      '{"theme":"dark","instructions":["existing.md"]}',
      "{invalid",
    ]) {
      if (existing === undefined) delete process.env.OPENCODE_CONFIG_CONTENT;
      else process.env.OPENCODE_CONFIG_CONTENT = existing;
      for (const version of ["1.2.3", "2.0.0"]) {
        const launch = team("opencode");
        launch.candidate.model = "provider/model";
        launch.candidate.effort = "high";
        const env = {
          ...definition.launchEnvironment!({ ...launch, version }),
          ...definition.teamEnvironment!(launch),
        };
        assert.equal(env.IORI_TEAM_FILES_DIRECTORY, "/team");
        assert.deepEqual(JSON.parse(env.OPENCODE_CONFIG_CONTENT!), {
          ...(existing?.includes("theme")
            ? {
                theme: "dark",
                instructions: ["existing.md", launch.instructionFile],
              }
            : { instructions: [launch.instructionFile] }),
          ...(version === "2.0.0" ? { model: "provider/model#high" } : {}),
        });
      }
    }
  } finally {
    if (saved === undefined) delete process.env.OPENCODE_CONFIG_CONTENT;
    else process.env.OPENCODE_CONFIG_CONTENT = saved;
  }
});
