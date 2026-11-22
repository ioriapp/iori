import { once } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { hooks } from "./hooks.ts";
import { hookInstallContext } from "../hook-install.ts";

test("OpenCode V2 presents overlapping permissions one at a time and replies to each request", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "iori-opencode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const variables = {
    XDG_CONFIG_HOME: root,
    IORI_CLI_HOOK_URL: "http://127.0.0.1",
    IORI_CLI_APPROVAL_FILE: join(root, "route"),
  };
  for (const [name, value] of Object.entries(variables)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const client = join(root, "approval-client.mjs");
  // Hold each Host reply until the user answers, while the plugin receives events.
  await writeFile(
    client,
    `
    import { EventEmitter } from "node:events";
    export const presented = new EventEmitter();
    export const requests = [];
    export function approvalRequest(payload) {
      const { promise, resolve } = Promise.withResolvers();
      requests.push({ id: payload.id, answer: resolve });
      presented.emit("request");
      return promise;
    }
  `,
  );
  const { requests, presented } = await import(pathToFileURL(client).href);
  const ctx = await hookInstallContext(
    { id: "bash", label: "Bash", executable: "bash", args: [] },
    "opencode",
    "",
    false,
  );
  await hooks.install({
    ...ctx,
    script: join(root, "hook.mjs"),
    writtenPath: join(root, "written.json"),
  });
  const { default: plugin } = await import(
    pathToFileURL(join(root, "opencode/plugins/iori-status.js")).href
  );
  const received = Promise.withResolvers<void>();
  const replies: unknown[] = [];
  const answered = Promise.withResolvers<void>();
  const stop = await plugin.setup({
    session: { hook: async () => {} },
    event: {
      subscribe: async function* () {
        for (const id of ["first", "second"])
          yield {
            type: "permission.asked",
            data: {
              id,
              sessionID: "session",
              action: "shell",
              resources: ["pwd"],
            },
          };
        received.resolve();
      },
    },
    permission: {
      reply: async (reply: unknown) => {
        replies.push(reply);
        if (replies.length === 2) answered.resolve();
      },
    },
  });
  t.after(stop);
  await received.promise;
  assert.deepEqual(
    requests.map((request: { id: string }) => request.id),
    ["first"],
  );
  const next = once(presented, "request");
  requests[0].answer({ decision: "allow" });
  await next;
  assert.equal(requests[1].id, "second");
  requests[1].answer({ decision: "deny" });
  await answered.promise;
  assert.deepEqual(replies, [
    { sessionID: "session", requestID: "first", decision: "once" },
    { sessionID: "session", requestID: "second", decision: "reject" },
  ]);
});
