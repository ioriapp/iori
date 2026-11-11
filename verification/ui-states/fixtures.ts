import type {
  CliListResult,
  BoardData,
} from "../../packages/protocol/src/index.ts";
import type {
  SshEvent,
  SshMachine,
  SshPrompt,
  SshFailure,
} from "../../apps/client/src/host-setup/ssh-events.ts";
import type {
  UninstallFlow,
  UninstallPhase,
  UninstallLog,
} from "../../apps/client/src/updates/uninstall-flow-types.ts";
import type { MaintenancePlan } from "../../packages/protocol/src/index.ts";

export const deviceName = "my-pc";
export const version = "0.1.100";
export const host = {
  publicKey: "ui-state-host",
  hostName: "build-linux",
  version,
  addresses: [],
  sshDestination: "build-linux",
  maintenanceAvailable: true,
};
const linux: SshMachine = {
  os: "Linux",
  cpu: "x86_64",
  arch: "x64",
  user: "user",
  home: "/home/user",
  installed: false,
};
const windows: SshMachine = {
  ...linux,
  os: "Windows",
  cpu: "AMD64",
  home: "C:\\Users\\user",
  administrator: true,
};
const candidates = [
  "build-linux",
  "office-win",
  "lab-win",
  "pi-arm",
  "nas",
  "gpu-box",
  "web-01",
  "web-02",
];
const fingerprint =
  "ED25519 SHA256:3q9X0b6m2kV7yJr1hQe8sTzL4uWnA5cDfGpRjK0iMvE";
const hostKeyOriginal =
  "The authenticity of host 'build-linux (192.168.1.24)' can't be established.\nED25519 key fingerprint is SHA256:3q9X0b6m2kV7yJr1hQe8sTzL4uWnA5cDfGpRjK0iMvE.\nThis key is not known by any other names.\nAre you sure you want to continue connecting (yes/no/[fingerprint])?";
const hostKeyChanged =
  "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\nHost key for 192.168.1.24 has changed and you have requested strict checking.\nOffending ED25519 key in /home/user/.ssh/known_hosts:12\nHost key verification failed.";
const password: SshPrompt = {
  id: "ui-password",
  kind: "password",
  text: "user@build-linux's password:",
  user: "user",
  host: "build-linux",
  attempt: 1,
};
const refused: SshFailure = {
  kind: "refused",
  address: "192.168.1.24",
  detail: "ssh: connect to host 192.168.1.24 port 22: Connection refused",
};
const installLog = [
  "$ ssh build-linux",
  "接続先: Linux x64 · user · /home/user",
  "curl -fsSL -o /tmp/iori-host-0.1.100-linux-x64.tar.gz …/iori-host-0.1.100-linux-x64.tar.gz",
  "SHA-256を確認しました（3f1c…9a0e）",
  "tar -xzf /tmp/iori-host-0.1.100-linux-x64.tar.gz -C ~/.local/share/iori-host",
  "systemctl --user enable --now iori-host.service",
  "loginctl enable-linger user",
  "iori-host: listening on 0.0.0.0:49171",
];
const windowsLog = [
  "$ ssh office-win",
  "接続先: Windows x64 · user · C:\\Users\\user",
  "curl.exe -fsSL -o $env:TEMP\\iori-host-0.1.100-windows-x64.zip …/iori-host-0.1.100-windows-x64.zip",
  "SHA-256を確認しました（8b07…41dd）",
  "Expand-Archive -Path $env:TEMP\\iori-host-0.1.100-windows-x64.zip -DestinationPath %LOCALAPPDATA%\\Programs\\iori-host",
  'New-NetFirewallRule -DisplayName "iori Host" -Direction Inbound -Program …\\runtime\\node.exe -Protocol UDP -Action Allow',
];
const works = [
  ["Claude Code", "ログイン入力の保持を直す", "running"],
  ["Codex", "Review changes", "approval"],
  ["Pi", "リリースノートを書く", "question"],
  ["Terminal", "bash（pnpm test）", "running"],
  ["OpenCode", "Release checks", "running"],
  ["Claude Code", "Boardの並び順を直す", "approval"],
  ["Codex", "CIの失敗を調べる", "running"],
  ["Terminal", "zsh（pnpm dev）", "running"],
  ["Pi", "依頼書を読む", "question"],
  ["Terminal", "bash（tail -f host.log）", "running"],
];
export function plan(count = 0): MaintenancePlan {
  return {
    canContinue: false,
    hasOpenTerminals: count > 0,
    targets: works.slice(0, count).map(([cli, title, state], i) => ({
      id: `work-${i}`,
      title: `${cli} · ${title}`,
      state: state as "running" | "approval" | "question",
      ...(cli === "Terminal"
        ? {
            title: `Terminal · ${title.split("（")[0]}`,
            command: title.split("（")[1].slice(0, -1),
          }
        : {}),
    })),
  } as MaintenancePlan;
}
export const clis = Object.fromEntries(
  works.flatMap(([name], i) =>
    name === "Terminal"
      ? []
      : [
          [
            `work-${i}`,
            {
              id: name,
              name,
              icon: {
                source: "bundled",
                light: (
                  {
                    "Claude Code": "claude.svg",
                    Codex: "openai-black.svg",
                    Pi: "pi-badge.svg",
                    OpenCode: "opencode-light.svg",
                  } as Record<string, string>
                )[name],
                dark: (
                  {
                    Codex: "openai-white.svg",
                    OpenCode: "opencode-dark.svg",
                  } as Record<string, string>
                )[name],
              },
            },
          ],
        ],
  ),
);

