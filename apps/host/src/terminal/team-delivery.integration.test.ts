import { stopTerminalDaemon } from "./daemon/launch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  FrameDecoder,
  decodeFrame,
  encodeFrame,
  type Event,
  type Response,
  type TerminalCreatedResult,
} from "@iori/protocol";
import { TerminalManager, type TeamTerminalOptions } from "./manager.ts";
import { HostStore } from "../store.ts";
import { cliDefinitions } from "../cli/definitions.ts";
import { code as piCode } from "../cli/pi/definition.ts";
import { loadNativeAddon, type NativeBiStream } from "../native.ts";

// E2E cannot force concurrent automatic inputs and a user key into a precise
// PTY byte order. Real PTYs emit Pi hooks through the production HTTP receiver;
// a user-key barrier on the same native stream proves that no automatic Enter
// reached the waiting selection or a CLI before its declared paste readiness,
// while an unmarked CLI accepts plain input without enabling paste mode.
// This does not rely on a timed absence check.
test(
  "waiting selections and unready CLIs never receive automatic input, preserve delivery order and discard inputs on stop",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "iori-team-delivery-"));
    const previousHome = process.env.HOME;
    const previousPi = process.env.PI_CODING_AGENT_DIR;
    process.env.HOME = root;
    process.env.PI_CODING_AGENT_DIR = join(root, "pi-agent");
    const actor = join(root, "actor.mjs"),
      command = join(root, "delivery-actor");
    const definitionIndex = cliDefinitions.findIndex(
      (cli) => cli.id === piCode.id,
    );
    const pi = cliDefinitions[definitionIndex]!;
    const definition = {
      ...pi,
      id: "pi",
      name: "Delivery actor",
      command,
      teamArguments: () => [],
    };
    cliDefinitions[definitionIndex] = definition;
    let terminals: TerminalManager | undefined;
    const store = new HostStore(join(root, "host.sqlite"));
    const addon = loadNativeAddon();
    const server = await addon.Endpoint.bind(
      addon.generateIdentity().secretKey,
      ["127.0.0.1:0"],
    );
    const client = await addon.Endpoint.bind(
      addon.generateIdentity().secretKey,
      ["127.0.0.1:0"],
    );
    const activeStreams: { stream: NativeBiStream; task: Promise<void> }[] = [];
    const readJson = async (name: string) => {
      for (;;) {
        try {
          return JSON.parse(await readFile(join(root, name), "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await nextTurn();
        }
      }
    };
    try {
      await writeFile(
        actor,
        `import {access,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path'; import {setImmediate as tick} from 'node:timers/promises';
const root=${JSON.stringify(root)};
if(process.argv.includes('--version')) {
  for(;;){try{await access(join(root,'pi-agent/extensions/iori-agent-status.ts'));break;}catch{await tick();}}
  console.log('1.1.0');process.exit();
}
const name=process.env.IORI_DELIVERY_ACTOR;
const url=process.env.IORI_CLI_HOOK_URL;
const save=async(file,value)=>{await writeFile(join(root,file+'.tmp'),JSON.stringify(value));await rename(join(root,file+'.tmp'),join(root,file));};
const post=async(hook_event_name,extra={})=>{if(url){const r=await fetch(url,{method:'POST',body:JSON.stringify({hook_event_name,iori_cli:'pi',...extra})});if(r.status!==204)throw new Error('hook rejected');}};
let waiting=true, received=[], partial='', serial=Promise.resolve();
process.stdin.setRawMode(true);process.stdin.resume();
process.stdin.on('data',chunk=>{serial=serial.then(async()=>{
  for(const char of chunk.toString()) {
    if(char==='\\x1f') await save(name+'-checkpoint.json',{waiting,received,partial});
    else if(char==='\\x1a') process.stdout.write('\\x1b[?2004h\\x1b[?2004l');
    else if(char==='\\x1c') process.stdout.write('\\x1b[?2004h');
    else if(char==='\\x1e'){waiting=false;await post('ui_prompt_end',{is_idle:false});}
    else if(char==='\\x1d'){waiting=true;await post('ui_prompt_start',{prompt_kind:'select',tool_input:{question:'Question'}});}
    else if(char==='\\r'){const bracketed=partial.startsWith('\\x1b[200~')&&partial.endsWith('\\x1b[201~');received.push({line:bracketed?partial.slice(6,-6):partial,waiting,bracketed});partial='';await save(name+'-received.json',received);}
    else partial+=char;
  }
});});
await post('session_start',{session_id:name,session_file:join(root,name+'-session.jsonl')});
await post('ui_prompt_start',{prompt_kind:'confirm',tool_input:{question:'Approval'}});
await save(name+'-ready.json',true);
`,
      );
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      await writeFile(
        command,
        `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(actor)} "$@"\n`,
      );
      await chmod(command, 0o700);
      const events: Event[] = [];
      terminals = await TerminalManager.create(
        store,
        (event) => events.push(event),
        root,
      );
      await terminals.activateTeamEvents();
      const incoming = server.accept().then((value) => {
        assert.ok(value);
        return value.handshake();
      });
      const connection = await client.connect(
        Buffer.from(server.publicKeyHex, "hex"),
        server.boundSockets,
      );
      const hostConnection = await incoming;
      // Bootstrap the real hook installation and version observation before
      // exercising both parent and child input on the same registry.
      const bootstrap = await terminals.createTerminal(
        { clientPublicKey: "test", operationId: randomUUID() },
        root,
        undefined,
        definition.id,
        {
          conversation: "bootstrap",
          env: { IORI_DELIVERY_ACTOR: "bootstrap" },
          team: {
            candidate: {
              id: "bootstrap",
              cli: definition.id,
              model: "test/model",
              tools: [],
              minimum: "",
            },
            instructions: "",
            instructionFile: actor,
            teamFilesDirectory: root,
            commandDirectory: root,
          },
        },
      );
      assert.ok(bootstrap.ok);
      while (
        !events.some(
          (event) =>
            event.type === "cli.version" && event.cliId === definition.id,
        )
      )
        await nextTurn();
      // Version/hook installation can finish before the spawned actor has
      // completed its startup hook. Do not tear it down in that handshake.
      await readJson("bootstrap-ready.json");
      await terminals.stopTeamTerminal(bootstrap.result.terminal.id);
      for (const name of ["parent", "child", "without-paste"]) {
        if (name === "without-paste") delete definition.waitForBracketedPaste;
        const options: TeamTerminalOptions = {
          conversation: "conversation",
          ...(name === "child" ? { role: "worker" } : {}),
          env: { IORI_DELIVERY_ACTOR: name },
          team: {
            candidate: {
              id: name,
              cli: definition.id,
              model: "test/model",
              tools: [],
              minimum: "",
            },
            instructions: "",
            instructionFile: actor,
            teamFilesDirectory: root,
            commandDirectory: root,
          },
        };
        const created: Response<TerminalCreatedResult> =
          await terminals.createTerminal(
            { clientPublicKey: "test", operationId: randomUUID() },
            root,
            undefined,
            definition.id,
            options,
          );
        assert.ok(created.ok);
        const id: string = created.result.terminal.id;
        await readJson(name + "-ready.json");
        // The actor's ready acknowledgement follows its waiting hook. Delivery
        // must already be held while presentation is still deferred.
        const stream = await connection.openBi();
        await stream.write(Buffer.from(encodeFrame({ kind: "terminal.seen" })));
        const hostStream = await hostConnection.acceptBi();
        const decoder = new FrameDecoder(),
          frames: unknown[] = [];
        const task = terminals.openStream(
          hostConnection,
          hostStream,
          {
            kind: "terminal",
            action: "open",
            operationId: randomUUID(),
            terminalId: id,
            viewId: randomUUID(),
            deviceClass: "desktop",
            cols: 80,
            rows: 24,
            snapshotMaxLines: 100,
            snapshotMaxBytes: 1024 * 1024,
            viewAttributes: {
              foreground: [255, 255, 255],
              background: [0, 0, 0],
              cursor: [255, 255, 255],
              ansi: Array.from(
                { length: 16 },
                () => [0, 0, 0] as [number, number, number],
              ),
              colorSchemeMode: "dark",
              cursorStyle: "block",
              cursorBlink: false,
            },
          },
          async () => {
            while (!frames.length) {
              const bytes = await hostStream.read(64 * 1024);
              if (bytes === null) return undefined;
              frames.push(...decoder.push(bytes).map(decodeFrame));
            }
            return frames.shift();
          },
        );
        activeStreams.push({ stream, task });
        const key = (data: string) =>
          stream.write(
            Buffer.from(encodeFrame({ kind: "terminal.input", data })),
          );
        if (!definition.waitForBracketedPaste) {
          await key("\x1e");
          await key("\x1f");
          assert.equal(
            (await readJson(name + "-checkpoint.json")).waiting,
            false,
          );
          assert.equal(
            await terminals.sendLine(id, "without-mode"),
            "delivered",
          );
          assert.deepEqual(await readJson(name + "-received.json"), [
            { line: "without-mode", waiting: false, bracketed: false },
          ]);
          await terminals.stopTeamTerminal(id);
          continue;
        }
        // A startup probe may enable paste and then disable it before the TUI.
        await key("\x1a");
        assert.deepEqual(
          await Promise.all([
            terminals.sendLine(id, "first"),
            terminals.sendLine(id, "second"),
          ]),
          ["queued", "queued"],
        );
        await key("\x1f");
        assert.deepEqual(await readJson(name + "-checkpoint.json"), {
          waiting: true,
          received: [],
          partial: "",
        });
        await rm(join(root, name + "-checkpoint.json"));
        await key("\x1e");
        await key("\x1f");
        assert.deepEqual(await readJson(name + "-checkpoint.json"), {
          waiting: false,
          received: [],
          partial: "",
        });
        await key("\x1c");
        for (;;) {
          const lines = await readJson(name + "-received.json");
          if (lines.length >= 2) {
            assert.deepEqual(lines, [
              { line: "first", waiting: false, bracketed: true },
              { line: "second", waiting: false, bracketed: true },
            ]);
            break;
          }
          await nextTurn();
        }
        await key("\x1d");
        for (;;) {
          const listed = terminals.list();
          assert.ok(listed.ok);
          if (
            listed.result.terminals.find((terminal) => terminal.id === id)
              ?.cliStatus?.attention?.kind === "question"
          )
            break;
          await nextTurn();
        }
        let deliveredOnStop = false;
        assert.equal(
          await terminals.sendLine(id, "discard-on-stop", () => {
            deliveredOnStop = true;
          }),
          "queued",
        );
        await rm(join(root, name + "-checkpoint.json"));
        await key("\x1f");
        assert.deepEqual(await readJson(name + "-checkpoint.json"), {
          waiting: true,
          partial: "",
          received: [
            { line: "first", waiting: false, bracketed: true },
            { line: "second", waiting: false, bracketed: true },
          ],
        });
        await terminals.stopTeamTerminal(id);
        assert.equal(deliveredOnStop, false);
        for (const suffix of ["ready", "received", "checkpoint"])
          await rm(join(root, name + "-" + suffix + ".json"), { force: true });
        assert.equal(await terminals.restartTeamTerminal(id, options), true);
        await readJson(name + "-ready.json");
        await key("\x1f");
        assert.deepEqual(await readJson(name + "-checkpoint.json"), {
          waiting: true,
          received: [],
          partial: "",
        });
        assert.equal(await terminals.sendLine(id, "after-restart"), "queued");
        await rm(join(root, name + "-checkpoint.json"));
        await key("\x1e");
        await key("\x1f");
        assert.deepEqual(await readJson(name + "-checkpoint.json"), {
          waiting: false,
          received: [],
          partial: "",
        });
        await key("\x1c");
        assert.deepEqual(await readJson(name + "-received.json"), [
          { line: "after-restart", waiting: false, bracketed: true },
        ]);
      }
    } finally {
      for (const item of activeStreams)
        await item.stream.finish().catch(() => {});
      await terminals?.close();
      await stopTerminalDaemon(root);
      await Promise.all(activeStreams.map((item) => item.task));
      await client.close();
      await server.close();
      store.close();
      cliDefinitions[definitionIndex] = pi;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPi === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousPi;
      await rm(root, { recursive: true, force: true });
    }
  },
);
