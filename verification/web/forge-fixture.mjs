import { forgeFixture } from "../host/forge-fixture.mjs";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/** Local Git history and a loopback Forge with fixed data. */
export async function prepareForgeFixture(root) {
  const fixtureRoot = join(root, "forge-fixture");
  await mkdir(join(fixtureRoot, "bin"), { recursive: true });
  let cleanup;
  const forge = await forgeFixture(
    {
      after: (fn) => {
        cleanup = fn;
      },
    },
    fixtureRoot,
    { web: true },
  );
  const { repository, origin } = forge;
  const git = (path, ...args) =>
    execFileSync("git", ["-C", path, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
      },
    }).trim();
  const noCiSha = forge.sha;
  git(repository, "commit", "--allow-empty", "-m", "failed");
  const failedSha = git(repository, "rev-parse", "HEAD");
  git(repository, "commit", "--allow-empty", "-m", "passed");
  const sha = git(repository, "rev-parse", "HEAD");
  const branch = "main";
  git(repository, "update-ref", "refs/remotes/origin/main", sha);
  const ci = (commit, run, status) => {
    const value = {
      id: run,
      index_in_repo: run,
      commit_sha: commit,
      workflow_id: "build.yml",
      status,
      event: "push",
      html_url: `${origin}/owner/repo/actions/runs/${run}`,
    };
    const jobs = [{ id: run + 100, name: "build", status }];
    forge.state.ci[commit] = { run, status, value, jobs };
    return {
      runs: [{ ...value, jobs }],
      browserUrl:
        status === "failure"
          ? value.html_url
          : `${origin}/owner/repo/commit/${commit}`,
    };
  };
  const currentCi = ci(sha, 8, "success");
  const failedCi = ci(failedSha, 7, "failure");
  const lines = [
    "first " + "wide ".repeat(400),
    ...Array.from({ length: 120 }, (_, index) => `line ${index}`),
    "⚙️ [runner]: exitcode '1': failure",
    ...Array.from({ length: 100 }, (_, index) => `after ${index}`),
    "last line",
  ];
  forge.state.log = lines.join("\n") + "\n";
  Object.assign(failedCi, { firstLine: lines[0], lastLine: lines.at(-1) });
  const allIssues = forge.issues;
  const issue = allIssues[0];
  const label = forge.labels[0].name;
  const other = forge.labels[1].name;
  const has = (item, name) => item.labels.some((value) => value.name === name);
  const issues = {
    newest: issue.number,
    total: allIssues.length,
    label,
    labelledNewest: allIssues.find((item) => has(item, label)).number,
    pair: {
      labels: [label, other],
      total: allIssues.filter((item) => has(item, label) && has(item, other))
        .length,
    },
    discussed: {
      number: issue.number,
      comments: forge.comments.length,
      body: Boolean(issue.body),
    },
  };
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
  // CI of older commits on main, followed through local remote-tracking
  // refs that are never pushed: one failed run and one commit without CI.
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
    `${remoteHost}:owner/repo.git`,
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
    `${remoteHost}:owner/repo.git`,
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
  // Hold the Forge version response so both viewports can observe pending
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
    `${pendingOrigin}/owner/repo.git`,
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
      await cleanup();
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
    issue,
    comments: forge.comments,
    issues,
    currentCi,
    failedCi,
  };
}

export async function readForgeExpectation(fixture) {
  return {
    state: fixture.currentCi.runs[0].status === "success" ? "passed" : "failed",
  };
}

export async function readCiExpectation(fixture, sha) {
  return sha === fixture.sha ? fixture.currentCi : fixture.failedCi;
}

export async function readIssuesExpectation(fixture) {
  return fixture.issues;
}
