import assert from "node:assert/strict";
import { test } from "node:test";
import {
  access,
  chmod,
  chown,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setImmediate as nextTurn } from "node:timers/promises";
import { LocalTeamCommand } from "./local-command.ts";
import type { TeamCommand } from "./commands.ts";

// The browser cannot supply local paths or symlinks to the CLI. Run the actual
// command client with a separate cwd and the real mailbox receiver.
test("--file never sends outside files or escaping symlinks to the Host", async () => {
  const root = await mkdtemp(join(tmpdir(), "iori-command-test-"));
  const cwd = join(root, "work");
  const calls: TeamCommand[] = [];
  const receiver = new LocalTeamCommand(async (_caller, command) => {
    calls.push(command);
    return { ok: true, text: "called" };
  });
  try {
    await mkdir(cwd);
    await mkdir(join(root, "work-other"));
    const outside = join(root, "work-other", "outside.txt");
    await writeFile(outside, "outside body");
    await writeFile(join(cwd, "inside.txt"), "inside body\nsecond line");
    await symlink(outside, join(cwd, "escape.txt"));
    await symlink(cwd, join(root, "work-link"), "dir");
    await receiver.listen(root);
    const route = await receiver.register({
      conversation: "a",
      child: "worker",
    });
    const client = join(
      route.env.IORI_COMMAND_BIN!,
      process.platform === "win32" ? "iori.exe" : "iori",
    );
    const options = { cwd, env: { ...process.env, ...route.env } };
    const run = promisify(execFile);
    for (const path of [outside, "../work-other/outside.txt", "escape.txt"]) {
      await assert.rejects(
        run(client, ["report", "--file", path], options),
        (error: unknown) => {
          assert.ok(error instanceof Error && "stderr" in error);
          assert.equal(
            error.stderr,
            "--file は作業フォルダーの中のファイルだけ読めます。他は --body - で渡してください\n",
          );
          return true;
        },
      );
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(
      await readdir(route.env.IORI_COMMAND_DIRECTORY!),
      process.platform === "win32" ? ["iori.exe"] : [],
    );
    const result = await run(client, ["report", "--file", "inside.txt"], {
      ...options,
      cwd: join(root, "work-link"),
    });
    assert.equal(result.stdout, "called\n");
    assert.deepEqual(calls, [
      { kind: "report", body: "inside body\nsecond line" },
    ]);
    // Outside content may still be supplied by a read authorized by the CLI.
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        client,
        ["ask", "--body", "-"],
        options,
        (error) => (error ? reject(error) : resolve()),
      );
      child.stdin!.end("authorized outside body");
    });
    assert.deepEqual(calls[1], {
      kind: "ask",
      body: "authorized outside body",
    });
  } finally {
    await receiver.close();
    await rm(root, { recursive: true, force: true });
  }
});

