// Isolated by command-receiver.integration.test.ts so unauthenticated bodies
// exceed the whole V8 heap, not just the configured read chunk.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { promisify } from "node:util";
import { CommandReceiver } from "./command-receiver.ts";

const root = await mkdtemp(join(tmpdir(), "iori-command-memory-"));
let calls = 0;
const receiver = new CommandReceiver(async (_caller, argv) => {
  calls += 1;
  if (calls === 1) assert.deepEqual(argv, ["tasks"]);
  else {
    assert.ok(Array.isArray(argv));
    assert.equal(argv[0], "report");
    assert.equal(argv[1], "--body");
    assert.equal(argv[2].length, 2 * 1024 * 1024);
  }
  return { ok: true, text: "called" };
});
try {
  await receiver.listen(root);
  const route = await receiver.register({ conversation: "memory-test" });
  const directory = route.env.IORI_COMMAND_DIRECTORY!;
  for (let round = 0; round < 2; round += 1) {
    const name = join(directory, `${randomUUID()}.request.json`);
    const file = await open(name + ".tmp", "wx");
    const chunk = Buffer.alloc(64 * 1024, " ");
    try {
      // A nested credential object and escaped quote must not authenticate
      // the containing envelope; the actual top-level auth is invalid.
      await file.write(
        '{"argv":[' +
          JSON.stringify({
            auth: route.env.IORI_COMMAND_AUTH,
            session: route.env.IORI_COMMAND_SESSION,
          }) +
          ',"report","--body","\\\"',
      );
      for (let count = 0; count < 1536; count += 1) await file.write(chunk);
      await file.write(
        '"],"auth":"' +
          "0".repeat(64) +
          '","session":"' +
          route.env.IORI_COMMAND_SESSION +
          '"}',
      );
    } finally {
      await file.close();
    }
    await rename(name + ".tmp", name);
    const response = name.replace(".request.json", ".response.json");
    let text: string | undefined;
    do {
      text = await readFile(response, "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        },
      );
      if (text === undefined) await nextTurn();
    } while (text === undefined);
    assert.equal(JSON.parse(text).ok, false);
    await rm(response);
    // A large invalid envelope is discarded without calling the Host.
    assert.equal(calls, 0);
  }
  const invalid = join(directory, `${randomUUID()}.request.json`);
  await writeFile(invalid + ".tmp", '{"argv":');
  await rename(invalid + ".tmp", invalid);
  const result = await promisify(execFile)(
    join(
      route.env.IORI_COMMAND_BIN!,
      process.platform === "win32" ? "iori.exe" : "iori",
    ),
    ["tasks"],
    { cwd: root, env: { ...process.env, ...route.env } },
  );
  assert.equal(result.stdout, "called\n");
  assert.equal(calls, 1);
  const bodyFile = join(root, "body.txt");
  await writeFile(bodyFile, Buffer.alloc(2 * 1024 * 1024, "a"));
  const large = await promisify(execFile)(
    join(
      route.env.IORI_COMMAND_BIN!,
      process.platform === "win32" ? "iori.exe" : "iori",
    ),
    ["report", "--file", bodyFile],
    { cwd: root, env: { ...process.env, ...route.env } },
  );
  assert.equal(large.stdout, "called\n");
  assert.equal(calls, 2);
} finally {
  await receiver.close();
  await rm(root, { recursive: true, force: true });
}
