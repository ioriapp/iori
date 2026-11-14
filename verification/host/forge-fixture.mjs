import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

// An external HTTP Forge and real local Git refs; no Host function is replaced.
export async function forgeFixture(t, dataRoot, { web = false } = {}) {
  const requests = [];
  const token = randomBytes(24).toString("hex");
  const replacementToken = randomBytes(24).toString("hex");
  const state = {
    private: false,
    rejected: false,
    scope: false,
    unreachable: false,
    notForge: false,
    malformed: false,
    gone: false,
    marks: [],
    issueCount: undefined,
    pull: false,
    noStatuses: false,
    ci: {},
  };
  const repository = join(dataRoot, "repository");
  const git = (...args) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...(web
        ? {
            env: {
              ...process.env,
              GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
              GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
            },
          }
        : {}),
    }).trim();
  await symlink(
    execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
    join(dataRoot, "bin", "git"),
  );
  await mkdir(repository);
  git("init", "-b", "main");
  git("config", "user.name", "Forge E2E");
  git("config", "user.email", "forge@localhost");
  await writeFile(join(repository, "base.txt"), "base\n");
  git("add", ".");
  git("commit", "-m", "base");
  const sha = git("rev-parse", "HEAD");
  let origin;
  const labels = [
    { id: 1, name: "agent-ready", color: "abcdef", description: "Ready" },
    { id: 2, name: "bug", color: "ff0000", description: "Bug" },
  ];
  const comments = [
    {
      id: 1,
      user: { login: "reader" },
      body: "First comment",
      created_at: "2026-01-02T00:00:00Z",
    },
    {
      id: 2,
      user: { login: "reader" },
      body: "Second comment",
      created_at: "2026-01-03T00:00:00Z",
    },
  ];
  const issue = (number) => ({
    number,
    title: `Issue ${number}`,
    state: "open",
    comments: web ? comments.length : 1,
    body: "Issue body",
    user: { login: "author" },
    labels: web
      ? labels.filter((_, index) =>
          index === 0 ? number % 2 === 0 : number % 3 === 0,
        )
      : number === 2 || state.marks.some((mark) => mark.number === number)
        ? [
            {
              id: 1,
              name: "agent-ready",
              color: "abcdef",
              description: "Ready",
            },
          ]
        : [],
    assignees: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: state.marks.some((mark) => mark.number === number)
      ? new Date(
          Math.max(
            ...state.marks
              .filter((mark) => mark.number === number)
              .map((mark) => mark.at),
          ),
        ).toISOString()
      : "2026-01-02T00:00:00Z",
    html_url: `${origin}/owner/repo/issues/${number}`,
  });
  let issues = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, origin);
    const path = url.pathname;
    const authorized = [token, replacementToken].some(
      (value) => request.headers.authorization === `token ${value}`,
    );
    requests.push({
      path,
      query: url.searchParams,
      authorized,
      hasAuthorization: Boolean(request.headers.authorization),
    });
    const json = (value, code = 200, headers = {}) =>
      response
        .writeHead(code, { "Content-Type": "application/json", ...headers })
        .end(JSON.stringify(value));
    if (state.unreachable) return request.socket.destroy();
    if (path === "/api/v1/version")
      return json(
        state.notForge ? {} : { version: "1.21.0" },
        state.notForge ? 404 : 200,
      );
    if (path === "/api/v1/user")
      return json(
        { login: "owner" },
        authorized && !state.rejected ? 200 : 401,
      );
    if (state.private && !authorized)
      return json(
        { message: "Only signed in user is allowed to call APIs." },
        403,
      );
    if (state.rejected && authorized)
      return json({ message: "Unauthorized" }, 401);
    if (state.scope)
      return json(
        { message: "token does not have required scope(s): [read:repository]" },
        403,
      );
    if (path === "/api/v1/repos/owner/repo")
      return json({ has_issues: true, default_branch: "main" });
    if (path.endsWith("/timeline")) {
      const number = Number(path.split("/").at(-2));
      return json(
        state.marks
          .filter((mark) => mark.number === number)
          .map((mark) => ({
            type: "label",
            body: "1",
            label: { name: "agent-ready" },
            user: { login: mark.login },
            created_at: new Date(mark.at).toISOString(),
          })),
      );
    }
    if (path.endsWith("/issues")) {
      if (web) {
        const selected = (url.searchParams.get("labels") ?? "")
          .split(",")
          .filter(Boolean);
        const matching = issues.filter((item) =>
          selected.every((name) =>
            item.labels.some((label) => label.name === name),
          ),
        );
        const page = Number(url.searchParams.get("page") ?? 1);
        return json(
          matching.slice((page - 1) * 50, page * 50),
          200,
          page * 50 < matching.length
            ? { link: `<${origin}${path}?page=${page + 1}>; rel="next"` }
            : {},
        );
      }
      if (state.malformed) return json([{ ...issue(1), number: "x" }]);
      const knownLabels = (url.searchParams.get("labels") ?? "")
        .split(",")
        .filter((label) => label === "agent-ready");
      if (knownLabels.length)
        return json(
          state.marks.length
            ? state.marks.map((mark) => issue(mark.number))
            : [issue(2)],
        );
      const page = Number(url.searchParams.get("page") ?? 1);
      if (state.issueCount)
        return json(
          Array.from({ length: state.issueCount }, (_, index) =>
            issue(state.issueCount - index),
          ).slice((page - 1) * 50, page * 50),
        );
      return json(
        page === 1 ? [issue(3), issue(2)] : [issue(1)],
        200,
        page === 1 ? { link: `<${origin}${path}?page=2>; rel="next"` } : {},
      );
    }
    if (path.endsWith("/comments"))
      return json(web ? comments : comments.slice(0, 1));
    if (/\/issues\/\d+$/u.test(path))
      return state.gone
        ? json({}, 404)
        : json(issue(Number(path.split("/").at(-1))));
    if (path.endsWith("/labels"))
      return json(web ? labels : labels.slice(0, 1));
    if (web && path.endsWith("/status")) {
      const commit = path.split("/").at(-2);
      const ci = state.ci[commit];
      return json({
        statuses: ci
          ? [
              {
                context: "build / build (push)",
                status: ci.status,
                target_url: `${origin}/owner/repo/actions/runs/${ci.run}/jobs/0`,
              },
            ]
          : null,
      });
    }
    if (web && path.endsWith("/actions/runs")) {
      const ci = state.ci[url.searchParams.get("head_sha")];
      return json({
        total_count: ci ? 1 : 0,
        workflow_runs: ci ? [ci.value] : [],
      });
    }
    if (web && path.endsWith("/jobs")) {
      const ci = Object.values(state.ci).find(
        (item) => item.run === Number(path.split("/").at(-2)),
      );
      return json(ci ? ci.jobs : []);
    }
    if (web && path.endsWith("/logs"))
      return response.writeHead(200).end(state.log);
    if (path.endsWith("/status"))
      return json({
        statuses: state.noStatuses
          ? null
          : [
              {
                context: "build",
                status: "failure",
                target_url: `${origin}/owner/repo/actions/runs/7/jobs/0`,
              },
            ],
      });
    if (path.endsWith("/actions/runs"))
      return json({
        total_count: 1,
        workflow_runs: [
          {
            id: 7,
            index_in_repo: 7,
            commit_sha: url.searchParams.get("head_sha"),
            workflow_id: "build.yml",
            status: "failure",
            event: "push",
            html_url: `${origin}/owner/repo/actions/runs/7`,
          },
        ],
      });
    if (path.endsWith("/jobs"))
      return json([{ id: 9, name: "build", status: "failure" }]);
    if (path.endsWith("/logs"))
      return response.writeHead(200).end("first line\n⚙️ failed\nlast line\n");
    if (path.endsWith("/pulls"))
      return json(
        state.pull
          ? [
              {
                number: 5,
                state: "open",
                html_url: `${origin}/owner/repo/pulls/5`,
                head: { ref: "main", sha, repo: { full_name: "owner/repo" } },
              },
            ]
          : [],
      );
    return json({}, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  if (web) issues = Array.from({ length: 75 }, (_, index) => issue(75 - index));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  git("remote", "add", "origin", `${origin}/owner/repo.git`);
  git("update-ref", "refs/remotes/origin/main", sha);
  git("config", "branch.main.remote", "origin");
  git("config", "branch.main.merge", "refs/heads/main");
  git("config", "push.default", "upstream");
  return {
    origin,
    repository,
    git,
    sha,
    token,
    replacementToken,
    requests,
    state,
    issue,
    issues,
    labels,
    comments,
  };
}
