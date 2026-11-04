import { userInfo } from "node:os";
import { join } from "node:path";

// Construct verification Host/CLI environments from runtime needs. Session
// markers, messaging credentials and sandbox flags from the working agent
// must never reach the isolated CLIs.
const runtimeVariables = new Set([
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "HOME",
  "SHELL",
  "USER",
  "LOGNAME",
  "LANG",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "VOLTA_HOME",
  "INPUTRC",
  "IORI_HOST_PORT",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  // Set by the verification token helper from /root/.config/claude-token, not
  // taken from the calling agent's own session.
  "CLAUDE_CODE_OAUTH_TOKEN",
  "PI_CODING_AGENT_DIR",
  "PI_CODING_AGENT_SESSION_DIR",
]);

export function verificationHostEnvironment(source = process.env) {
  const environment = Object.fromEntries(
    Object.entries(source).filter(
      ([name]) =>
        runtimeVariables.has(name) ||
        name.startsWith("XDG_") ||
        name.startsWith("LC_") ||
        name.startsWith("MISE_"),
    ),
  );
  // mise shims on PATH read the machine's global config. Its trust is kept
  // under the real HOME, so an isolated HOME would make every shim fail.
  if (environment.MISE_TRUSTED_CONFIG_PATHS === undefined)
    environment.MISE_TRUSTED_CONFIG_PATHS = join(
      userInfo().homedir,
      ".config/mise",
    );
  return environment;
}
