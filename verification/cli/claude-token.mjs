import { readFile } from "node:fs/promises";

// Claude Code replaces its credential file (write to a temporary file, then
// rename), so a shared link cannot receive a refresh: the CLI would keep a new
// refresh token in the test home and the Owner's own file would keep a token
// that no longer works. Verification therefore runs Claude Code on a
// verification-only long-lived token that never writes into a CLI home.
export const claudeTokenPath = "/root/.config/claude-token";
export const claudeTokenName = "CLAUDE_CODE_OAUTH_TOKEN";

function missing(path, reason) {
  return new Error(
    `Claude Codeの試験用トークンがありません。\`claude setup-token\` で作ったトークンを ${path} へ \`${claudeTokenName}=<トークン>\` の1行（0600）で置いてください（${reason}）。`,
  );
}

/** Read only the verification token. The value must never be logged, stored in
 * evidence, put in a command line, or shown; callers pass it as an environment
 * variable to the CLI child alone. */
export async function readClaudeToken(path = claudeTokenPath) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw missing(path, `読めません: ${error.code ?? "unknown"}`);
  }
  const pattern = new RegExp(
    `^\\s*(?:export\\s+)?${claudeTokenName}=(\\S+)\\s*$`,
    "u",
  );
  for (const line of text.split(/\r?\n/u)) {
    const value = pattern.exec(line)?.[1];
    if (value) return value;
  }
  throw missing(path, `${claudeTokenName}= の1行がありません`);
}

/** Hand the token to the verification Host process, which passes its
 * environment to the CLI children it starts. */
export function setClaudeToken(value, env = process.env) {
  env[claudeTokenName] = value;
}
