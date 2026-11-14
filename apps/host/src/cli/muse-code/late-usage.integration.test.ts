import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { monitorUsage as monitorCodex } from "../codex/usage.ts";
import { monitorUsage as monitorMuse } from "./usage.ts";

for (const [kind, monitor] of [
  ["muse", monitorMuse],
  ["codex", monitorCodex],
] as const) {
  test(`${kind}: 中断の後に届いた CLI の応答で利用枠の監視がタイマーを作り直さない`, async () => {
    const root = await mkdtemp(join(tmpdir(), "iori-late-usage-"));
    const server = createServer();
    const finished = new Promise<void>((resolve) =>
      server.once("connection", (socket) => {
        socket.resume();
        socket.once("end", resolve);
      }),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    const controller = new AbortController();
    const events: unknown[] = [];
    let first!: () => void;
    const received = new Promise<void>((resolve) => {
      first = resolve;
    });
    const pending = monitor(
      {
        id: "bash",
        label: "bash",
        args: [],
        executable: fileURLToPath(
          new URL("./late-usage-shell.mjs", import.meta.url),
        ),
      },
      `${port} ${kind}`,
      controller.signal,
      (usage) => {
        events.push(usage);
        if (usage) first();
      },
      () => {},
      root,
    );
    try {
      await received;
      controller.abort();
      await assert.rejects(pending, { name: "AbortError" });
      const path = join(root, "cli-usage", "muse-code.json");
      const saved = kind === "muse" ? await readFile(path, "utf8") : undefined;
      await finished;
      assert.equal(events.length, 2);
      assert.equal(events[1], undefined);
      if (kind === "muse") assert.equal(await readFile(path, "utf8"), saved);
    } finally {
      server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
