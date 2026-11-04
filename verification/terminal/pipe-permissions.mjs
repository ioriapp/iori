import assert from "node:assert/strict";
import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import addon from "../../apps/host/terminal-native/index.js";

export async function inspectNamedPipe(endpoint) {
  const { stdout } = await promisify(execFile)("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    fileURLToPath(new URL("./pipe-permissions.ps1", import.meta.url)),
    "-Name",
    endpoint.slice(endpoint.lastIndexOf("\\") + 1),
  ]);
  return JSON.parse(stdout);
}

export async function verifyPipePermissions() {
  const endpoint = `\\\\.\\pipe\\iori-verification-${randomUUID()}`;
  const server = createServer((socket) => socket.resume());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, resolve);
  });
  try {
    const before = await inspectNamedPipe(endpoint);
    addon.restrictTerminalPipe(endpoint);
    const after = await inspectNamedPipe(endpoint);
    assert.ok(
      before.otherReaders > 0,
      "the real Node default pipe grants read access outside the current user",
    );
    assert.equal(after.otherReaders, 0);
    assert.equal(after.onlyCurrentUser, true);
    return {
      defaultOtherReaders: before.otherReaders,
      restrictedOnlyCurrentUser: after.onlyCurrentUser,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
