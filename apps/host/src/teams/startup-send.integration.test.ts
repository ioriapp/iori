import { stopTerminalDaemon } from "../terminal/daemon/launch.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { HostStore } from "../store.ts";
import { TerminalManager } from "../terminal/manager.ts";
import { TeamManager } from "./manager.ts";
import { type Candidate, type TeamDefinition } from "@iori/protocol";

const context = () => ({ clientPublicKey: "test", operationId: randomUUID() });

// E2E cannot force a send between copying the request and completing startup.
// The worker's real version command waits at the process boundary during launch.
test(
  "a message sent during startup goes to delivery after startup instead of the request file",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "iori-startup-send-"));
    const repository = join(root, "repository");
    await mkdir(repository);
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=iori test",
          "-c",
          "user.email=test@example.invalid",
          ...args,
        ],
        { cwd: repository },
      );
    git("init");
    await writeFile(join(repository, "README.md"), "fixture\n");
    git("add", "README.md");
    git("commit", "-m", "fixture");
    const actor = join(root, "actor.mjs");
    const workerCommand = join(root, "worker");
    await writeFile(
      actor,
      `import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access,readFile,readdir,writeFile,rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const root=${JSON.stringify(root)};
const save=async(file,data)=>{await writeFile(root+'/'+file+'.tmp',data);await rename(root+'/'+file+'.tmp',root+'/'+file);};
const wait=async file=>{for(;;){try{await access(root+'/'+file);return;}catch(e){if(e.code!=='ENOENT')throw e;await delay(10);}}};
if(process.argv.includes('--version')) {
 await wait('delegated');
 const child=JSON.parse(await readFile(root+'/delegated','utf8')).data.child;
 const directory=root+'/team-files/'+child;
 let copied;
 while(!copied) {
  const file=(await readdir(directory)).find(name=>name.startsWith('delegation-'));
  if(file && (await readFile(directory+'/'+file,'utf8')).includes('original request')) copied=file;
  else await delay(10);
 }
 await save('child-started',copied);
 await wait('release'); console.log('1.0.0'); process.exit();
}
if(process.argv[2]==='parent') {
 const run=promisify(execFile), cli=process.env.IORI_COMMAND_BIN+'/iori';
 const delegated=JSON.parse((await run(cli,['delegate','--role','Worker','--difficulty','low','--title','Task','--worktree','parent','--body','original request','--json'])).stdout);
 await save('delegated',JSON.stringify(delegated)); await wait('send');
 const sent=JSON.parse((await run(cli,['send',delegated.data.child,'--kind','request','--body','extra message','--json'])).stdout);
 await save('sent',JSON.stringify(sent));
} else {
 process.stdin.setRawMode(true); process.stdin.resume(); let line='', count=0, serial=Promise.resolve();
 process.stdin.on('data',chunk=>{serial=serial.then(async()=>{for(const ch of chunk.toString()){if(ch==='\\r'){const text=line.replace(/^\\x1b\\[200~/,'').replace(/\\x1b\\[201~$/,'');await save(count++===0?'initial':'received',text);line='';}else line+=ch;}});});
 process.stdout.write('\\x1b[?2004h');
}
process.stdin.resume(); setInterval(()=>{},1000);
`,
    );
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(
      workerCommand,
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(actor)} "$@"\n`,
    );
    await chmod(workerCommand, 0o700);
    const store = new HostStore(join(root, "host.sqlite"));
    const terminals = await TerminalManager.create(store, () => {}, root);
    const teams = await TeamManager.create(store, terminals, root);
    const readWhenPresent = async (path: string) => {
      for (;;) {
        try {
          return await readFile(path, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await delay(10);
        }
      }
    };
    try {
      const parent = await terminals.saveSimpleCliDefinition(context(), {
        name: "Startup parent",
        command: `${quote(process.execPath)} ${quote(actor)} parent`,
        modelArgument: "",
      });
      assert.ok(parent.ok && "cliId" in parent.result);
      const worker = await terminals.saveCliDefinition(
        context(),
        JSON.stringify({
          schema: 1,
          id: "startup-worker",
          name: "Startup worker",
          command: workerCommand,
          version: { args: ["--version"] },
          launch: {
            initialPrompt: {
              mode: "paste",
            },
          },
        }),
      );
      assert.ok(worker.ok && "cliId" in worker.result);
      const candidate: Candidate = {
        id: "child",
        cli: worker.result.cliId,
        model: "test/model",
        tools: [],
        minimum: "",
      };
      const definition: TeamDefinition = {
        name: "startup",
        description: "",
        instruction: "",
        parent: { ...candidate, id: "parent", cli: parent.result.cliId },
        roles: [
          {
            id: "worker",
            name: "Worker",
            when: "work",
            limit: "1",
            reuse: true,
            split: true,
            instruction: "",
            request: "",
            report: "",
            candidates: { high: [], medium: [], low: [candidate] },
          },
        ],
      };
      const team = store.teamOperation(context(), "teams.create", {
        definition,
      });
      assert.ok(team.ok);
      assert.ok(
        store.teamOperation(context(), "teams.settings", {
          enabled: true,
          defaultTeam: team.result.saved.id,
          limits: {},
        }).ok,
      );
      assert.ok(
        (await teams.launch(context(), team.result.saved.id, repository)).ok,
      );
      const delegated = JSON.parse(
        await readWhenPresent(join(root, "delegated")),
      );
      const copied = await readWhenPresent(join(root, "child-started"));
      const child = store
        .teamChildren()
        .find((item) => item.id === delegated.data.child)!;
      assert.match(
        await readFile(join(dirname(child.requestFile), copied), "utf8"),
        /original request/u,
      );
      assert.equal(child.state, "waiting");
      await writeFile(join(root, "send"), "");
      const sent = JSON.parse(await readWhenPresent(join(root, "sent")));
      assert.deepEqual(sent, {
        ok: true,
        text: "Message queued while the child starts; it will be delivered after the CLI starts.",
      });
      assert.doesNotMatch(
        await readFile(child.requestFile, "utf8"),
        /extra message/u,
      );
      await writeFile(join(root, "release"), "");
      const initial = await readWhenPresent(join(root, "initial"));
      assert.match(initial, /delegation-/u);
      assert.doesNotMatch(initial, /extra message/u);
      const initialFile = initial.match(
        /Read .+ and follow its instructions\. Then open the file (.+?) with your file-reading tool/u,
      )?.[1];
      assert.ok(initialFile);
      const initialRequest = await readFile(initialFile, "utf8");
      assert.match(initialRequest, /original request/u);
      assert.doesNotMatch(initialRequest, /extra message/u);
      const received = await readWhenPresent(join(root, "received"));
      assert.match(received, /\[iori\] Parent message: Open the file /u);
      const deliveredFile = received.match(
        /Open the file (.+?) with your file-reading tool/u,
      )?.[1];
      assert.ok(deliveredFile);
      assert.equal(await readFile(deliveredFile, "utf8"), "extra message");
      assert.equal(
        store.teamChildren().find((item) => item.id === child.id)?.state,
        "running",
      );
    } finally {
      await writeFile(join(root, "release"), "");
      await teams.close();
      await terminals.close();
      await stopTerminalDaemon(root);
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
