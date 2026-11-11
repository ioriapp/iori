import { local as verificationLocal } from "../native/local.mjs";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/** Public remote refs only: this fixture never pushes or needs a token. */
export async function prepareForgeFixture(root) {
  const origin = verificationLocal.forge.origin;
  const repository = join(root, "forge-repository");
  const git = (path, ...args) =>
    execFileSync("git", ["-C", path, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  execFileSync(
    "git",
    [
      "clone",
      "--depth=1",
      "--no-checkout",
      `${origin}/${verificationLocal.forge.repository}.git`,
      repository,
    ],
    { stdio: "pipe" },
  );
  const branch = git(repository, "symbolic-ref", "--short", "HEAD");
  // Keep the tracked branch on a commit with public status, runs, jobs and logs.
  const sha = "134b0f8b8d4f50080ff824dac497a44136e75354";
  const failedSha = "6b16c7a5332e996a04c7ccd9c530ecdefe8e2aa2";
  const noCiSha = "efde2a6e6270f5a84531d27c3963388a42542254";
  git(repository, "fetch", "--depth=1", "origin", sha, failedSha, noCiSha);
  git(repository, "update-ref", `refs/heads/${branch}`, sha);
  git(repository, "update-ref", `refs/remotes/origin/${branch}`, sha);
  git(repository, "config", "push.default", "upstream");
  const longName =
    "feature/sidebar-worktree-name-keeps-the-start-and-the-important-ending";
  const longPath = join(root, "forge-repository-long-name");
  git(
    repository,
    "worktree",
    "add",
    "--no-checkout",
    "-b",
    longName,
    longPath,
    `origin/${branch}`,
  );
  const unpushed = join(root, "forge-repository-unpushed");
  git(
    repository,
    "worktree",
    "add",
    "--no-checkout",
    "--no-track",
    "-b",
    "without-push",
    unpushed,
    sha,
  );
  // Real CI of older commits on main, followed through local remote-tracking
  // refs that are never pushed: run 161 failed, and the first commit predates CI.
  git(
    repository,
    "config",
    "--add",
    "remote.origin.fetch",
    "+refs/heads/ci-*:refs/remotes/origin/ci-*",
  );
  const remoteHost = "forgejo-alias";
  git(
    repository,
    "remote",
    "set-url",
    "origin",
    `${remoteHost}:${verificationLocal.forge.repository}.git`,
  );
  const sharedRepository = join(root, "forge-shared-repository");
  execFileSync(
    "git",
    ["clone", "--shared", "--no-checkout", repository, sharedRepository],
    { stdio: "pipe" },
  );
  git(
    sharedRepository,
    "remote",
    "set-url",
    "origin",
    `${remoteHost}:${verificationLocal.forge.repository}.git`,
  );
  git(repository, "remote", "add", "github", "https://github.com/cli/cli.git");
  // A public GitHub repository, read with the Host's gh like any other.
  const githubRepository = join(root, "github-repository");
  execFileSync("git", ["init", "--quiet", githubRepository], { stdio: "pipe" });
  git(
    githubRepository,
    "-c",
    "user.name=iori E2E",
    "-c",
    "user.email=e2e@iori.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "init",
  );
  git(
    githubRepository,
    "remote",
    "add",
    "origin",
    "https://github.com/cli/cli.git",
  );
  const ciWorktree = (name, commit, remote = "origin") => {
    const path = join(root, `forge-repository-${name}`);
    git(repository, "update-ref", `refs/remotes/${remote}/${name}`, commit);
    git(
      repository,
      "worktree",
      "add",
      "--no-checkout",
      "-b",
      name,
      path,
      commit,
    );
    git(repository, "branch", `--set-upstream-to=${remote}/${name}`, name);
    return path;
  };
  const ciFailed = ciWorktree("ci-failed", failedSha);
  const ciNone = ciWorktree("ci-none", noCiSha);
  // GitHub without a gh login on the verification Host: a CI that cannot be read.
  const ciUnreadable = ciWorktree("ci-unreadable", sha, "github");
  const plainWorkspace = join(root, "plain-workspace");
  await mkdir(plainWorkspace);
  let releaseDetection;
  const released = new Promise((resolve) => {
    releaseDetection = resolve;
  });
  const controller = new globalThis.AbortController();
  // Hold a real Forgejo version response so both viewports can observe pending
  // detection while the ordinary settings values are already available.
  const pendingServer = createServer(async (request, response) => {
    try {
      await released;
      const upstream = await fetch(`${origin}${request.url}`, {
        signal: controller.signal,
      });
      response.writeHead(upstream.status, {
        "content-type": "application/json",
      });
      response.end(await upstream.text());
    } catch {
      response.destroy();
    }
  });
  await new Promise((resolve) => pendingServer.listen(0, "127.0.0.1", resolve));
  const pendingOrigin = `http://127.0.0.1:${pendingServer.address().port}`;
  git(
    repository,
    "remote",
    "add",
    "pending",
    `${pendingOrigin}/${verificationLocal.forge.repository}.git`,
  );
  return {
    repository,
    plainWorkspace,
    releaseDetection,
    async close() {
      controller.abort();
      releaseDetection();
      pendingServer.closeAllConnections();
      await new Promise((resolve) => pendingServer.close(resolve));
    },
    sharedRepository,
    githubRepository,
    branch,
    sha,
    origin,
    remoteHost,
    longName,
    longPath,
    unpushed,
    ciFailed,
    ciNone,
    ciUnreadable,
    failedSha,
  };
}

/** Compare with the live API at the point the scenario inspects the marks. */
export async function readForgeExpectation({ origin, sha }) {
  const response = await fetch(
    `${origin}/api/v1/repos/${verificationLocal.forge.repository}/commits/${sha}/status`,
  );
  if (!response.ok)
    throw new Error("公開Forgejoのチェックを取得できませんでした");
  const status = await response.json();
  const statuses = status.statuses ?? [];
  if (!statuses.length)
    throw new Error("公開Forgejoの対象commitにチェックがありません");
  const failed = statuses.find((value) =>
    ["failure", "error", "warning"].includes(value.status),
  );
  const running = statuses.find((value) => value.status === "pending");
  return { state: failed ? "failed" : running ? "running" : "passed" };
}

/** The runs and jobs of a commit and the end of its first job's log, from the live API. */
export async function readCiExpectation({ origin }, sha) {
  const api = `${origin}/api/v1/repos/${verificationLocal.forge.repository}`;
  const read = async (path) => {
    const response = await fetch(`${api}${path}`);
    if (!response.ok) throw new Error("公開ForgejoのCIを取得できませんでした");
    return response;
  };
  const runs = (await (await read(`/actions/runs?head_sha=${sha}`)).json())
    .workflow_runs;
  if (!runs.length)
    throw new Error("公開Forgejoの対象commitに実行がありません");
  const jobs = await Promise.all(
    runs.map(async (run) =>
      (await read(`/actions/runs/${run.id}/jobs`)).json(),
    ),
  );
  const log = await (await read(`/actions/jobs/${jobs[0][0].id}/logs`)).text();
  const failed = runs.find((run) => run.status === "failure");
  const running = runs.find((run) =>
    ["running", "waiting", "blocked"].includes(run.status),
  );
  return {
    runs: runs.map((run, index) => ({ ...run, jobs: jobs[index] })),
    browserUrl:
      (failed ?? running)?.html_url ??
      `${origin}/${verificationLocal.forge.repository}/commit/${sha}`,
    // The screen leaves out the time Forgejo writes before every line.
    firstLine: log.split("\n")[0].replace(/^\S+Z /u, ""),
    lastLine: log
      .trimEnd()
      .split("\n")
      .at(-1)
      .replace(/^\S+Z /u, ""),
  };
}

async function forgejoJson(origin, endpoint) {
  const response = await fetch(
    `${origin}/api/v1/repos/${verificationLocal.forge.repository}${endpoint}`,
  );
  if (!response.ok) throw new Error("公開ForgejoのIssueを取得できませんでした");
  return {
    value: await response.json(),
    total: Number(response.headers.get("x-total-count")),
  };
}

/** Read the live Issues the scenario compares with; nothing is written. */
export async function readIssuesExpectation({ origin }) {
  const open = (labels = []) =>
    forgejoJson(
      origin,
      `/issues?${new globalThis.URLSearchParams({
        state: "open",
        type: "issues",
        limit: "50",
        ...(labels.length ? { labels: labels.join(",") } : {}),
      })}`,
    );
  const first = await open();
  if (!first.value.length)
    throw new Error("公開ForgejoにOpenのIssueがありません");
  // A label of the newest Issues, and one Issue with comments to read.
  const counts = new Map();
  for (const issue of first.value)
    for (const label of issue.labels)
      counts.set(label.name, (counts.get(label.name) ?? 0) + 1);
  const label = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!label) throw new Error("公開ForgejoのOpenのIssueにラベルがありません");
  const labelled = await open([label]);
  const other = (await forgejoJson(origin, "/labels?limit=50")).value
    .map((value) => value.name)
    .find((name) => name !== label);
  const pair = other ? await open([label, other]) : undefined;
  const discussed = first.value.find((issue) => issue.comments >= 2);
  if (!discussed)
    throw new Error("公開ForgejoのOpenのIssueにコメントのあるものがありません");
  return {
    newest: first.value[0].number,
    total: first.total,
    label,
    labelledNewest: labelled.value[0]?.number,
    pair: pair && { labels: [label, other], total: pair.total },
    discussed: {
      number: discussed.number,
      comments: discussed.comments,
      body: Boolean(discussed.body),
    },
  };
}
