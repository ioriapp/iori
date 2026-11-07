import type { MaintenancePlan } from "@iori/protocol";
import type { SshPrompt, SshFailure } from "../host-setup/ssh-events.ts";

export type UninstallRoute = "local" | "ssh" | "remote";
// local : このPCの Host（native.hostSetupStatus().host.publicKey === hostKey。host-controller.ts:171-179）
// ssh   : HostInfo.sshDestination がある
// remote: 招待だけで登録した Host。「結果を確認せずに」で始めた ssh もこの扱い

export type UninstallStep = "settings" | "work" | "remove" | "result";
// 見本の段「ioriの設定を外す」「作業を停止」「iori Hostを削除」「結果を確認」。MaintenanceStatus との対応は 2.3

export type LogLine = { at: number; text: string }; // text は (4) が i18n 済みの文で作る。(3) は key と値を渡す（下の UninstallLog）

export type UninstallLog =
  | { kind: "stage"; stage: string; done: boolean } // Host の stage（hooks/registration/terminals/forge-tokens/stop/program/data）の開始と完了
  | { kind: "terminalsStopped"; count: number } // plan.targets.length
  | { kind: "sshOutput"; line: string } // SSH の output
  | { kind: "receiptMissing" } // 結果票がまだ無い（読み直す）
  | { kind: "error"; stage?: string; osError?: string };

export type UninstallOutcome =
  | { type: "uninstalled" } // B5。phase succeeded・deleteData false
  | { type: "uninstalledWithData" } // B5-data
  | { type: "started" } // B5-invite / B4-skip。route remote で phase removing
  | { type: "tokensRemaining"; sites: string[]; deleteData: boolean } // B5-token。succeeded + forgeTokensRemaining
  | { type: "filesRemaining"; paths: string[]; processes: string[] }; // B6c。phase failed・stage program|data・failedPaths/processErrors。Host は止まっている

export type UninstallFailure = {
  step: UninstallStep; // 失敗の印を付ける段
  stage: string; // Host の stage（prepare-removal / hooks / registration / terminals / save-removal / stop）または "request"
  osError?: string; // EACCES 等。(4) が文に写す（表 2.4）
  autostartRestored: boolean; // rollbackFailed に "registration" が無い（B6b はここが false）
  hooksRestored: boolean; // rollbackFailed に "hooks" が無い（仕様では示さない。ログにだけ）
  terminalsRestored: boolean; // rollbackFailed に "terminals" が無い
};

export type UninstallPhase =
  | { type: "confirming"; plan?: MaintenancePlan; planError?: boolean } // B2-checking（plan 無し）/ B2・B2b（plan）/ B2-readfail（planError）。B2-disconnected は connection.connectedHosts から (4) が出す
  | { type: "sshConnecting" } // B4-connecting
  | { type: "sshPrompt"; prompt: SshPrompt } // B4 / B4-authfail（prompt.attempt > 1）
  | { type: "sshFailed"; failure: SshFailure } // B4-unreachable。「再試行」「結果を確認せずに…」
  | { type: "running"; step: UninstallStep; completed: UninstallStep[] } // B3-*
  | { type: "sshLost"; failure: SshFailure } // B3-disconnect。段は result で止まり印は failed
  | { type: "failed"; failure: UninstallFailure } // B6 / B6b
  | { type: "done"; outcome: UninstallOutcome }; // B5* / B5-token / B6c

export type UninstallFlow = {
  hostKey: string;
  hostName: string;
  os?: string;
  route: UninstallRoute;
  deleteData: boolean;
  phase: UninstallPhase;
  log: UninstallLog[];
  operationId?: string; // 送った後
  closed: boolean; // ダイアログを閉じた後に終わった時、知らせに「詳細」を付ける判断に使う
};
