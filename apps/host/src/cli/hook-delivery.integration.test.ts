import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HookReceiver } from "../terminal/daemon/hook-receiver.ts";
import { hookInstallContext } from "./hook-install.ts";
import { hooks as opencode } from "./opencode/hooks.ts";
import { hooks as pi } from "./pi/hooks.ts";
import { hooks as claude } from "./claude/hooks.ts";
import type { CliHooks } from "./hooks.ts";
import type { CliStatus } from "@iori/protocol";

// E2E cannot cut an HTTP response between its headers and body. Forward real
// installed hooks to the real receiver, then truncate only the first reply.
test("応答が途中で切れても後の状態が受け手へ届く", async (t) => {
  for (const id of ["opencode", "pi", "claude"] as const) {
    await t.test(id, async () => {
      const home = await mkdtemp(join(tmpdir(), "iori-hook-delivery-"));
      const receiver = new HookReceiver();
      const states: string[] = [];
      const hooks: CliHooks = { opencode, pi, claude }[id];
      let previous: CliStatus | undefined;
      let first = true;
      await receiver.listen();
      const route = receiver.register(async (payload) => {
        const next = hooks.normalize(payload, previous);
        if (next) {
          previous = { ...next, since: Date.now() };
          states.push(next.state);
        }
      });
      const proxy = createServer((incoming, outgoing) => {
        const forward = request(
          route.url,
          { method: "POST", headers: incoming.headers },
          (response) => {
            if (first) {
              first = false;
              response.resume();
              outgoing.writeHead(200, {
                "Content-Length": "10",
                Connection: "close",
              });
              outgoing.write("x", () => outgoing.socket?.end());
            } else {
              outgoing.writeHead(response.statusCode ?? 500);
              response.pipe(outgoing);
            }
          },
        );
        forward.once("error", (error) => outgoing.destroy(error));
        incoming.pipe(forward);
      });
      let child: ReturnType<typeof spawn> | undefined;
      try {
        proxy.listen(0, "127.0.0.1");
        await once(proxy, "listening");
        const address = proxy.address();
        assert.ok(address && typeof address === "object");
        const names = ["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"];
        const original = names.map((name) => process.env[name]);
        let script: string;
        try {
          process.env.HOME = home;
          process.env.XDG_CONFIG_HOME = join(home, ".config");
          process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
          const ctx = await hookInstallContext(
            { id: "bash", label: "Bash", executable: "/bin/bash", args: [] },
            id,
          );
          if (id !== "claude") await hooks.install(ctx);
          script = ctx.script;
        } finally {
          names.forEach((name, index) => {
            if (original[index] === undefined) delete process.env[name];
            else process.env[name] = original[index];
          });
        }
        const env = {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([name]) => !name.startsWith("IORI_"),
            ),
          ),
          HOME: home,
          IORI_CLI_HOOK_URL: `http://127.0.0.1:${address.port}/`,
        };
        let source: string;
        if (id === "opencode") {
          const plugin = pathToFileURL(
            join(home, ".config/opencode/plugins/iori-status.js"),
          ).href;
          source = `
            const { default: plugin } = await import(${JSON.stringify(plugin)});
            const hooks = await plugin.server();
            hooks.event({event:{type:'session.status',properties:{sessionID:'session',status:{type:'busy'}}}});
            await hooks['tool.execute.before']({tool:'bash',callID:'tool'}, {args:{command:'pwd'}});
            hooks.event({event:{type:'session.status',properties:{sessionID:'session',status:{type:'idle'}}}});
          `;
        } else if (id === "pi") {
          const plugin = pathToFileURL(
            join(home, ".pi/agent/extensions/iori-agent-status.ts"),
          ).href;
          source = `
            const { default: install } = await import(${JSON.stringify(plugin)});
            const handlers = new Map();
            install({on:(event, handle)=>handlers.set(event, handle)});
            handlers.get('before_agent_start')();
            handlers.get('tool_call')({toolName:'bash',toolCallId:'tool',input:{command:'pwd'}});
            handlers.get('agent_settled')({aborted:false});
          `;
        } else {
          source = `
            const { spawnSync } = await import('node:child_process');
            for (const event of ['UserPromptSubmit','PreToolUse','Stop']) {
              const result = spawnSync(process.execPath, [${JSON.stringify(script)}, event, '-', 'claude'], {
                env:process.env, input:JSON.stringify({tool_name:'Bash',tool_input:{command:'pwd'}}), encoding:'utf8'
              });
              if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(result.status ?? 1); }
            }
          `;
        }
        child = spawn(
          process.execPath,
          ["--input-type=module", "--eval", source],
          {
            env,
            stdio: ["ignore", "ignore", "pipe"],
          },
        );
        let errors = "";
        child.stderr?.on("data", (chunk) => {
          errors += chunk;
        });
        const [code] = await once(child, "close");
        assert.equal(code, 0, errors);
        assert.deepEqual(states, ["active", "active", "done"]);
      } finally {
        child?.kill();
        proxy.closeAllConnections();
        await new Promise<void>((resolve) => proxy.close(() => resolve()));
        await receiver.close();
        await rm(home, { recursive: true, force: true });
      }
    });
  }
});
