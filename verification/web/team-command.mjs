import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { join, relative, isAbsolute, sep, delimiter } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Only inspect descendants of this run's daemon. The session ID comes from
// current Host records, identifying the real Claude Code of that Terminal.
async function claudeEnvironment(root, claudeHome, session) {
  const { pid } = JSON.parse(
    await readFile(join(root, "terminal-daemon", "connection.json"), "utf8"),
  );
  assert.equal(
    await realpath(`/proc/${pid}/cwd`),
    root,
    "このrunのTerminal係だけを調べる",
  );
  const pending = [pid];
  while (pending.length) {
    const current = pending.shift();
    try {
      const children = (
        await readFile(`/proc/${current}/task/${current}/children`, "utf8")
      ).trim();
      if (children) pending.push(...children.split(/\s+/u).map(Number));
      // Claude may replace its OS argv with its process title. Its own live
      // session registration maps the Host-observed session ID to the real PID.
      const registered = JSON.parse(
        await readFile(join(claudeHome, "sessions", `${current}.json`), "utf8"),
      );
      if (registered.sessionId !== session) continue;
      // Opaque transfer: never log, persist or individually inspect credentials.
      return Object.fromEntries(
        (await readFile(`/proc/${current}/environ`, "utf8"))
          .split("\0")
          .filter(Boolean)
          .map((entry) => {
            const split = entry.indexOf("=");
            return [entry.slice(0, split), entry.slice(split + 1)];
          }),
      );
    } catch (error) {
      if (!["ENOENT", "ESRCH"].includes(error.code))
        throw new Error("検証用のCLIの環境を取得できません");
    }
  }
  throw new Error("専用Hostの記録に一致するClaude Codeが見つかりません");
}

function savedSession(db, terminalId) {
  return JSON.parse(
    db
      .prepare("SELECT value FROM terminal_clis WHERE terminal_id = ?")
      .get(terminalId).value,
  ).session?.id;
}

async function parentEnvironment(root, claudeHome, terminalId) {
  const db = new DatabaseSync(join(root, "host.sqlite"), { readOnly: true });
  let parent;
  let session;
  try {
    parent = db
      .prepare("SELECT value_json FROM team_conversations")
      .all()
      .map((row) => JSON.parse(row.value_json))
      .find((entry) => entry.terminalId === terminalId);
    session = savedSession(db, terminalId);
  } finally {
    db.close();
  }
  assert.ok(parent, "専用Hostに親の会話がある");
  assert.ok(session, "親CLIの開始hookが会話IDを保存している");
  const path = relative(root, parent.instructionFile);
  assert.ok(
    !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`),
    "親の指示ファイルは専用Host内",
  );
  return {
    env: await claudeEnvironment(root, claudeHome, session),
    cwd: parent.cwd,
  };
}

// The executable that the CLI's PATH finds first: what its tools run as `iori`.
function run(env, cwd, args) {
  return new Promise((resolve, reject) => {
    execFile(
      join(env.PATH.split(delimiter)[0], "iori"),
      args,
      { env, cwd, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        if (error && error.code !== 1) {
          reject(new Error("検証用の実物のioriを実行できません"));
          return;
        }
        resolve({ code: error ? error.code : 0, stdout });
      },
    );
  });
}

/** Execute the actual Rust CLI through the live parent's authenticated route.
 * Resolve every time so /exit, resume and daemon restart use the current route. */
export function teamCommand(root, claudeHome) {
  return async (terminalId, args, { allowFailure = false } = {}) => {
    const { env, cwd } = await parentEnvironment(root, claudeHome, terminalId);
    const { stdout } = await run(env, cwd, [...args, "--json"]);
    let result;
    try {
      result = JSON.parse(stdout);
    } catch {
      throw new Error("実物のioriがJSONの結果を返しませんでした");
    }
    if (!allowFailure) assert.equal(result.ok, true, result.text);
    return result;
  };
}

/**
 * Execute the actual Rust CLI as a Claude Code outside a team runs it: with
 * that process's environment, in the folder the Terminal started in. Returns
 * the exit code, the answer, and whether the CLI's environment holds `secret`.
 */
export function cliCommand(root, claudeHome) {
  return async (terminalId, args, secret) => {
    const db = new DatabaseSync(join(root, "host.sqlite"), { readOnly: true });
    let session;
    let cwd;
    try {
      session = savedSession(db, terminalId);
      cwd = db
        .prepare("SELECT path FROM terminal_worktrees WHERE terminal_id = ?")
        .get(terminalId)?.path;
    } finally {
      db.close();
    }
    assert.ok(session, "CLIの開始hookが会話IDを保存している");
    const env = await claudeEnvironment(root, claudeHome, session);
    const result = await run(env, cwd, args);
    return {
      ...result,
      secretInEnvironment:
        secret !== undefined &&
        Object.entries(env).some(
          ([name, value]) => name.includes(secret) || value.includes(secret),
        ),
    };
  };
}
