import assert from "node:assert/strict";
import { parseReadRequest } from "./reading.ts";
import test from "node:test";
import {
  ProtocolValidationError,
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
  parseResponse,
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

// 将来のHostが追加した値を受け取っても、登録情報を失わず接続できる。
test("古いClientは将来のconnectionScopeを省略と同じに扱い接続できる", () => {
  const result = {
    publicKey: invite.hostKey,
    hostName: "dev-host",
    addresses: invite.addresses,
  };
  const parsed = parseResponse("host.info", {
    ok: true,
    result: { ...result, connectionScope: "future-scope" },
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.result, result);
});

test("チームの作成と保存で確認間隔の範囲外を拒否する", () => {
  const definition = {
    name: "Team",
    description: "",
    instruction: "",
    roles: [],
    parent: { id: "primary", cli: "", model: "", tools: [], minimum: "" },
  };
  for (const method of ["teams.create", "teams.save"]) {
    const parse = (intervals: object) =>
      parseRequest({
        kind: "request",
        operationId: "team",
        method,
        params: { teamId: "team", definition: { ...definition, ...intervals } },
      });
    for (const intervals of [
      { checkMinutes: 0 },
      { checkMinutes: 1441 },
      { backgroundWakeMinutes: -1 },
      { backgroundWakeMinutes: 1441 },
      { checkMinutes: 1.5 },
    ])
      assert.throws(() => parse(intervals), ProtocolValidationError);
    for (const intervals of [
      { checkMinutes: 1, backgroundWakeMinutes: 0 },
      { checkMinutes: 1440, backgroundWakeMinutes: 1440 },
    ]) {
      const request = parse(intervals);
      if (request.method !== "teams.save" && request.method !== "teams.create")
        assert.fail();
      assert.deepEqual(request.params.definition, {
        ...definition,
        ...intervals,
      });
    }
  }
});

test("CLI 定義の保存要求から未知の項目を取り除く", () => {
  const file = { name: "icon", uploadId: "a".repeat(36) };
  const request = {
    kind: "request",
    operationId: "save",
    method: "cli.definition.save",
    params: { definition: "{}", files: [file] },
  };
  assert.deepEqual(
    parseRequest({
      ...request,
      extra: true,
      params: {
        ...request.params,
        extra: true,
        files: [{ ...file, extra: true }],
      },
    }),
    request,
  );
});

test("ファイル管理の要求は開いたフォルダー内の相対パスだけを受け付ける", () => {
  const check = (method: string, params: Record<string, unknown>) =>
    parseRequest({
      kind: "request",
      operationId: "manage",
      method,
      params: { root: "/work", ...params },
    });
  for (const method of [
    "files.create",
    "files.rename",
    "files.duplicate",
    "files.delete",
    "files.write",
  ]) {
    const params = (path: string) =>
      method === "files.rename"
        ? { from: "src/old", to: path }
        : method === "files.create"
          ? { path, kind: "file" }
          : {
              path,
              ...(method === "files.write" ? { contentBase64: "" } : {}),
            };
    assert.equal(check(method, params("src/new")).method, method);
    for (const path of [
      "",
      "/test",
      "C:file",
      "\\test",
      "a\\b",
      "./a",
      "a/../b",
      "a//b",
      "a/",
      "a\0b",
    ])
      assert.throws(() => check(method, params(path)), ProtocolValidationError);
  }
  assert.throws(
    () => check("files.rename", { from: "../old", to: "new" }),
    ProtocolValidationError,
  );
  assert.throws(
    () => check("files.create", { path: "new", kind: "symlink" }),
    ProtocolValidationError,
  );
  assert.equal(
    check("files.find", { query: "", start: 0, count: 10 }).method,
    "files.find",
  );
  assert.throws(
    () => check("files.find", { query: "a\0b", start: 0, count: 10 }),
    ProtocolValidationError,
  );
});

test("テキスト保存とワークスペース検索の要求を検査する", () => {
  const parse = (method: string, params: Record<string, unknown>) =>
    parseRequest({
      kind: "request",
      operationId: "edit",
      method,
      params: { root: "/work", ...params },
    });
  const write = {
    path: "file",
    contentBase64: "YQ==",
    expectedRevision: "old",
    force: false,
  };
  assert.equal(parse("files.write", write).method, "files.write");
  assert.throws(
    () => parse("files.write", { ...write, contentBase64: "*bad" }),
    ProtocolValidationError,
  );
  const search = {
    query: "code",
    folder: "src",
    caseSensitive: false,
    regex: true,
    maxResults: 500,
  };
  assert.equal(
    parse("files.searchWorkspace", search).method,
    "files.searchWorkspace",
  );
  for (const invalid of [
    { folder: "../src" },
    { query: "" },
    { maxResults: 0 },
    { maxResults: 501 },
  ])
    assert.throws(
      () => parse("files.searchWorkspace", { ...search, ...invalid }),
      ProtocolValidationError,
    );
});

test("ブランチ比較の要求でブランチ名と構文色分けの範囲を検証する", () => {
  const request = (method: string, params: object) =>
    parseReadRequest({
      kind: "request",
      operationId: "review",
      method,
      params: { root: "/repo", ...params },
    });
  const source = { kind: "branch", base: "origin/topic", path: "sample.ts" };
  request("git.branches", {});
  request("git.branchChanges", { base: source.base, start: 0, count: 20 });
  request("git.diffOpen", { source: { ...source, untracked: true } });
  request("git.diffSyntax", { source, startRow: 0, rowCount: 10 });
  assert.throws(
    () => request("git.diffSyntax", { source, startRow: 0, rowCount: 1025 }),
    ProtocolValidationError,
  );
  for (const base of [
    "-option",
    "main..next",
    "two words",
    "main\n",
    "main~1",
    "main:path",
  ]) {
    assert.throws(
      () => request("git.branchChanges", { base, start: 0, count: 1 }),
      ProtocolValidationError,
    );
    assert.throws(
      () => request("git.diffOpen", { source: { ...source, base } }),
      ProtocolValidationError,
    );
  }
});

test("CIの再実行とキャンセルには数字1〜20桁の実行IDが必要", () => {
  const request = (method: string, run: unknown, params: object = {}) =>
    parseRequest({
      kind: "request",
      operationId: "ci",
      method,
      params: { path: "/repo", run, ...params },
    });
  for (const method of ["forge.ci.rerun", "forge.ci.cancel"]) {
    for (const run of ["1", "12345678901234567890"]) {
      assert.deepEqual(request(method, run).params, { path: "/repo", run });
    }
    for (const run of [undefined, 42, "", "123456789012345678901", "1/cancel"])
      assert.throws(() => request(method, run), ProtocolValidationError);
  }
  for (const failedOnly of [true, false])
    assert.deepEqual(request("forge.ci.rerun", "42", { failedOnly }).params, {
      path: "/repo",
      run: "42",
      failedOnly,
    });
  assert.throws(
    () => request("forge.ci.rerun", "42", { failedOnly: "true" }),
    ProtocolValidationError,
  );
});

test("Gitの書き込みには対象と操作に応じた引数が必要", () => {
  const request = (method: string, args: object = {}) =>
    parseRequest({
      kind: "request",
      operationId: "write",
      method,
      params: { root: "/repo", ...args },
    });
  for (const method of ["git.stage", "git.unstage"]) {
    request(method, { all: true });
    request(method, { paths: ["dir/name"] });
    for (const args of [{}, { all: false }, { paths: [] }])
      assert.throws(() => request(method, args), ProtocolValidationError);
  }
  request("git.discard", { paths: ["file"], untracked: true });
  for (const action of ["stage", "unstage", "discard"])
    request("git.applyHunk", { action, path: "file", hunkIndex: 0 });
  for (const path of ["../x", "/x", "a\\b", "C:x", "a//b", "a/./b", "x\0"]) {
    for (const method of ["git.stage", "git.unstage", "git.discard"])
      assert.throws(
        () => request(method, { paths: [path] }),
        ProtocolValidationError,
      );
    assert.throws(
      () => request("git.applyHunk", { action: "stage", path, hunkIndex: 0 }),
      ProtocolValidationError,
    );
  }
  for (const hunkIndex of [-1, 4096, 1.5])
    assert.throws(
      () =>
        request("git.applyHunk", {
          action: "discard",
          path: "file",
          hunkIndex,
        }),
      ProtocolValidationError,
    );
  request("git.createCommit", { message: "subject\n\nbody", amend: true });
  for (const message of ["", " \t\n", "x\0"])
    assert.throws(
      () => request("git.createCommit", { message }),
      ProtocolValidationError,
    );
  for (const method of ["git.fetch", "git.pull", "git.push"]) request(method);
});

test("PRの詳細と作成に必要な項目を読み込み、無効な入力を拒否する", () => {
  const request = (method: string, params: object) =>
    parseRequest({ kind: "request", operationId: "pr", method, params });
  const params = {
    path: "/repo",
    title: "Fix",
    body: "",
    base: "release",
    draft: false,
    issue: 2,
  };
  assert.deepEqual(
    request("forge.pr", { path: "/repo", redetect: true }).params,
    { path: "/repo", redetect: true },
  );
  assert.deepEqual(request("forge.pr.create", params).params, params);
  for (const invalid of [
    { title: "  " },
    { base: "" },
    { body: "x\0" },
    { issue: 0 },
    { draft: "false" },
  ]) {
    assert.throws(
      () => request("forge.pr.create", { ...params, ...invalid }),
      ProtocolValidationError,
    );
  }
});
