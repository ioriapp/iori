import assert from "node:assert/strict";
import test from "node:test";
import {
  FrameDecoder,
  FrameError,
  MAX_FRAME_BYTES,
  decodeFrame,
  encodeFrame,
  eventSchema,
  inviteFromText,
  inviteToText,
  inviteToCode,
  parseRequest,
} from "./index.ts";

const invite = {
  version: 1 as const,
  hostKey: "1".repeat(64),
  addresses: ["192.0.2.8:49171", "[2001:db8::8]:49171"],
  secret: "A".repeat(43),
  expiresAt: 1_800_000_000_000,
  hostName: "dev-host",
};

test("招待を詰めてURLと大小文字のコードから復元する", () => {
  const longInvite = {
    ...invite,
    relayUrl: "https://aps1-1.relay.n0.iroh.link./",
    addresses: [
      "172.17.0.1:49171",
      "198.51.100.7:49171",
      "[2001:db8::8]:49171",
    ],
    hostName: "開発用ホスト",
  };
  const text = inviteToText(longInvite);
  const code = inviteToCode(longInvite);
  assert.deepEqual(inviteFromText(text), longInvite);
  assert.deepEqual(inviteFromText(`  ${code.toLowerCase()}  `), longInvite);
  assert.deepEqual(
    inviteFromText(`  iori://pair/${code.toLowerCase()}  `),
    longInvite,
  );
});

test("4-byte big-endian枠を分割入力と連結入力から読む", () => {
  const first = encodeFrame({
    type: "device.revoked",
    publicKey: invite.hostKey,
  });
  const second = encodeFrame({ type: "host.addresses", addresses: [] });
  const decoder = new FrameDecoder();
  const prefix = decoder.push(first.slice(0, 3));
  const rest = decoder.push(first.slice(3));
  const joined = decoder.push(second);

  assert.equal(prefix.length, 0);
  assert.equal(
    eventSchema.parse(decodeFrame(rest[0]!))?.type,
    "device.revoked",
  );
  assert.deepEqual(decodeFrame(joined[0]!), {
    type: "host.addresses",
    addresses: [],
  });
  decoder.finish();
});

// E2Eで受信断片が分かれる位置を指定できないため、本物のdecoderで確かめる。
test("任意の位置で分かれて届いても複数の枠を取り違えない", () => {
  const frames = [
    encodeFrame({ type: "small" }),
    encodeFrame("b".repeat(4094)),
    encodeFrame("n".repeat(MAX_FRAME_BYTES - 3)),
    encodeFrame("m".repeat(MAX_FRAME_BYTES - 2)),
  ];
  const length = frames.reduce((total, frame) => total + frame.byteLength, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const frame of frames) {
    joined.set(frame, offset);
    offset += frame.byteLength;
  }

  let seed = 0x184;
  const nextChunkLength = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return 1 + ((seed >>> 0) % 16_384);
  };
  const decoder = new FrameDecoder();
  const decoded: Uint8Array[] = [];
  offset = 0;
  while (offset < joined.byteLength) {
    const end = Math.min(offset + nextChunkLength(), joined.byteLength);
    decoded.push(...decoder.push(joined.subarray(offset, end)));
    offset = end;
  }

  assert.deepEqual(
    decoded,
    frames.map((frame) => frame.subarray(4)),
  );
  decoder.finish();
});

test("途中で切れた枠と上限超過の枠を拒否する", () => {
  const truncated = new FrameDecoder();
  truncated.push(Uint8Array.of(0, 0, 0, 2, 0x7b));
  assert.throws(() => truncated.finish(), FrameError);

  const oversized = new FrameDecoder();
  assert.throws(() => oversized.push(Uint8Array.of(0, 0x40, 0, 1)), FrameError);
});

test("起動引数は空の消去を許し、長すぎる値と制御文字を拒否する", () => {
  const request = (argumentsValue: unknown) => ({
    kind: "request",
    operationId: "startup-arguments",
    method: "cli.arguments.set",
    params: { cliId: "codex", arguments: argumentsValue },
  });
  for (const value of ["", '--model "gpt-6-luna"', "x".repeat(4096)]) {
    const parsed = parseRequest(request(value));
    assert.equal(parsed.method, "cli.arguments.set");
    if (parsed.method === "cli.arguments.set")
      assert.equal(parsed.params.arguments, value);
  }
  for (const value of [
    "x".repeat(4097),
    "--model\nother",
    "\t",
    "\0",
    "\u007f",
    1,
    null,
  ])
    assert.throws(() => parseRequest(request(value)));
});

test("Relayだけの招待はURLを復元しトークンを含めない", () => {
  const relayInvite = {
    ...invite,
    addresses: [],
    relayUrl: "https://relay.example.com/",
  };
  const withExtraneousToken = {
    ...relayInvite,
    token: "not-an-invitation-secret",
  };
  const text = inviteToText(withExtraneousToken);
  assert.deepEqual(inviteFromText(text), relayInvite);
});

test("外部からのRelay設定は不正なURLとトークンを拒否する", () => {
  const request = (relay: unknown) => ({
    kind: "request",
    operationId: "relay-settings",
    method: "host.relay.set",
    params: { relay },
  });
  for (const url of [
    "ftp://relay.example.com/",
    "https://user@relay.example.com/",
    "https://user:password@relay.example.com/",
    "https://",
  ])
    assert.throws(() => parseRequest(request({ url })));
  for (const token of [
    "",
    "with space",
    "with\ttab",
    "with\nnewline",
    "\0",
    "\u007f",
  ])
    assert.throws(() =>
      parseRequest(request({ url: "https://relay.example.com/", token })),
    );
});
