import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const run = promisify(execFile);

// E2E cannot deterministically lose service-manager access during rollback.
// Substitute systemctl to inject the stop outcome and observe start requests;
// the updater, Linux adapter, extraction, moves, copies and result writes are real.
test(
  "Host rollback preserves data when stop is denied",
  { skip: process.platform !== "linux" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "iori-update-"));
    try {
      const bundle = join(root, "bundle"),
        work = join(root, "work"),
        storage = join(root, "storage");
      for (const directory of [
        bundle,
        work,
        storage,
        join(root, "new"),
        join(root, "bin"),
      ])
        await mkdir(directory);
      await writeFile(join(bundle, "version"), "old");
      await writeFile(join(root, "new/version"), "new");
      for (const file of ["host.sqlite", "host.sqlite-wal", "host.sqlite-shm"])
        await writeFile(join(storage, file), `before:${file}`);
      const archive = join(work, "host.tar.gz");
      await run("tar", ["-czf", archive, "-C", join(root, "new"), "."]);
      await writeFile(
        join(root, "bin/systemctl"),
        `#!${process.execPath}
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const root=${JSON.stringify(root)};
const state=join(root,'calls.json');
const calls=existsSync(state)?JSON.parse(readFileSync(state,'utf8')):[];
const operation=process.argv[3];calls.push(operation);writeFileSync(state,JSON.stringify(calls));
if(operation==='stop'&&calls.filter(x=>x==='stop').length===2)process.exit(1);
if(operation==='start'){
  if(readFileSync(join(root,'bundle/version'),'utf8')==='new'){
    for(const file of ['host.sqlite','host.sqlite-wal','host.sqlite-shm'])writeFileSync(join(root,'storage',file),'live:'+file);
    process.exit(1);
  }
  writeFileSync(join(root,'old-started'),'yes');
}
`,
        { mode: 0o700 },
      );
      const statusFile = join(root, "result.json");
      const request = join(work, "request.json");
      await writeFile(
        request,
        JSON.stringify({
          bundle,
          storage,
          archive,
          unit: "iori-update-test.service",
          statusFile,
          status: {
            operationId: "rollback",
            kind: "update",
            phase: "installing",
          },
        }),
      );
      // retain() writes only inside this isolated storage.
      await mkdir(join(storage, "maintenance"));
      await run(
        process.execPath,
        [resolve("scripts/release/update.mjs"), request],
        {
          env: {
            ...process.env,
            PATH: join(root, "bin") + ":" + process.env.PATH,
            XDG_RUNTIME_DIR: join(root, "runtime"),
          },
        },
      );
      assert.equal(await readFile(join(bundle, "version"), "utf8"), "old");
      assert.equal(await readFile(join(root, "old-started"), "utf8"), "yes");
      for (const file of ["host.sqlite", "host.sqlite-wal", "host.sqlite-shm"])
        assert.equal(
          await readFile(join(storage, file), "utf8"),
          `live:${file}`,
        );
      const status = JSON.parse(await readFile(statusFile, "utf8"));
      assert.equal(status.reason, "restore-data");
      assert.equal(status.restored, false);
      assert.equal(status.stage, "stop");
      assert.equal(await readFile(join(work, "failed/version"), "utf8"), "new");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