export type Fixture = {
  kind:
    | "setup"
    | "uninstall"
    | "version"
    | "notice"
    | "initialization"
    | "integrations"
    | "terminal-font"
    | "child-states"
    | "usage";
  initial: Record<string, Record<string, unknown>>;
  machine?: SshMachine;
  events: SshEvent[];
  flow?: UninstallFlow;
  notice?: { text: string; detail?: boolean; dismissible?: boolean };
  notes: string[];
  unavailable?: string;
};

export const terminalFontNames = [
  "BIZ UDGothic",
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "DejaVu Sans Mono",
  "Fira Mono",
  "FiraCode Nerd Font",
  "JetBrains Mono",
  "MS Gothic",
  "Noto Sans Mono",
  "Segoe UI",
  "Ubuntu Mono",
];

export function fixture(id: string): Fixture {
  if (id.startsWith("usage-")) return usageFixture(id);
  if (id === "child-states")
    return {
      kind: "child-states",
      events: [],
      notes: [],
      initial: {
        ChildRows: { expanded: true },
        TerminalPane: { resumeError: true },
      },
    };
  if (id.startsWith("terminal-font-")) {
    const state = id.slice("terminal-font-".length);
    const value =
      state === "long"
        ? "FiraCode Nerd Font Mono, JetBrains Mono, Cascadia Code PL, BIZ UDGothic"
        : state === "filter"
          ? "fira"
          : state === "comma"
            ? "FiraCode Nerd Font, jet"
            : state === "nomatch"
              ? "My Custom Font"
              : ["input", "saved", "error", "discard"].includes(state)
                ? "FiraCode Nerd Font"
                : "";
    return {
      kind: "terminal-font",
      events: [],
      notes: [],
      initial: {
        Settings: {
          value,
          families: terminalFontNames,
          suggestionsOpen: [
            "suggestions",
            "filter",
            "comma",
            "nomatch",
          ].includes(state),
          message:
            state === "saved"
              ? "保存しました"
              : state === "error"
                ? "保存できませんでした。もう一度お試しください。"
                : undefined,
          error: state === "error",
          pendingLeave: state === "discard" ? () => () => {} : undefined,
        },
      },
    };
  }
  if (id.startsWith("registration-"))
    return {
      kind: "initialization",
      events: [],
      initial: {
        ClientInitialization: {
          confirm: ["registration-confirm", "registration-error"].includes(id),
          resetError: id === "registration-error",
        },
      },
      notes: [],
    };
  if (id.startsWith("token-")) {
    const file = id.endsWith("-file");
    const origin = "https://forge.example.invalid";
    return {
      kind: "integrations",
      events: [],
      initial: {
        IntegrationsSettings: {
          list: {
            storage: file ? "os" : "file",
            sites: [
              {
                origin,
                sources: [],
                ...(file
                  ? { token: { account: "user", storage: "file" } }
                  : {}),
              },
            ],
          },
          form: file ? undefined : { origin },
        },
        GitSettings: { accounts: { available: false, accounts: [] } },
      },
      notes: [],
    };
  }
  const failures: Record<string, SshFailure> = {
    "B4-refused-noaddress": { ...refused, address: undefined },
    "B4-timeout-noaddress": {
      kind: "timeout",
      detail: "ssh: connect to host 192.168.1.24 port 22: Connection timed out",
    },
    "B4-unresolved": {
      kind: "unresolved",
      detail:
        "ssh: Could not resolve hostname build-linux: Name or service not known",
    },
    "B4-authfailed": {
      kind: "authFailed",
      detail: "user@192.168.1.24: Permission denied (publickey,password).",
    },
    "B4-hostkey-changed": {
      kind: "hostKeyChanged",
      address: "192.168.1.24",
      detail: hostKeyChanged,
    },
  };
  if (failures[id]) {
    const result = fixture("B4-unreachable");
    result.flow!.phase = { type: "sshFailed", failure: failures[id] };
    return result;
  }
  if (id === "B9-closed-sshLost") {
    const result = fixture("B3-disconnect");
    result.kind = "notice";
    result.flow!.closed = true;
    return result;
  }
  if (id === "B6c-local") {
    const result = fixture("B6c");
    result.flow!.route = "local";
    return result;
  }
  const result: Fixture = {
    kind: id.startsWith("A") ? "setup" : "uninstall",
    initial: {},
    events: [],
    notes: [],
  };
  if (id.startsWith("A")) setupFixture(id, result);
  else uninstallFixture(id, result);
  result.notes = comparisonNotes(id);
  return result;
}

