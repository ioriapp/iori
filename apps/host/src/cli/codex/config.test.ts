import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowsAdditionalDirectories,
  parseConfig,
  usesUnelevatedSandbox,
} from "./config.ts";

const shell = {
  id: "powershell",
  label: "PowerShell",
  executable: "pwsh",
  args: [],
};

test("Codex configuration and startup flags select additional writable roots", () => {
  const cases: [string, string, boolean][] = [
    ["", "", false],
    ['sandbox_mode = "read-only"', "", false],
    ['sandbox_mode = "workspace-write"', "", true],
    ['sandbox_mode = "danger-full-access"', "", true],
    ['default_permissions = ":read-only"', "", false],
    ['default_permissions = ":workspace"', "", true],
    ['default_permissions = ":danger-full-access"', "", true],
    [
      'default_permissions = "review"\n[permissions.review]\nextends = ":read-only"',
      "",
      false,
    ],
    [
      'default_permissions = "custom"\n[permissions.custom]\nextends = ":workspace"',
      "",
      false,
    ],
    ['sandbox_mode = "read-only"', "--sandbox workspace-write", true],
    ['default_permissions = ":workspace"', "-s read-only", false],
    ['sandbox_mode = "read-only"', '-c default_permissions=":workspace"', true],
    [
      'default_permissions = ":read-only"',
      '-c sandbox_mode="workspace-write"',
      true,
    ],
    [
      "",
      '-c sandbox_mode=workspace-write -c default_permissions=":read-only"',
      false,
    ],
    ["", '-c default_permissions=":read-only" -s workspace-write', true],
    [
      'sandbox_mode = "read-only"\ndefault_permissions = ":workspace"',
      "",
      true,
    ],
    ["bad = [", "", false],
  ];
  for (const [config, args, expected] of cases)
    assert.equal(
      allowsAdditionalDirectories(parseConfig(config), args, shell),
      expected,
      `${config} / ${args}`,
    );
});

test("Windows sandbox mode follows explicit setting and legacy elevated feature", () => {
  for (const [config, expected] of [
    ["", true],
    ['[windows]\nsandbox = "unelevated"', true],
    ['[windows]\nsandbox = "elevated"', false],
    ['[windows]\nsandbox = "mxc"', false],
    ["[features]\nelevated_windows_sandbox = true", false],
    [
      '[features]\nelevated_windows_sandbox = true\n[windows]\nsandbox = "unelevated"',
      true,
    ],
  ] as const)
    assert.equal(
      usesUnelevatedSandbox(parseConfig(config), "", shell),
      expected,
    );
});

test("Windows sandbox startup overrides follow Codex config layer precedence", () => {
  const elevated = '[windows]\nsandbox = "elevated"';
  const unelevated = '[windows]\nsandbox = "unelevated"';
  const cases: [string, string, boolean][] = [
    [elevated, "-c windows.sandbox=unelevated", true],
    [unelevated, "--config windows.sandbox=elevated", false],
    [elevated, '--config=windows.sandbox="unelevated"', true],
    [elevated, "-cwindows.sandbox=unelevated", true],
    [unelevated, '-c windows.sandbox="mxc"', false],
    [elevated, `-c 'windows={sandbox="unelevated"}'`, true],
    [elevated, `-c "windows.sandbox='unelevated'"`, true],
    [
      elevated,
      "-c windows.sandbox=elevated -c windows.sandbox=unelevated",
      true,
    ],
    [
      unelevated,
      `-c windows.sandbox=unelevated -c 'windows={sandbox="elevated"}'`,
      false,
    ],
    [elevated, "-c windows.sandbox=unelevated -c 'windows={}'", false],
    ["", "-c features.elevated_windows_sandbox=true", false],
    [
      "[features]\nelevated_windows_sandbox = true",
      "-c features.elevated_windows_sandbox=false",
      true,
    ],
    ["", "-c 'features={elevated_windows_sandbox=true}'", false],
    ["", "-c features.elevated_windows_sandbox.enabled=true", false],
    [elevated, "-c features.elevated_windows_sandbox=false", false],
    [unelevated, "-c features.elevated_windows_sandbox=true", true],
    [elevated, "-- -c windows.sandbox=unelevated", false],
  ];
  for (const [config, args, expected] of cases)
    assert.equal(
      usesUnelevatedSandbox(parseConfig(config), args, shell),
      expected,
      `${config} / ${args}`,
    );
});