// The browser cannot pre-create the CLI temp base with another uid, writable
// permissions or a symlink. Register real routes and exchange real commands.
test(
  "untrusted command bases never hold a mailbox or prevent team commands",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "iori-command-test-"));
    const receiver = new LocalTeamCommand(async () => ({
      ok: true,
      text: "called",
    }));
    try {
      await receiver.listen(root);
      const safe = join(root, "safe");
      const groupWritable = join(root, "group-writable");
      const worldWritable = join(root, "world-writable");
      const linked = join(root, "linked");
      const notDirectory = join(root, "file");
      await mkdir(safe, { mode: 0o700 });
      await mkdir(groupWritable);
      await chmod(groupWritable, 0o770);
      await mkdir(worldWritable);
      await chmod(worldWritable, 0o707);
      await symlink(safe, linked, "dir");
      await writeFile(notDirectory, "untouched");
      const unsafe = [groupWritable, worldWritable, linked, notDirectory];
      const foreign = join(root, "foreign");
      await mkdir(foreign, { mode: 0o700 });
      try {
        await chown(
          foreign,
          process.getuid!() === 0 ? 1 : 0,
          process.getgid!(),
        );
        unsafe.push(foreign);
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          // A single-uid user namespace reports EINVAL for an unmapped uid.
          (error.code === "EPERM" || error.code === "EINVAL")
        ))
          throw error;
        t.diagnostic(
          "Cannot change uid; writable and symlink bases cover fallback on this user.",
        );
      }
      for (const base of [safe, ...unsafe]) {
        const route = await receiver.register({ conversation: "a" }, base);
        const directory = route.env.IORI_COMMAND_DIRECTORY!;
        assert.equal(dirname(directory), base === safe ? safe : tmpdir());
        const info = await lstat(directory);
        assert.equal(info.uid, process.getuid!());
        assert.equal(info.mode & 0o777, 0o700);
        const result = await promisify(execFile)(
          join(route.env.IORI_COMMAND_BIN!, "iori"),
          ["tasks"],
          { cwd: root, env: { ...process.env, ...route.env } },
        );
        assert.equal(result.stdout, "called\n");
      }
      await receiver.close();
      for (const base of [safe, groupWritable, worldWritable, foreign])
        assert.deepEqual(await readdir(base), []);
      assert.equal((await lstat(groupWritable)).mode & 0o777, 0o770);
      assert.equal((await lstat(worldWritable)).mode & 0o777, 0o707);
      assert.equal((await lstat(linked)).isSymbolicLink(), true);
      assert.equal(await readFile(notDirectory, "utf8"), "untouched");
    } finally {
      await receiver.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

// A browser cannot create missing/bad local session credentials or cross a
// file-mailbox call into another conversation. Use the real ingress.
test("unauthenticated and mismatched conversation calls never reach parent commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "iori-command-test-"));
  const calls: string[] = [];
  const receiver = new LocalTeamCommand(async (caller) => {
    calls.push(caller.conversation);
    return { ok: true, text: "called" };
  });
  await receiver.listen(root);
  const a = await receiver.register({ conversation: "a" }),
    b = await receiver.register({ conversation: "b", child: "worker" });
  try {
    for (const envelope of [
      { argv: ["tasks"] },
      {
        session: a.env.IORI_COMMAND_SESSION,
        auth: b.env.IORI_COMMAND_AUTH,
        argv: ["tasks"],
      },
      {
        session: b.env.IORI_COMMAND_SESSION,
        auth: a.env.IORI_COMMAND_AUTH,
        argv: ["tasks"],
      },
    ]) {
      const id = randomUUID();
      const request = join(a.env.IORI_COMMAND_DIRECTORY!, `${id}.request.json`);
      const response = join(
        a.env.IORI_COMMAND_DIRECTORY!,
        `${id}.response.json`,
      );
      await writeFile(request + ".tmp", JSON.stringify(envelope), {
        flag: "wx",
        mode: 0o600,
      });
      await rename(request + ".tmp", request);
      let result: string | undefined;
      do {
        result = await readFile(response, "utf8").catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          },
        );
        if (result === undefined) await nextTurn();
      } while (result === undefined);
      assert.equal(JSON.parse(result).ok, false);
    }
    assert.deepEqual(calls, []);
    const result = await promisify(execFile)(
      join(
        a.env.IORI_COMMAND_BIN!,
        process.platform === "win32" ? "iori.exe" : "iori",
      ),
      ["tasks"],
      { cwd: root, env: { ...process.env, ...a.env } },
    );
    assert.equal(result.stdout, "called\n");
    assert.deepEqual(calls, ["a"]);
    a.dispose();
    while (
      await access(a.env.IORI_COMMAND_DIRECTORY!).then(
        () => true,
        () => false,
      )
    )
      await nextTurn();
  } finally {
    await receiver.close();
    await rm(root, { recursive: true, force: true });
  }
});

// A browser cannot plant a symlink in a CLI mailbox. The real ingress must
// finish handling the request without overwriting the file outside it.
test("a response temp symlink never overwrites its target outside the mailbox", async () => {
  const root = await mkdtemp(join(tmpdir(), "iori-command-test-"));
  const handled = Promise.withResolvers<void>();
  const receiver = new LocalTeamCommand(async () => {
    handled.resolve();
    return { ok: true, text: "called" };
  });
  try {
    await receiver.listen(root);
    const route = await receiver.register({ conversation: "a" });
    const victim = join(root, "victim.txt");
    await writeFile(victim, "untouched");
    const id = randomUUID();
    await symlink(
      victim,
      join(route.env.IORI_COMMAND_DIRECTORY!, `${id}.response.json.tmp`),
    );
    const request = join(
      route.env.IORI_COMMAND_DIRECTORY!,
      `${id}.request.json`,
    );
    await writeFile(
      request + ".tmp",
      JSON.stringify({
        session: route.env.IORI_COMMAND_SESSION,
        auth: route.env.IORI_COMMAND_AUTH,
        argv: ["tasks"],
      }),
    );
    await rename(request + ".tmp", request);
    await handled.promise;
    // close drains the real pending response before removing the mailbox.
    await receiver.close();
    assert.equal(await readFile(victim, "utf8"), "untouched");
  } finally {
    await receiver.close();
    await rm(root, { recursive: true, force: true });
  }
});
