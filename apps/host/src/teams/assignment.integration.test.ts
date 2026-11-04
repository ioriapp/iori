import { stopTerminalDaemon } from "../terminal/daemon/launch.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";
import { HostStore } from "../store.ts";
import { TerminalManager } from "../terminal/manager.ts";
import { TeamManager } from "./manager.ts";
import { limitKey, type Candidate, type TeamDefinition } from "@iori/protocol";
const context = () => ({ clientPublicKey: "test", operationId: randomUUID() });

// Independent agents can call delegate simultaneously. A UI scenario cannot
// force that interleaving. The actual shell actors call the shipped command;
// the production allocator and PTY process inventory enforce the limit.
test("simultaneous delegations respect process limits, advance after stop, and never remove a worktree used by another child", async () => {
  const root = await mkdtemp(join(tmpdir(), "iori-assignment-test-"));
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
      { cwd: repository, encoding: "utf8" },
    );
  git("init");
  await writeFile(join(repository, "README.md"), "fixture\n");
  git("add", "README.md");
  git("commit", "-m", "fixture");
  const actor = join(root, "actor.mjs"),
    resultFile = join(root, "requests.json");
  const foreignChildFile = join(root, "foreign-child.txt"),
    deniedFile = join(root, "foreign-denied.json");
  const quote = (v: string) =>
    process.platform === "win32"
      ? `'${v.replaceAll("'", "''")}'`
      : `'${v.replaceAll("'", "'\\''")}'`;
  await writeFile(
    actor,
    `import {execFile} from 'node:child_process'; import {promisify} from 'node:util'; import {writeFile,rename,readFile,rm} from 'node:fs/promises'; import {watch} from 'node:fs';
const exec=promisify(execFile);
const command=process.env.IORI_COMMAND_BIN+${JSON.stringify(process.platform === "win32" ? "\\iori.exe" : "/iori")};
if(process.argv[2]==='parent') {
 const outputs=await Promise.all([1,2,3].map(i=>exec(command,['delegate','--role','Worker','--difficulty','low','--title','Task '+i,'--worktree','new','--body','work','--json'])));
 let controlling=false;
 const control=watch(${JSON.stringify(root)},async(_event,name)=>{
   if(name!=='parent-command.json'||controlling)return;
   controlling=true;
   try {
   const argv=JSON.parse(await readFile(${JSON.stringify(join(root, "parent-command.json"))},'utf8'));
   await rm(${JSON.stringify(join(root, "parent-command.json"))});
   const result=await exec(command,[...argv]).then(r=>JSON.parse(r.stdout),e=>JSON.parse(e.stdout));
   await writeFile(${JSON.stringify(join(root, "parent-result.json.tmp"))},JSON.stringify(result));await rename(${JSON.stringify(join(root, "parent-result.json.tmp"))},${JSON.stringify(join(root, "parent-result.json"))});
   } catch(error) {if(error.code!=='ENOENT')throw error;} finally {controlling=false;}
 });
 await writeFile(${JSON.stringify(resultFile + ".tmp")},JSON.stringify(outputs.map(r=>JSON.parse(r.stdout)))); await rename(${JSON.stringify(resultFile + ".tmp")}, ${JSON.stringify(resultFile)});
} else if (process.argv[2] === 'other-parent') {
 const child=await readFile(${JSON.stringify(foreignChildFile)},'utf8');
 const denied=await exec(command,['finish',child,'--decision','accept','--reason','foreign attempt','--worktree','keep','--json']).then(r=>JSON.parse(r.stdout),e=>JSON.parse(e.stdout));
 await writeFile(${JSON.stringify(deniedFile + ".tmp")},JSON.stringify({denied}));await rename(${JSON.stringify(deniedFile + ".tmp")},${JSON.stringify(deniedFile)});
} else {
 const denied=await exec(command,['tasks','--json']).then(r=>JSON.parse(r.stdout),e=>JSON.parse(e.stdout));
 await writeFile('child-denied.json.tmp',JSON.stringify(denied)); await rename('child-denied.json.tmp','child-denied.json');
}
process.stdout.write('actor ready\\n'); process.stdin.resume(); setInterval(()=>{},1000);
`,
  );
  const store = new HostStore(join(root, "host.sqlite"));
  const terminals = await TerminalManager.create(store, () => {}, root);
  const teams = await TeamManager.create(store, terminals, root);
  try {
    // The actors are CLIs added by name and launch command.
    const addCli = async (name: string, role: string) => {
      const added = await terminals.saveSimpleCliDefinition(context(), {
        name,
        command: `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} ${quote(actor)} ${role}`,
        modelArgument: "",
      });
      assert.ok(added.ok && "cliId" in added.result);
      return added.result.cliId;
    };
    const parent = await addCli("Parent actor", "parent");
    const worker = await addCli("Worker actor", "worker");
    const candidate: Candidate = {
      id: "child",
      cli: worker,
      model: "test/model",
      tools: [],
      minimum: "",
    };
    const definition: TeamDefinition = {
      name: "concurrency",
      description: "",
      instruction: "",
      parent: { ...candidate, id: "parent", cli: parent },
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
        {
          id: "reviewer",
          name: "Reviewer",
          when: "continued work",
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
    const team = store.teamOperation(context(), "teams.create", { definition });
    assert.ok(team.ok);
    assert.ok(
      store.teamOperation(context(), "teams.settings", {
        enabled: true,
        defaultTeam: team.result.saved.id,
        limits: { [limitKey(candidate.cli, "cli")]: "1" },
      }).ok,
    );
    const response = await teams.launch(
      context(),
      team.result.saved.id,
      repository,
    );
    assert.ok(response.ok);
    for (;;) {
      try {
        const results = JSON.parse(await readFile(resultFile, "utf8")) as {
          ok: boolean;
        }[];
        assert.equal(results.length, 3);
        assert.ok(results.every((r) => r.ok));
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await nextTurn();
      }
    }
    while (!store.teamChildren().some((c) => c.state === "running"))
      await nextTurn();
    assert.equal(
      store.teamChildren().filter((c) => c.state === "running").length,
      1,
    );
    assert.equal(
      store.teamChildren().filter((c) => c.state === "waiting").length,
      2,
    );
    assert.equal(
      terminals.runningClis().filter((c) => c.cli === candidate.cli).length,
      1,
    );
    const first = store.teamChildren().find((c) => c.state === "running")!;
    // A valid credential from a second parent must still fail to finish this
    // conversation's child. This uses real per-PTY secrets and the real command.
    await writeFile(foreignChildFile, first.id);
    const other = await addCli("Other parent actor", "other-parent");
    const otherTeam = store.teamOperation(context(), "teams.create", {
      definition: {
        ...definition,
        name: "other conversation",
        parent: { ...definition.parent, cli: other },
      },
    });
    assert.ok(otherTeam.ok);
    assert.ok(
      (await teams.launch(context(), otherTeam.result.saved.id, repository)).ok,
    );
    for (;;) {
      try {
        assert.deepEqual(
          JSON.parse(await readFile(deniedFile, "utf8")).denied,
          { ok: false, text: "Child does not belong to this conversation." },
        );
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await nextTurn();
      }
    }
    assert.equal(
      store.teamChildren().find((child) => child.id === first.id)!.state,
      "running",
    );
    assert.equal(
      store.teamTasks().find((task) => task.id === first.task)!.decision,
      undefined,
    );
    for (;;) {
      try {
        assert.deepEqual(
          JSON.parse(
            await readFile(join(first.cwd!, "child-denied.json"), "utf8"),
          ),
          { ok: false, text: "Only the parent can use this command." },
        );
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await nextTurn();
      }
    }
    await writeFile(
      join(root, "parent-command.json.tmp"),
      JSON.stringify(["stop", first.id, "--json"]),
    );
    await rename(
      join(root, "parent-command.json.tmp"),
      join(root, "parent-command.json"),
    );
    for (;;) {
      try {
        assert.deepEqual(
          JSON.parse(await readFile(join(root, "parent-result.json"), "utf8")),
          { ok: true, text: "Child stopped by parent." },
        );
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await nextTurn();
      }
    }
    while (
      !store
        .teamChildren()
        .some((c) => c.id !== first.id && c.state === "running")
    )
      await nextTurn();
    assert.equal(
      store.teamChildren().find((c) => c.id === first.id)!.state,
      "stopped",
    );
    assert.equal(
      store.teamChildren().filter((c) => c.state === "running").length,
      1,
    );
    assert.equal(
      terminals.runningClis().filter((c) => c.cli === candidate.cli).length,
      1,
    );
    assert.equal(
      store.teamChildren().filter((c) => c.state === "waiting").length,
      1,
    );
    const parentCommand = async (argv: string[]) => {
      await rm(join(root, "parent-result.json"), { force: true });
      await writeFile(
        join(root, "parent-command.json.tmp"),
        JSON.stringify(argv),
      );
      await rename(
        join(root, "parent-command.json.tmp"),
        join(root, "parent-command.json"),
      );
      for (;;) {
        try {
          return JSON.parse(
            await readFile(join(root, "parent-result.json"), "utf8"),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await nextTurn();
        }
      }
    };
    // A new revision and the delayed finish of a stopped revision belong to
    // different child lifetimes, even though they share one task and folder.
    const continuation = await parentCommand([
      "delegate",
      "--role",
      "Reviewer",
      "--difficulty",
      "low",
      "--title",
      "Continuation",
      "--continue",
      first.task,
      "--worktree",
      first.cwd!.split(/[\\/]/u).at(-1)!,
      "--body",
      "continued work",
      "--json",
    ]);
    assert.equal(continuation.ok, true);
    for (const previous of store
      .teamChildren()
      .filter(
        (child) =>
          child.id !== first.id && child.id !== continuation.data.child,
      )) {
      assert.deepEqual(await parentCommand(["stop", previous.id, "--json"]), {
        ok: true,
        text: "Child stopped by parent.",
      });
    }
    while (
      store.teamChildren().find((child) => child.id === continuation.data.child)
        ?.state !== "running"
    )
      await nextTurn();
    assert.deepEqual(
      await parentCommand([
        "finish",
        first.id,
        "--decision",
        "accept",
        "--reason",
        "older revision",
        "--worktree",
        "remove",
        "--discard",
        "--json",
      ]),
      {
        ok: false,
        text: "Another child uses this worktree. Use --worktree keep.",
      },
    );
  } finally {
    await teams.close();
    await terminals.close();
    await stopTerminalDaemon(root);
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
