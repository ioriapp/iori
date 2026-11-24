import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { HostStore } from "../store.ts";
import { forgeProviders } from "./registry.ts";

test(
  "GitHubのCI操作は書き込み権限のあるアカウントで指定の実行だけに送る",
  { skip: process.platform === "win32" && "台本のghはPOSIX専用" },
  async (t) => {
    const bin = await mkdtemp(join(tmpdir(), "iori-gh-ci-"));
    t.after(() => rm(bin, { recursive: true, force: true }));
    const calls = join(bin, "calls");
    await writeFile(
      join(bin, "gh"),
      `#!/bin/sh
case "$1 $2" in
  "auth status") echo '[{"login":"reader","active":true,"state":"success"},{"login":"writer","active":false,"state":"success"},{"login":"z-other","active":false,"state":"success"}]' ;;
  "auth token") echo "$6" ;;
  "api --hostname")
    case "$4" in
      --paginate) echo '[{"workflow_runs":[],"check_runs":[],"statuses":[]}]' ;;
      /repos/org/repo)
        if [ -n "$GH_TOKEN" ]; then echo '{"permissions":{"push":true}}'; else echo '{"permissions":{"push":false}}'; fi ;;
      --method)
        case "$GH_TOKEN" in writer) login=writer ;; *) login=other ;; esac
        echo "$login $*" >> "$(dirname "$0")/calls"
        case "$6" in */99/cancel) echo 'gh: write refused (HTTP 403)' >&2; exit 1 ;; esac ;;
      *) exit 1 ;;
    esac ;;
  *) exit 1 ;;
esac
`,
      { mode: 0o755 },
    );
    const oldPath = process.env.PATH;
    process.env.PATH = [bin, oldPath].join(delimiter);
    t.after(() => {
      process.env.PATH = oldPath;
    });
    const store = new HostStore(":memory:");
    t.after(() => store.close());
    const repository = { store, mainPath: bin };
    const target = {
      remoteHost: "github.com",
      origin: "https://github.com",
      owner: "org",
      repo: "repo",
      sha: "abc",
      branch: "main",
    };
    const ci = forgeProviders.find((provider) => provider.id === "github")?.ci;
    assert.ok(ci?.rerun && ci.cancel);
    const read = await ci.read(target, repository);
    assert.equal(read.canRerun, true);
    assert.equal(read.canCancel, true);
    await ci.rerun(target, "41", false, repository);
    await ci.rerun(target, "42", true, repository);
    await ci.cancel(target, "43", repository);
    await assert.rejects(ci.cancel(target, "99", repository), {
      reason: "insufficient-scope",
      message: "GitHub unavailable",
    });
    const post =
      "writer api --hostname github.com --method POST /repos/org/repo/actions/runs";
    assert.deepEqual((await readFile(calls, "utf8")).trimEnd().split("\n"), [
      `${post}/41/rerun`,
      `${post}/42/rerun-failed-jobs`,
      `${post}/43/cancel`,
      `${post}/99/cancel`,
    ]);
  },
);
