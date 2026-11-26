import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSameMachineHost,
  joinHostPath,
  revealInFileManagerLabelKey,
} from "./local-file-manager.ts";

const loopback = { publicKey: "host", connectionScope: "loopback" } as const;
const network = { publicKey: "host", connectionScope: "network" } as const;

test("Windowsでは同じPCのドライブ上のパスだけを表示する", () => {
  assert.equal(
    isSameMachineHost({
      clientOs: "windows",
      host: loopback,
      path: "C:\\work",
    }),
    true,
  );
  assert.equal(
    isSameMachineHost({
      clientOs: "windows",
      host: network,
      localHostKey: "host",
      path: "C:/work",
    }),
    true,
  );
  assert.equal(
    isSameMachineHost({
      clientOs: "windows",
      host: loopback,
      path: "/home/work",
    }),
    false,
  );
  assert.equal(
    isSameMachineHost({
      clientOs: "windows",
      host: loopback,
      path: "\\\\server\\work",
    }),
    false,
  );
  assert.equal(
    isSameMachineHost({
      clientOs: "windows",
      host: network,
      localHostKey: "other",
      path: "C:\\work",
    }),
    false,
  );
  assert.equal(
    isSameMachineHost({ clientOs: "windows", host: network, path: "C:\\work" }),
    false,
  );
});

test("LinuxとmacOSでは同じマシンの絶対パスだけを表示する", () => {
  for (const clientOs of ["linux", "macos"] as const) {
    assert.equal(
      isSameMachineHost({ clientOs, host: loopback, path: "/home/work" }),
      true,
    );
    assert.equal(
      isSameMachineHost({
        clientOs,
        host: network,
        localHostKey: "host",
        path: "/home/work",
      }),
      true,
    );
    assert.equal(
      isSameMachineHost({
        clientOs,
        host: network,
        localHostKey: "other",
        path: "/home/work",
      }),
      false,
    );
    assert.equal(
      isSameMachineHost({ clientOs, host: loopback, path: "C:\\work" }),
      false,
    );
    assert.equal(
      isSameMachineHost({ clientOs, host: loopback, path: "//server/work" }),
      false,
    );
    assert.equal(
      isSameMachineHost({ clientOs, host: loopback, path: "work" }),
      false,
    );
  }
});

test("スマホでは同じマシンのパスでも表示しない", () => {
  assert.equal(
    isSameMachineHost({
      clientOs: undefined,
      host: loopback,
      path: "/home/work",
    }),
    false,
  );
});

test("OSに合わせたラベルを表示する", () => {
  assert.equal(
    revealInFileManagerLabelKey("windows"),
    "Reveal in File Explorer",
  );
  assert.equal(revealInFileManagerLabelKey("macos"), "Reveal in Finder");
  assert.equal(revealInFileManagerLabelKey("linux"), "Open Containing Folder");
});

test("Hostのパスの区切りで絶対パスを作る", () => {
  assert.equal(
    joinHostPath("C:\\work", "sub/file.txt"),
    "C:\\work\\sub\\file.txt",
  );
  assert.equal(
    joinHostPath("C:/work/", "sub/file.txt"),
    "C:\\work\\sub\\file.txt",
  );
  assert.equal(joinHostPath("C:\\", "file.txt"), "C:\\file.txt");
  assert.equal(joinHostPath("/work/", "sub/file.txt"), "/work/sub/file.txt");
  assert.equal(joinHostPath("/", "file.txt"), "/file.txt");
});
