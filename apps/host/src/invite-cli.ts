import { lstat, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import QRCode from "qrcode";
import {
  FrameDecoder,
  decodeFrame,
  encodeFrame,
  eventSchema,
  inviteToText,
  inviteQrSegments,
  parseResponse,
} from "@iori/protocol";
import { hostControlPath } from "./storage.ts";

const japanese = (
  process.env.LC_ALL ||
  process.env.LC_MESSAGES ||
  process.env.LANG ||
  Intl.DateTimeFormat().resolvedOptions().locale
)
  .toLowerCase()
  .startsWith("ja");
const text = (ja: string, en: string): string => (japanese ? ja : en);

interface LocalControl {
  port: number;
  token: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readLocalControl(): Promise<LocalControl> {
  const path = hostControlPath();
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(
      text(
        "Hostの接続設定のファイルを読めません",
        "Cannot read the Host connection settings file",
      ),
    );
  }
  const contents = await readFile(path, "utf8");
  const value: unknown = JSON.parse(contents);
  // Host自身が本人限定で保存した設定なので、保存値の専用schema検査はしない。
  return value as { port: number; token: string };
}

function connectLocal(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const onError = (error: Error) => {
      socket.off("connect", onConnect);
      reject(error);
    };
    const onConnect = () => {
      socket.off("error", onError);
      socket.setNoDelay(true);
      resolve(socket);
    };
    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}

async function* readFrames(socket: Socket): AsyncGenerator<unknown> {
  const decoder = new FrameDecoder();
  for await (const chunk of socket) {
    const frames = decoder.push(chunk);
    for (const frame of frames) yield decodeFrame(frame);
  }
  decoder.finish();
}

function printFailure(error: unknown): void {
  const code = isRecord(error) && "code" in error ? error.code : undefined;
  if (code === "ENOENT" || code === "ECONNREFUSED") {
    process.stderr.write(
      text(
        "Hostが起動していません。先にHostを起動してください。\n",
        "The Host is not running. Start the Host first.\n",
      ),
    );
    return;
  }
  if (code === "ECONNRESET") {
    process.stderr.write(
      text(
        "このマシンのHostに接続できません。Hostが動いているか確認してください。\n",
        "Cannot connect to the Host on this machine. Check that the Host is running.\n",
      ),
    );
    return;
  }
  const message =
    error instanceof Error
      ? error.message
      : text(
          "このマシンのHostに接続できませんでした",
          "Could not connect to the Host on this machine",
        );
  process.stderr.write(`${message}\n`);
}

function withoutTerminalControls(value: string): string {
  return value.replace(/[\p{Cc}\p{Bidi_Control}]/gu, "");
}

async function main(): Promise<void> {
  let socket: Socket | undefined;
  try {
    const control = await readLocalControl();
    socket = await connectLocal(control.port);
    const operationId = randomUUID();
    socket.end(
      Buffer.from(
        encodeFrame({
          token: control.token,
          operationId,
          method: "invite.create",
          params: {},
        }),
      ),
    );

    let receivedCreation = false;
    let receivedRegistration = false;

    for await (const value of readFrames(socket)) {
      if (isRecord(value) && "ok" in value) {
        const response = parseResponse("invite.create", value);
        if (!response.ok) {
          throw new Error(
            text(
              `招待を発行できませんでした (${response.error.code})`,
              `Could not create an invitation (${response.error.code})`,
            ),
          );
        }
        if (receivedCreation) continue;
        const invite = response.result.invite;
        receivedCreation = true;
        const inviteText = inviteToText(invite);
        process.stdout.write(
          `Host: ${withoutTerminalControls(invite.hostName)}\n`,
        );
        process.stdout.write(
          text(
            `接続先: ${invite.addresses.join(", ")}\n`,
            `Addresses: ${invite.addresses.join(", ")}\n`,
          ),
        );
        process.stdout.write(
          text(
            "10分間、1回だけ使えます。\n\n",
            "Valid for 10 minutes and can be used once.\n\n",
          ),
        );
        process.stdout.write(
          `${await QRCode.toString(inviteQrSegments(invite), { type: "terminal", small: true, errorCorrectionLevel: "M" })}\n`,
        );
        process.stdout.write(`${inviteText}\n`);
        process.stdout.write(
          text(
            "\n端末が登録されるまで待っています。Ctrl+Cで待機をやめられます。\n",
            "\nWaiting for a device to register. Press Ctrl+C to stop waiting.\n",
          ),
        );
        continue;
      }
      if (!isRecord(value) || typeof value.type !== "string") continue;
      const event = eventSchema.parse(value);
      if (!event) continue;
      if (event.type === "invite.status" && event.operationId === operationId) {
        const message =
          event.status === "expired"
            ? text("招待の期限が切れました。", "The invitation has expired.")
            : text(
                "別の場所で新しい招待が発行されたため、この招待は無効になりました。",
                "This invitation is no longer valid because a new invitation was created elsewhere.",
              );
        process.stderr.write(`${message}\n`);
        socket.end();
        return;
      }
      if (
        event.type === "device.registered" &&
        event.inviteOperationId === operationId
      ) {
        process.stdout.write(
          text(
            `${withoutTerminalControls(event.device.name)}を登録しました。\n`,
            `Registered ${withoutTerminalControls(event.device.name)}.\n`,
          ),
        );
        receivedRegistration = true;
        socket.end();
        return;
      }
    }

    if (receivedCreation && !receivedRegistration) {
      process.stderr.write(
        text(
          "Hostとの接続が切れました。登録の完了通知は受け取れませんでした。\n",
          "The connection to the Host was lost. No registration confirmation was received.\n",
        ),
      );
    } else {
      process.stderr.write(
        text(
          "Hostから応答を受け取れませんでした。\n",
          "No response was received from the Host.\n",
        ),
      );
    }
  } catch (error) {
    printFailure(error);
  } finally {
    socket?.destroy();
  }
}

await main();