function setupFixture(id: string, result: Fixture) {
  const local = {
    remote: !id.startsWith("A0"),
    name: id === "A0-name" ? "" : deviceName,
    local: { installed: false, canAllowConnections: true },
    allow: id !== "A0-off",
    allowed: null,
  };
  result.initial.HostSetupDialog = local;
  const state: Record<string, unknown> = {
    available: true,
    candidates,
    destination: "build-linux",
    machine: undefined,
    busy: false,
    session: "ui-state",
  };
  result.initial.SshSetup = state;
  const stage = (value: string) =>
    result.events.push({
      session: "ui-state",
      value: { type: "stage", stage: value as "download" },
    });
  const prompt = (value: SshPrompt) =>
    result.events.push({
      session: "ui-state",
      value: { type: "prompt", prompt: value },
    });
  const fail = (failure: SshFailure) =>
    result.events.push({
      session: "ui-state",
      value: { type: "closed", failure },
    });
  const machine = (value: SshMachine) => {
    result.machine = value;
  };
  const progress = (value: string, logs = installLog) => {
    machine(linux);
    state.progress = true;
    state.busy = true;
    stage(value);
    for (const line of logs)
      result.events.push({
        session: "ui-state",
        value: { type: "output", line },
      });
  };
  switch (id) {
    case "A0":
    case "A0-off":
    case "A0-name":
      break;
    case "A1":
      state.destination = "";
      break;
    case "A1-empty":
      Object.assign(state, { destination: "", candidates: [] });
      break;
    case "A1-nomatch":
      Object.assign(state, { destination: "", query: "gpu9" });
      break;
    case "A1b":
      Object.assign(state, { destination: "", manual: true });
      break;
    case "A1b-invalid":
      Object.assign(state, {
        destination: "",
        manual: true,
        input: "user@",
        invalid: true,
      });
      break;
    case "A1b-chosen":
      state.destination = "user@192.168.1.24";
      state.busy = true;
      break;
    case "A1c-win":
    case "A1c-linux":
      Object.assign(state, { destination: "", available: false });
      break;
    case "A2":
    case "A4-sent":
      state.busy = true;
      break;
    case "A2-unreachable":
      fail(refused);
      break;
    case "A2-noname":
      fail({
        kind: "unresolved",
        detail:
          "ssh: Could not resolve hostname build-linux: Name or service not known",
      });
      break;
    case "A2-timeout":
      fail({
        kind: "timeout",
        address: "192.168.1.24",
        detail:
          "ssh: connect to host 192.168.1.24 port 22: Connection timed out",
      });
      break;
    case "A3":
      prompt({
        id: "ui-hostkey",
        kind: "hostKeyNew",
        host: "build-linux",
        address: "192.168.1.24",
        fingerprint,
        text: hostKeyOriginal,
        attempt: 1,
      });
      break;
    case "A3-changed":
    case "A3-changed-open":
      fail({
        kind: "hostKeyChanged",
        address: "192.168.1.24",
        detail: hostKeyChanged,
      });
      result.initial.Notice = { open: id.endsWith("-open") };
      break;
    case "A3b":
      prompt({
        id: "ui-touch",
        kind: "notification",
        text: "Confirm user presence for key ED25519-SK SHA256:Vb2nQ4yLp0rT8mKcX6sJ1eHwZ9uA3dFgR5iO7kMvYqE",
        attempt: 1,
      });
      break;
    case "A4":
    case "A4-authfail":
      prompt({ ...password, attempt: id === "A4" ? 1 : 2 });
      break;
    case "A4-authfail-final":
      state.identity = password;
      fail({
        kind: "authFailed",
        detail: "user@192.168.1.24: Permission denied (publickey,password).",
      });
      break;
    case "A5":
    case "A5-cancelled":
      machine(linux);
      state.cancelled = id !== "A5";
      break;
    case "A6":
      machine(windows);
      state.destination = "office-win";
      break;
    case "A7":
      machine({ ...windows, administrator: false });
      state.destination = "lab-win";
      break;
    case "A8":
      machine({
        ...linux,
        arch: "arm64",
        cpu: "aarch64",
        user: "pi",
        home: "/home/pi",
      });
      state.destination = "pi-arm";
      break;
    case "A9-download":
      progress("download", installLog.slice(0, 2));
      break;
    case "A9-extract":
      progress("extract", installLog.slice(0, 4));
      break;
    case "A9-start":
    case "A9-log":
      progress("start", installLog.slice(0, 6));
      break;
    case "A9-register":
      progress("register");
      break;
    case "A9-win":
      progress("firewall", windowsLog);
      machine(windows);
      state.destination = "office-win";
      break;
    case "A9c":
      progress("extract", installLog.slice(0, 4));
      state.cancelling = true;
      break;
    case "A9-disconnect":
      progress("extract", [
        ...installLog.slice(0, 4),
        "client_loop: send disconnect: Broken pipe",
      ]);
      fail({
        kind: "disconnected",
        stage: "extract",
        detail: "client_loop: send disconnect: Broken pipe",
      });
      break;
    case "A9b":
      machine(linux);
      state.warning = {
        type: "installed",
        hostKey: host.publicKey,
        hostName: "build-linux",
      };
      break;
    case "A10":
    case "A10-notstarted":
      machine(windows);
      Object.assign(state, {
        destination: "office-win",
        progress: true,
        signIn: id === "A10" ? "required" : "notStarted",
      });
      break;
    case "A11":
      progress("extract", [
        ...installLog.slice(0, 5),
        "tar: Unexpected EOF in archive",
        "tar: Error is not recoverable: exiting now (exit 2)",
      ]);
      fail({
        kind: "install",
        stage: "extract",
        detail: "tar: Unexpected EOF in archive",
        exitCode: 2,
      });
      break;
    case "A11b":
      progress("download", [
        ...installLog.slice(0, 2),
        "curl: command not found",
        "wget: command not found",
      ]);
      fail({ kind: "downloadTools", stage: "download", detail: "" });
      break;
    case "A11c":
      progress("register");
      Object.assign(state, {
        busy: false,
        invite: { addresses: ["192.168.1.24:49171", "[fd00::24]:49171"] },
        registrationError:
          "build-linuxにiori Hostをインストールしましたが、このデバイスから接続できません。build-linuxとの間のファイアウォールで受信が許可されているか確認してから、もう一度お試しください。後で再接続する場合は、ファイアウォールを確認してから「iori Hostをセットアップする」でbuild-linuxを選んでください。",
      });
      break;
    case "A11d":
      machine({
        ...windows,
        installed: true,
        host: { ...host, hostName: "office-win", version: "0.1.95" },
      });
      state.destination = "office-win";
      fail({ kind: "controlOutdated", hostVersion: "0.1.95", detail: "" });
      break;
    case "A11d-updating":
    case "A11d-failed":
      progress(
        "extract",
        id.endsWith("-failed")
          ? [
              ...windowsLog.slice(0, 4),
              "（仮）Expand-Archive: Unexpected EOF in archive",
            ]
          : [
              "$ ssh office-win",
              "iori Host 0.1.95 → 0.1.100",
              "curl.exe -fsSL -o $env:TEMP\\iori-host-0.1.100-windows-x64.zip …",
            ],
      );
      machine({
        ...windows,
        installed: true,
        host: { ...host, hostName: "office-win", version: "0.1.95" },
      });
      Object.assign(state, {
        destination: "office-win",
        mode: "update",
        update: true,
      });
      if (id.endsWith("-failed"))
        fail({
          kind: "install",
          stage: "extract",
          detail: "（仮）Expand-Archive: Unexpected EOF in archive",
        });
      break;
    case "A12":
    case "A12b":
      machine({
        ...windows,
        installed: true,
        host: {
          ...host,
          hostName: "office-win",
          version: id === "A12" ? version : "0.1.98",
        },
      });
      state.destination = "office-win";
      break;
    case "A11d-closed-failed":
      result.kind = "notice";
      result.notice = {
        text: "office-winのiori Hostを更新できなかったため、このデバイスを登録できませんでした。",
        detail: true,
      };
      break;
    case "A13":
    case "A13b":
      result.kind = "notice";
      result.notice = {
        text:
          id === "A13"
            ? "office-winにiori Hostをインストールし、このデバイスを登録しました。"
            : "office-winのiori Hostにこのデバイスを登録しました。",
      };
      break;
    default:
      result.unavailable = "この状態の描画データがありません。";
  }
  state.machine = result.machine;
  const log: string[] = [];
  for (const { value } of result.events) {
    if (value.type === "stage") state.stage = value.stage;
    if (value.type === "output") log.push(value.line);
    if (value.type === "prompt") {
      state.prompt = value.prompt;
      state.busy = true;
    }
    if (value.type === "closed") {
      state.prompt = undefined;
      state.failure = value.failure;
      state.busy = false;
    }
  }
  state.log = log;
  if (id === "A9-log") result.initial.Progress = { view: "log" };
}

