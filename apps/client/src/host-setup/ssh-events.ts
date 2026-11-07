import type { HostInfo } from "../native.ts";

export type SshSession = string; // crypto.randomUUID()。UI が作り、全ての呼び出しに渡す（今と同じ）

export type SshStage =
  | "connect"
  | "download"
  | "verification"
  | "extract"
  | "service"
  | "firewall"
  | "start"
  | "register";
// 今の名前のまま（install.sh:11-88・ssh/windows.rs:25-56 が出す）。
// 見本の段への畳み方は (2) の純粋関数が持つ:
//   Linux  : download+verification→「〈接続先〉でダウンロード」, extract→「ファイルを展開」, service+start→「iori Hostを起動」, register→「この端末を登録」
//   Windows: download+verification→ダウンロード, extract→展開, firewall→「ファイアウォールの許可を追加」, service+start→起動, register→登録
//   更新して登録: download…start→「iori Hostを更新」, register→「この端末を登録」

export type SshPromptKind =
  | "hostKeyNew" // 初めての接続先。fingerprint と host を添える（A3）
  | "hostKeyChanged" // 到達しない。変更は prompt でなく failure（下）で返す
  | "password" // 「〈user〉@〈host〉のパスワード」（A4）
  | "passphrase" // 鍵の passphrase。key にパス（A4 と同じ欄、ラベルだけ違う）
  | "notification" // 応答の要らない通知（FIDO のタッチ。A3b）
  | "other"; // 上のどれにも読めなかった OpenSSH の確認。原文をそのまま出す

export type SshPrompt = {
  id: string;
  kind: SshPromptKind;
  text: string; // OpenSSH の原文（「SSHの表示」に出す）
  host?: string; // hostKeyNew / password: 接続先の名前（原文から）
  address?: string; // hostKeyNew: "(192.168.1.24)" の中
  fingerprint?: string; // hostKeyNew: "ED25519 SHA256:…"
  user?: string; // password: "user"
  key?: string; // passphrase: 鍵のパス
  attempt: number; // 同じ kind の何回目か（1 始まり）。password の 2 回目以降は「ログインできませんでした。パスワードを確認して…」を上に出す（A4-authfail）
};

export type SshFailureKind =
  | "clientMissing" // ssh が無い（A1c）。spawn の NotFound（session.rs:146-152）
  | "refused" // "Connection refused"（A2-unreachable）
  | "unresolved" // "Could not resolve hostname"（A2-noname）
  | "timeout" // "Connection timed out" / "No route to host"（A2-timeout）
  | "hostKeyChanged" // "REMOTE HOST IDENTIFICATION HAS CHANGED" / "Host key verification failed"（A3-changed）。address に ssh-keygen -R に渡す値
  | "authFailed" // "Permission denied (…)" で ssh が終わった（A4-authfail-final）
  | "declined" // 利用者が「接続しない」を選んだ（host 鍵・パスワード）。失敗の文は出さず選び直しへ
  | "disconnected" // 要求の途中で SSH が閉じた（A9-disconnect）。exitCode 255 / SSH_CLOSED
  | "probe" // 接続先の情報を読めなかった（今の "Missing/Invalid SSH destination information"）
  | "downloadTools" // curl も wget も無い（A11b）。install.sh:41 の文を stage=download で検出
  | "install" // 導入スクリプトが段で失敗（A11）。stage と exitCode
  | "controlOutdated" // 既にある Host の invite.create が IORI_CONTROL_ERROR（A11d）。hostVersion
  | "control" // それ以外の control の失敗（Host が応答しない等）
  | "cancelled"; // キャンセルが終わった（A5-cancelled）

export type SshFailure = {
  kind: SshFailureKind;
  detail: string; // OpenSSH / スクリプトの原文（畳んで添える）。秘密を含めない
  stage?: SshStage; // install / downloadTools
  exitCode?: number;
  address?: string; // hostKeyChanged: known_hosts に載っている host か IP
  hostVersion?: string; // controlOutdated
};

export type SshMachine = {
  os: "Linux" | "Windows" | string; // 原文のまま（"Darwin" 等は未対応として (2) が示す）
  cpu: string; // uname -m / PROCESSOR_ARCHITECTURE の原文
  arch: "x64" | "arm64" | "other"; // (1) が正規化（x86_64・AMD64→x64、aarch64・ARM64→arm64）
  user?: string;
  home?: string;
  installed: boolean;
  administrator?: boolean; // Windows だけ
  host?: HostInfo; // installed で応答があった時。version を含む
};

export type SshEvent = {
  session: SshSession;
  value:
    | { type: "stage"; stage: SshStage }
    | { type: "output"; line: string } // ログの行。下の 1.3
    | { type: "prompt"; prompt: SshPrompt }
    | { type: "promptClosed"; id: string }
    | { type: "linger"; enabled: false } // Linux。完了を「注意あり」にする（A9b）
    | { type: "closed"; failure?: SshFailure }; // SSH が終わった。failure 無しは正常終了（cancel の後）
};

export type SshInstallMode = "install" | "register" | "update";
export type SshPurpose = "setup" | "uninstall";
export type SshInstallResult =
  { type: "invite"; invite: unknown } | { type: "signInRequired" };

/** native の SSH の入口。実装は SSH の処理のスライスが持つ。 */
export type SshFunctions = {
  sshClient(): Promise<{ available: boolean }>;
  sshCandidates(): Promise<string[]>;
  sshConnect(
    destination: string,
    session: SshSession,
    purpose: SshPurpose,
  ): Promise<SshMachine>;
  sshAnswer(prompt: string, answer: string | null): Promise<void>;
  sshInstall(
    session: SshSession,
    mode: SshInstallMode,
  ): Promise<SshInstallResult>;
  sshCancel(session: SshSession): Promise<void>;
  onSshSetup(fn: (event: SshEvent) => void): Promise<() => void>;
};

export type SetupCompletion =
  | { type: "installed"; hostKey: string; hostName: string }
  | { type: "registered"; hostKey: string; hostName: string }
  | { type: "closedAfterWarning"; hostKey: string };
