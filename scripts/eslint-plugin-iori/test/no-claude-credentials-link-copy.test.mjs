import { ruleTester } from "./rule-tester.mjs";
import rule from "../rules/no-claude-credentials-link-copy.mjs";

const filename = "/repo/verification/cli/home.mjs";

ruleTester.run("no-claude-credentials-link-copy", rule, {
  valid: [
    { code: 'const auth = ".codex/auth.json";', filename },
    { code: 'const auth = ".pi/agent/auth.json";', filename },
    {
      code: "process.env.CLAUDE_CODE_OAUTH_TOKEN = await readClaudeToken();",
      filename,
    },
    // A test may check that the CLI home holds no credential file.
    {
      code: 'await assert.rejects(readFile(join(home, ".claude/.credentials.json")), { code: "ENOENT" });',
      filename,
    },
    // The Owner's own file must still be there after an uninstall.
    {
      code: 'assert.equal(existsSync(join(original, ".claude/.credentials.json")), true);',
      filename,
    },
    {
      code: 'await assert.rejects(readFile(join(home, ".claude/.credentials.json")));',
      filename,
    },
    {
      code: 'const settings = await readFile(join(home, ".claude/settings.json"), "utf8");',
      filename,
    },
    // Creating the settings directory and linking another CLI's file in one
    // script is not a link or copy of Claude's state.
    {
      code: "windows(`[IO.Directory]::CreateDirectory((Join-Path $home '.claude')) | Out-Null;foreach($auth in @('.codex\\auth.json','.pi\\agent\\auth.json')){New-Item -ItemType HardLink -Path (Join-Path $home $auth) -Target $auth | Out-Null}`);",
      filename,
    },
    {
      code: 'await copyFile(join(home, ".codex/auth.json"), target);',
      filename,
    },
    {
      code: 'windows(`Copy-Item -LiteralPath ${ps(bundle + "\\\\settings.json")} -Destination ${ps(home)}`);',
      filename,
    },
  ],
  invalid: [
    // A link or copy of the credential file itself.
    {
      code: 'await symlink(join(original, ".claude/.credentials.json"), join(home, ".claude/.credentials.json"));',
      filename,
      errors: [{ messageId: "linkedCredentials" }],
    },
    {
      code: "await copyFile(`${original}/.credentials.json`, target);",
      filename,
      errors: [{ messageId: "linkedCredentials" }],
    },
    // Settings-directory links and copies carry the credential file too.
    {
      code: 'await symlink(join(original, ".claude"), join(home, ".claude"), "dir");',
      filename,
      errors: [{ messageId: "linkedCredentials" }],
    },
    {
      code: 'await cp(join(original, ".claude"), join(home, ".claude"), { recursive: true });',
      filename,
      errors: [{ messageId: "linkedCredentials" }],
    },
    {
      code: 'await fs.link(join(original, ".claude"), target);',
      filename,
      errors: [{ messageId: "linkedCredentials" }],
    },
    {
      code: 'windows(`New-Item -ItemType Junction -Path ${ps(home + "\\\\.claude")} -Target ${ps(original + "\\\\.claude")} | Out-Null`);',
      filename,
      errors: [{ messageId: "linkedCredentials" }],
    },
    {
      code: 'windows(`Copy-Item -LiteralPath ${ps(original + "\\\\.claude")} -Destination ${ps(home)} -Recurse`);',
      filename,
      errors: [{ messageId: "linkedCredentials" }],
    },
    {
      code: "windows(`New-Item -ItemType HardLink -Path (Join-Path $home '.claude\\\\.credentials.json') -Target $original`);",
      filename,
      errors: [{ messageId: "linkedCredentials" }],
    },
    // Shell commands in the verification helpers.
    {
      code: "linux(\"cp -r ~/.claude/ '$HOME/test-home/.claude'\");",
      filename,
      errors: [{ messageId: "linkedCredentials" }],
    },
    {
      code: 'linux("ln -s $HOME/.claude/.credentials.json $test/.credentials.json");',
      filename,
      errors: [{ messageId: "linkedCredentials" }],
    },
  ],
});