function uninstallFixture(id: string, result: Fixture) {
  const flow: UninstallFlow = {
    hostKey: host.publicKey,
    hostName: id === "B5-invite" ? "office-win" : "build-linux",
    route: "ssh",
    deleteData: id === "B2-data",
    phase: { type: "confirming", plan: plan() },
    closed: false,
    log: [],
  };
  result.flow = flow;
  const phase = (value: UninstallPhase) => {
    flow.phase = value;
  };
  const run = (step: "settings" | "work" | "remove" | "result") => {
    const order = ["settings", "work", "remove", "result"] as const;
    const at = order.indexOf(step);
    phase({ type: "running", step, completed: order.slice(0, at) });
    flow.log = uninstallLogs(at);
  };
  const failure = (partial = false): UninstallPhase => ({
    type: "failed",
    failure: {
      step: partial ? "work" : "settings",
      stage: partial ? "terminals" : "hooks",
      osError: partial ? "timeout" : "EACCES",
      autostartRestored: !partial,
      hooksRestored: true,
      terminalsRestored: true,
    },
  });
  const files: UninstallPhase = {
    type: "done",
    outcome: {
      type: "filesRemaining",
      paths: ["/home/user/.local/share/iori-host/terminal-daemon"],
      processes: [],
    },
  };
  switch (id) {
    case "B0":
    case "B1":
    case "B8":
      result.kind = "version";
      break;
    case "B2-checking":
      phase({ type: "confirming" });
      break;
    case "B2":
    case "B2-data":
    case "B2-disconnected":
      break;
    case "B2b":
    case "B2b-many":
      phase({ type: "confirming", plan: plan(id === "B2b" ? 4 : 10) });
      break;
    case "B2-readfail":
      phase({ type: "confirming", planError: true });
      break;
    case "B4-connecting":
      phase({ type: "sshConnecting" });
      break;
    case "B4-unreachable":
      phase({ type: "sshFailed", failure: refused });
      break;
    case "B4":
    case "B4-authfail":
      phase({
        type: "sshPrompt",
        prompt: { ...password, attempt: id === "B4" ? 1 : 2 },
      });
      break;
    case "B4-skip-progress":
      flow.route = "remote";
      run("work");
      break;
    case "B3-terminals":
      run("work");
      break;
    case "B3-uninstall":
    case "B3-log":
      run("remove");
      break;
    case "B3-result":
      run("result");
      break;
    case "B3-disconnect":
      run("result");
      phase({
        type: "sshLost",
        failure: {
          kind: "disconnected",
          detail: "client_loop: send disconnect: Broken pipe",
        },
      });
      flow.log.push({
        kind: "sshOutput",
        line: "client_loop: send disconnect: Broken pipe",
      });
      break;
    case "B4-skip":
    case "B5-invite":
      flow.route = "remote";
      phase({ type: "done", outcome: { type: "started" } });
      result.kind = "notice";
      break;
    case "B5":
    case "B5-last":
      phase({ type: "done", outcome: { type: "uninstalled" } });
      result.kind = "notice";
      break;
    case "B5-data":
      flow.deleteData = true;
      phase({ type: "done", outcome: { type: "uninstalledWithData" } });
      result.kind = "notice";
      break;
    case "B5-token":
      flow.deleteData = true;
      phase({
        type: "done",
        outcome: {
          type: "tokensRemaining",
          sites: ["https://forgejo.example.com", "http://gitea.lan:3000"],
          deleteData: true,
        },
      });
      break;
    case "B6c":
    case "B9-detail-warning":
      phase(files);
      break;
    case "B6":
    case "B9-detail":
      phase(failure());
      flow.log = [
        { kind: "stage", stage: "hooks", done: false },
        {
          kind: "error",
          stage: "hooks",
          osError:
            "EACCES: permission denied, open '/home/user/.claude/settings.json'",
        },
      ];
      break;
    case "B6b":
      phase(failure(true));
      flow.log = [
        ...uninstallLogs(1),
        {
          kind: "error",
          stage: "terminals",
          osError: "Terminal（bash）を停止できませんでした: timeout",
        },
      ];
      break;
    case "B9-closed-warning":
      phase(files);
      flow.closed = true;
      result.kind = "notice";
      break;
    case "B9-closed-failed":
      phase(failure());
      flow.closed = true;
      result.kind = "notice";
      break;
    default:
      result.unavailable = "この状態の描画データがありません。";
  }
  if (id === "B3-log") result.initial.Progress = { view: "log" };
}
function uninstallLogs(at: number): UninstallLog[] {
  const done: UninstallLog[] = [
    { kind: "stage", stage: "hooks", done: true },
    { kind: "stage", stage: "registration", done: true },
    { kind: "terminalsStopped", count: 4 },
    { kind: "stage", stage: "stop", done: true },
    { kind: "sshOutput", line: "rm -rf ~/.local/share/iori-host/runtime" },
  ];
  return [
    ...done.slice(0, [0, 2, 3, 5][at]),
    at === 3
      ? { kind: "receiptMissing" }
      : {
          kind: "stage",
          stage: ["hooks", "terminals", "stop"][at],
          done: false,
        },
  ];
}

