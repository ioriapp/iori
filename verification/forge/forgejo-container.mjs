import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
// The official image at the version of the Owner's Forgejo (16.0.5).
const IMAGE = "codeberg.org/forgejo/forgejo:16.0.5";
const LABEL = "iori.verification=forgejo";
const OWNER_LABEL = "iori.verification.owner-pid";

const docker = async (...args) =>
  (await run("docker", args, { maxBuffer: 16 * 1024 * 1024 })).stdout.trim();

function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // If ownership cannot be observed, keep the container.
    return error.code !== "ESRCH";
  }
}

/** Remove only our labelled containers whose owner process has ended. */
async function removeStaleContainers() {
  const listed = await docker(
    "ps",
    "-a",
    "--filter",
    `label=${LABEL}`,
    "--format",
    `{{.ID}} {{.Label "${OWNER_LABEL}"}}`,
  );
  for (const line of listed.split("\n").filter(Boolean)) {
    const [id, pid] = line.split(" ");
    if (Number(pid) > 0 && !running(Number(pid)))
      await docker("rm", "-f", id).catch(() => undefined);
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/**
 * A disposable Forgejo with a private repository, an open PR and a failed
 * commit status, for reading private repositories with a token. It never
 * touches the Owner's Forgejo or other containers, and close() removes it.
 * Tokens are returned for the scenario to type; never record them.
 */
export async function startDisposableForgejo(
  root,
  { automationIssue = false } = {},
) {
  await removeStaleContainers();
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const name = `iori-verification-forgejo-${randomUUID().slice(0, 8)}`;
  await docker(
    "run",
    "-d",
    "--name",
    name,
    "--label",
    LABEL,
    "--label",
    `${OWNER_LABEL}=${process.pid}`,
    "-p",
    `127.0.0.1:${port}:3000`,
    "-e",
    "FORGEJO__security__INSTALL_LOCK=true",
    "-e",
    "FORGEJO__database__DB_TYPE=sqlite3",
    "-e",
    `FORGEJO__server__ROOT_URL=${origin}/`,
    "-e",
    "FORGEJO__server__DISABLE_SSH=true",
    "-e",
    "FORGEJO__service__DISABLE_REGISTRATION=true",
    // A sign-in-only site: every anonymous API read gets a 403.
    "-e",
    "FORGEJO__service__REQUIRE_SIGNIN_VIEW=true",
    // Info keeps the router's "completed GET …" lines for requested().
    "-e",
    "FORGEJO__log__LEVEL=Info",
    IMAGE,
  );
  const close = () => docker("rm", "-f", name).then(() => undefined);
  const ready = async () => {
    const deadline = Date.now() + 120_000;
    for (;;) {
      // Any HTTP answer means it listens; anonymous reads get a 403 here.
      const answered = await fetch(`${origin}/api/v1/version`)
        .then(() => true)
        .catch(() => false);
      if (answered) return;
      if (Date.now() > deadline)
        throw new Error("使い捨てのForgejoが起動しませんでした");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };
  try {
    await ready();
    const owner = "iori-owner";
    const password = randomBytes(18).toString("base64url");
    await docker(
      "exec",
      "-u",
      "git",
      name,
      "forgejo",
      "admin",
      "user",
      "create",
      "--admin",
      "--username",
      owner,
      "--password",
      password,
      "--email",
      "owner@example.invalid",
      "--must-change-password=false",
    );
    const token = async (tokenName, scopes, username = owner) =>
      (
        await docker(
          "exec",
          "-u",
          "git",
          name,
          "forgejo",
          "admin",
          "user",
          "generate-access-token",
          "--username",
          username,
          "--token-name",
          tokenName,
          "--scopes",
          scopes,
          "--raw",
        )
      )
        .split("\n")
        .at(-1);
    const setup = await token(
      "setup",
      "write:repository,write:issue,write:user",
    );
    const api = async (path, body, method = "POST") => {
      const response = await fetch(`${origin}/api/v1${path}`, {
        method,
        headers: {
          // Forgejo manages tokens only with the password (basic auth).
          authorization: path.includes("/tokens/")
            ? `Basic ${Buffer.from(`${owner}:${password}`).toString("base64")}`
            : `token ${setup}`,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok)
        throw new Error(`Forgejoの準備に失敗しました（${path}）`);
      return response.status === 204 ? undefined : response.json();
    };
    const repository = "private-repo";
    await api("/user/repos", {
      name: repository,
      private: true,
      auto_init: true,
      default_branch: "main",
    });
    let issueSetup;
    if (automationIssue) {
      const other = "iori-other";
      await docker(
        "exec",
        "-u",
        "git",
        name,
        "forgejo",
        "admin",
        "user",
        "create",
        "--username",
        other,
        "--password",
        randomBytes(18).toString("base64url"),
        "--email",
        "other@example.invalid",
        "--must-change-password=false",
      );
      await api(
        `/repos/${owner}/${repository}/collaborators/${other}`,
        { permission: "write" },
        "PUT",
      );
      const otherToken = await token(
        "issue-label",
        "write:issue,read:repository",
        other,
      );
      const label = await api(`/repos/${owner}/${repository}/labels`, {
        name: "agent-ready",
        color: "00aa00",
      });
      const a = await api(`/repos/${owner}/${repository}/issues`, {
        title: "Create issue file A",
        body: "Create issue.txt with this Issue number.",
      });
      const b = await api(`/repos/${owner}/${repository}/issues`, {
        title: "Create issue file B",
        body: "Create issue.txt with this Issue number.",
      });
      const prefix = `/repos/${owner}/${repository}`;
      issueSetup = {
        a,
        b,
        writeToken: await token(
          "iori-write",
          "read:repository,read:issue,read:user,write:repository",
        ),
        async label(number, byOther = false) {
          const response = await fetch(
            `${origin}/api/v1${prefix}/issues/${number}/labels`,
            {
              method: "POST",
              headers: {
                authorization: `token ${byOther ? otherToken : setup}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ labels: [label.id] }),
            },
          );
          if (!response.ok) throw new Error("Forgejoのlabel追加に失敗しました");
        },
        unlabel: (number) =>
          api(
            `${prefix}/issues/${number}/labels/${label.id}`,
            undefined,
            "DELETE",
          ),
        pulls: () => api(`${prefix}/pulls?state=open`, undefined, "GET"),
        timeline: (number) =>
          api(`${prefix}/issues/${number}/timeline`, undefined, "GET"),
        async configureGit(home) {
          const credentials = join(home, ".git-credentials");
          await writeFile(
            credentials,
            `${origin.replace("http://", `http://${owner}:${setup}@`)}/\n`,
            { mode: 0o600 },
          );
          await run("git", [
            "config",
            "--file",
            join(home, ".gitconfig"),
            "credential.helper",
            `store --file ${credentials}`,
          ]);
          await run("git", [
            "config",
            "--file",
            join(home, ".gitconfig"),
            "user.name",
            owner,
          ]);
          await run("git", [
            "config",
            "--file",
            join(home, ".gitconfig"),
            "user.email",
            "owner@example.invalid",
          ]);
        },
      };
    }
    const branch = "feature";
    const created = await api(
      `/repos/${owner}/${repository}/contents/feature.txt`,
      {
        content: Buffer.from("feature\n").toString("base64"),
        message: "Add feature",
        branch: "main",
        new_branch: branch,
      },
    );
    const sha = created.commit.sha;
    const checkUrl = `${origin}/${owner}/${repository}/actions/runs/1`;
    await api(`/repos/${owner}/${repository}/statuses/${sha}`, {
      state: "failure",
      context: "ci/test",
      target_url: checkUrl,
      description: "Tests failed",
    });
    const pull = await api(`/repos/${owner}/${repository}/pulls`, {
      head: branch,
      base: "main",
      title: "Add feature",
    });
    const issue = await api(`/repos/${owner}/${repository}/issues`, {
      title: "Keep the token out of the logs",
      body: "An Issue of the private repository.",
    });
    const goneIssue = await api(`/repos/${owner}/${repository}/issues`, {
      title: "An Issue the owner removes",
      body: "This Issue is removed while it is read.",
    });
    // Git reads with a header so the workspace's remote and config hold no token.
    const remoteUrl = `${origin}/${owner}/${repository}.git`;
    const basic = Buffer.from(`${owner}:${setup}`).toString("base64");
    const git = (...args) =>
      run("git", [
        "-c",
        `http.extraHeader=Authorization: Basic ${basic}`,
        ...args,
      ]);
    const clonePath = join(root, "private-repository");
    await git(
      "clone",
      "--quiet",
      "--branch",
      automationIssue ? "main" : branch,
      remoteUrl,
      clonePath,
    );
    let commits = 0;
    return {
      origin,
      issueSetup,
      owner,
      repository,
      branch,
      sha,
      checkUrl,
      pullNumber: pull.number,
      issueNumber: issue.number,
      goneIssueNumber: goneIssue.number,
      clonePath,
      readToken: await token(
        "iori-read",
        "read:repository,read:issue,read:user",
      ),
      otherReadToken: await token(
        "iori-read-replacement",
        "read:repository,read:issue,read:user",
      ),
      // Reads the account name, but no repository.
      noRepositoryToken: await token("iori-no-repository", "read:user"),
      readTokenName: "iori-read",
      // The site's own 401 for a token it never issued.
      unknownToken: randomBytes(20).toString("hex"),
      /** Push a commit to the branch on the site, as another clone would. */
      async commit() {
        commits += 1;
        const file = await api(
          `/repos/${owner}/${repository}/contents/change-${commits}.txt`,
          {
            content: Buffer.from(`change ${commits}\n`).toString("base64"),
            message: `Change ${commits}`,
            branch,
          },
        );
        return file.commit.sha;
      },
      /** Remove an Issue on the site, as its owner would. */
      deleteIssue: (number) =>
        api(
          `/repos/${owner}/${repository}/issues/${number}`,
          undefined,
          "DELETE",
        ),
      /** Add a commit status, as a CI service would. */
      status: (commitSha, state, context) =>
        api(`/repos/${owner}/${repository}/statuses/${commitSha}`, {
          state,
          context,
          target_url: checkUrl,
        }),
      /** Revoke a token on the site, as its owner would. */
      revoke: (tokenName) =>
        api(`/users/${owner}/tokens/${tokenName}`, undefined, "DELETE"),
      /** Update the clone's remote-tracking branch from the site. */
      fetch: () => git("-C", clonePath, "fetch", "--quiet", "origin"),
      /** Fetch the branch into another ref, leaving the push target alone. */
      fetchInto: (ref) =>
        git("-C", clonePath, "fetch", "--quiet", remoteUrl, `${branch}:${ref}`),
      /** The status the site last answered a GET of this path with (its router log). */
      async requested(path) {
        const { stdout, stderr } = await run("docker", ["logs", name], {
          maxBuffer: 64 * 1024 * 1024,
        });
        const answers = [
          ...`${stdout}\n${stderr}`.matchAll(
            /completed GET (\S+) for [^,]+, (\d{3}) /gu,
          ),
        ].filter((match) => match[1] === path);
        return answers.length ? Number(answers.at(-1)[2]) : undefined;
      },
      async requestCount(path) {
        const { stdout, stderr } = await run("docker", ["logs", name], {
          maxBuffer: 64 * 1024 * 1024,
        });
        return [
          ...`${stdout}\n${stderr}`.matchAll(
            /completed GET (\S+) for [^,]+, (\d{3}) /gu,
          ),
        ].filter((match) => match[1].startsWith(path) && match[2] === "200")
          .length;
      },
      stop: () => docker("stop", name).then(() => undefined),
      async start() {
        await docker("start", name);
        await ready();
      },
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