test("Codex defaults depend on the active project and Windows sandbox availability", () => {
  const cwd = "C:\\repo\\child";
  const repository = "C:\\repo";
  const context = {
    platform: "win32" as const,
    cwd: [cwd],
    repository: [repository],
  };
  const cases: [Record<string, unknown>, string, boolean][] = [
    [{}, "", false],
    [{ windows: { sandbox: "elevated" } }, "", false],
    [{ projects: { [repository]: { trust_level: "trusted" } } }, "", false],
    [
      {
        windows: { sandbox: "elevated" },
        projects: { [repository]: { trust_level: "trusted" } },
      },
      "",
      true,
    ],
    [
      {
        windows: { sandbox: "unelevated" },
        projects: { [cwd]: { trust_level: "untrusted" } },
      },
      "",
      true,
    ],
    [
      {
        windows: { sandbox: "elevated" },
        projects: { [cwd]: {}, [repository]: { trust_level: "trusted" } },
      },
      "",
      false,
    ],
    [{ sandbox_mode: "workspace-write" }, "", false],
    [
      { sandbox_mode: "workspace-write", windows: { sandbox: "elevated" } },
      "",
      true,
    ],
    [
      { sandbox_mode: "workspace-write", windows: { sandbox: "unelevated" } },
      "",
      true,
    ],
    [
      { sandbox_mode: "workspace-write", windows: { sandbox: "mxc" } },
      "",
      true,
    ],
    [
      {
        sandbox_mode: "workspace-write",
        features: { elevated_windows_sandbox: true },
      },
      "",
      true,
    ],
    [
      {
        sandbox_mode: "workspace-write",
        features: { experimental_windows_sandbox: true },
      },
      "",
      true,
    ],
    [
      {
        sandbox_mode: "workspace-write",
        features: { enable_experimental_windows_sandbox: true },
      },
      "",
      true,
    ],
    [{}, "-s workspace-write", false],
    [{}, "-s danger-full-access", true],
    [{}, "-c default_permissions=:workspace", true],
    [{ sandbox_mode: "workspace-write" }, "-c windows.sandbox=elevated", true],
    [
      { sandbox_mode: "read-only", windows: { sandbox: "elevated" } },
      "-s workspace-write",
      true,
    ],
    [
      { sandbox_mode: "workspace-write", windows: { sandbox: "elevated" } },
      "'",
      true,
    ],
    [{ sandbox_mode: "read-only" }, "'", false],
    [{}, "'", false],
  ];
  for (const [config, args, expected] of cases)
    assert.equal(
      allowsAdditionalDirectories(config, args, shell, context),
      expected,
      JSON.stringify({ config, args }),
    );
});

test("Codex project trust uses canonical cwd then literal cwd then main repository", () => {
  const canonical = "\\\\?\\C:\\Repo\\child";
  const original = "C:\\alias\\child";
  const repository = "C:\\Repo";
  const context = {
    platform: "win32" as const,
    cwd: [canonical, original],
    repository: [repository],
  };
  const cases: [Record<string, unknown>, boolean][] = [
    [{ [canonical.toUpperCase()]: { trust_level: "trusted" } }, true],
    [{ [original]: { trust_level: "trusted" } }, true],
    [{ [repository]: { trust_level: "trusted" } }, true],
    [{ [canonical]: {}, [original]: { trust_level: "trusted" } }, false],
    [{ [original]: {}, [repository]: { trust_level: "trusted" } }, false],
    [{ "C:/alias/child": { trust_level: "trusted" } }, false],
    [{ "C:\\alias": { trust_level: "trusted" } }, false],
    [
      {
        [canonical.toUpperCase()]: {},
        [canonical.toLowerCase()]: { trust_level: "trusted" },
      },
      true,
    ],
    [
      { [original.toUpperCase()]: {}, [original]: { trust_level: "trusted" } },
      false,
    ],
    [{ [original]: { trust_level: "unknown" } }, false],
  ];
  for (const [projects, expected] of cases)
    assert.equal(
      allowsAdditionalDirectories(
        { projects, windows: { sandbox: "elevated" } },
        "",
        shell,
        context,
      ),
      expected,
      JSON.stringify(projects),
    );
  assert.equal(
    allowsAdditionalDirectories(
      { projects: { "/repo": { trust_level: "trusted" } } },
      "",
      shell,
      { platform: "linux", cwd: ["/repo"], repository: [] },
    ),
    true,
  );
  assert.equal(
    allowsAdditionalDirectories(
      { projects: { "/REPO": { trust_level: "trusted" } } },
      "",
      shell,
      { platform: "linux", cwd: ["/repo"], repository: [] },
    ),
    false,
  );
});

test("Codex-written lowercase literal project keys trust mixed-case cwd and linked worktrees", () => {
  const config = parseConfig(String.raw`
[windows]
sandbox = "elevated"
[projects.'c:\users\example\documents']
trust_level = "trusted"
`);
  const repository = String.raw`C:\Users\example\Documents`;
  for (const cwd of [
    repository,
    String.raw`C:\Users\example\Documents-worker`,
  ]) {
    assert.equal(
      allowsAdditionalDirectories(config, "", shell, {
        platform: "win32",
        cwd: ["\\\\?\\" + cwd, cwd],
        repository: ["\\\\?\\" + repository, repository],
      }),
      true,
      cwd,
    );
  }
});