// 見本と違うままにする理由。文・部品・配置・高さの順で一覧へ示す。
function comparisonNotes(id: string): string[] {
  const notes: string[] = [];
  if (id === "B2-readfail")
    notes.push(
      "部品: 中断される作業を読めない間は主ボタンを押せず、『再試行』で読み直す。押しても反応が無かった製品の訂正で、見本の押せる表示から変えている。",
    );
  if (id.startsWith("A"))
    notes.push(
      "文: 端末名・接続先・OSは見本の値を使う。括弧や空白、パスワードのラベルは製品の翻訳の表記を保つ（内容は同じ）。",
    );
  if (["A11", "A11d-failed", "A9-disconnect"].includes(id))
    notes.push(
      "部品: 製品は失敗の原文を『SSHの表示』に畳んで添える。見本のログ以外にも表示があるが、失敗時の原文を読める製品仕様に従い残す。",
    );
  if (["B2b", "B2b-many"].includes(id))
    notes.push(
      "部品: CLIの公式アイコンは製品の同梱物を使うため、見本の単色のアイコンと形・色が異なる。Terminalのコマンドは製品の行の書式（・で区切る）を使う。",
    );
  if (["B6", "B6b", "B9-detail"].includes(id))
    notes.push(
      "配置: 失敗・原因・復旧の結果は、文を変えず見本と同じ1段落で続ける。",
    );
  if (id.startsWith("B2"))
    notes.push(
      "幅: 狭い窓の本文は358pxを保つ。現在の見本ソースを同じブラウザーで描画した幅・折り返しを正とし、古いPNGで最初の文が2行になっている折り返しには合わせない。",
    );
  if (id === "A3")
    notes.push(
      "配置: 狭い窓の指紋は、現在の見本ソースと製品を同じブラウザーで描画すると、どちらも3行になる。古いPNGの2行とは描画が異なるため、現在の見本ソースを正として変更しない。",
    );
  if (
    [
      "A0",
      "A0-off",
      "A0-name",
      "A1",
      "A1-empty",
      "A1-nomatch",
      "A1b",
      "A1b-invalid",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
      "A7",
      "A8",
      "A12",
      "A12b",
    ].includes(id)
  )
    notes.push(
      "配置: 製品のダイアログの初期フォーカスと入力選択を保つため、見本に無いフォーカスの輪や文字の選択が写る。",
    );
  if (
    ["B4-skip", "B5", "B5-data", "B5-invite", "B9-closed-warning"].includes(id)
  )
    notes.push(
      "配置: 背景は対象外（設定を閉じた後の画面は E2E で確認済み）。知らせを製品のトークンの無地の上で比べる。",
    );
  notes.push(
    "高さ: Aは700px、Bは580px、狭い窓は844pxの見本の値と実測値を下に示す。設定だけの状態と知らせには対象のダイアログが無い。",
  );
  return notes;
}

export function usageSnapshot(id: string): CliListResult {
  const state = Number(id.split("-").at(-1));
  const now = Date.now();
  const entries = Object.entries(clis);
  const codex = entries.find(([, cli]) => cli.name === "Codex")!;
  const ordered = [codex, ...entries.filter(([key]) => key !== codex[0])];
  const agents = id.includes("-agents-");
  const count = agents
    ? 7
    : state === 11
      ? 0
      : [1, 6, 7, 8, 9, 15, 22, 23, 25].includes(state)
        ? 1
        : [3, 4, 5, 14, 24].includes(state)
          ? 7
          : 3;
  return {
    clis: ordered.slice(0, count).map(([id, cli], index) => ({
      ...cli,
      icon: {
        light: cli.icon.light,
        ...(cli.icon.dark ? { dark: cli.icon.dark } : {}),
      },
      id,
      hidden: false,
      usage:
        agents && index % 2 === 1
          ? undefined
          : {
              observedAt: now - index * 33 * 60000,
              windows: [
                {
                  minutes: state === 15 ? 10080 : 300,
                  remaining: [8, 9, 25].includes(state) ? 17 : 78,
                  resetsAt: now + 87 * 60000,
                  ...(state === 15
                    ? { name: "gpt-6.1-sol Preview Model Groups" }
                    : state === 7
                      ? { name: "gpt-6.1-sol" }
                      : {}),
                },
                {
                  minutes: 10080,
                  remaining: [8, 9].includes(state) ? 0 : 42,
                  resetsAt: now + 4680 * 60000,
                },
                ...(agents
                  ? [
                      {
                        name: "gpt-6.1-sol",
                        minutes: 1440,
                        remaining: 64,
                        resetsAt: now + 720 * 60000,
                      },
                      {
                        name: "gpt-6.1-sol",
                        minutes: 43200,
                        remaining: 35,
                        resetsAt: now + 14400 * 60000,
                      },
                    ]
                  : []),
              ],
            },
    })),
  };
}
function usageFixture(id: string): Fixture {
  const state = Number(id.split("-").at(-1));
  const list = usageSnapshot(id);
  const first = list.clis[0]?.id;
  const open = [5, 14, 24].includes(state)
    ? "all"
    : [6, 7, 8, 9, 12, 15, 22, 23].includes(state)
      ? first
      : null;
  const board: BoardData = {
    defaultConversation: "usage-conversation",
    conversations: [
      {
        id: "usage-conversation",
        terminalId: "usage-parent",
        teamId: "usage-team",
        createdAt: Date.now(),
      },
    ],
    agents: list.clis.map((cli, index) => ({
      id: cli.id,
      createdAt: Date.now(),
      conversation: "usage-conversation",
      parentTerminalId: "usage-parent",
      parentCwd: "/home/user",
      teamId: "usage-team",
      roleId: "usage-role",
      title: works[index][1],
      task: works[index][1],
      cli,
      state: "reported",
      revisions: 0,
    })),
    roles: [],
    usage: list.clis.map((cli) => ({
      cli: cli.id,
      name: cli.name,
      usage: cli.usage!,
    })),
  };
  return {
    kind: "usage",
    events: [],
    notes: [],
    initial: {
      UsageStatus: {
        opened: open,
        pinned: open !== null,
        refreshing: state === 23 ? [first] : [],
      },
      Board: { data: board, section: "agents" },
    },
  };
}
