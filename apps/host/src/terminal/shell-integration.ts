import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../fs/atomic-write.ts";
import type { ShellDefinition } from "./platform.ts";

// Follow VS Code's startup-file routing, without its prompt/command hooks:
// https://github.com/microsoft/vscode/tree/main/src/vs/workbench/contrib/terminal/common/scripts
const prependPath = `if [ -n "\${IORI_COMMAND_BIN:-}" ]; then
  export PATH="$IORI_COMMAND_BIN:$PATH"
fi
`;
const bashLogin = `if [ -r /etc/profile ]; then . /etc/profile; fi
for __iori_profile in ~/.bash_profile ~/.bash_login ~/.profile; do
  if [ -r "$__iori_profile" ]; then
    . "$__iori_profile"
    break
  fi
done
unset __iori_profile
${prependPath}`;

// Do not choose a history file for the user. Only undo a path derived from
// the temporary ZDOTDIR, before their defaults are evaluated or on return.
const zshHistory = `if [[ $HISTFILE == $__iori_zdotdir/* ]]; then
  HISTFILE=$IORI_SHELL_USER_ZDOTDIR/\${HISTFILE#$__iori_zdotdir/}
fi
`;

// Restore the user's directory while sourcing their file, including changes
// that file makes to ZDOTDIR. Keep the private directory only until startup ends.
const zshSource = (file: string) => `__iori_zdotdir=$ZDOTDIR
${zshHistory}ZDOTDIR=$IORI_SHELL_USER_ZDOTDIR
if [[ -r $ZDOTDIR/${file} ]]; then . "$ZDOTDIR/${file}"; fi
IORI_SHELL_USER_ZDOTDIR=\${ZDOTDIR:-$HOME}
${zshHistory}ZDOTDIR=$__iori_zdotdir
unset __iori_zdotdir
`;
const zshFinish = `__iori_zdotdir=$ZDOTDIR
${zshHistory}ZDOTDIR=$IORI_SHELL_USER_ZDOTDIR
unset IORI_SHELL_USER_ZDOTDIR __iori_zdotdir
${prependPath}`;
const files: Record<string, string> = {
  "bash-login.sh": bashLogin,
  ".zshenv": `${zshSource(".zshenv")}if [[ ! -o rcs ]]; then
${zshFinish}fi
`,
  ".zprofile": `${zshSource(".zprofile")}if [[ ! -o rcs ]]; then
${zshFinish}fi
`,
  ".zshrc": `${zshSource(".zshrc")}if [[ ! -o login || ! -o rcs ]]; then
${zshFinish}fi
`,
  ".zlogin": `${zshSource(".zlogin")}${zshFinish}`,
};

/** Host-owned assets outlive Host restarts. Content-addressed directories keep
 * a shell that is still starting on the same scripts across an update. */
export class ShellIntegration {
  readonly #directory: string;
  #ready?: Promise<void>;

  constructor(storageRoot: string) {
    const version = createHash("sha256")
      .update(JSON.stringify(files))
      .digest("hex");
    this.#directory = join(storageRoot, "shell-integration", version);
  }

  async prepare(
    shell: ShellDefinition,
    environment: NodeJS.ProcessEnv,
  ): Promise<{ args: string[]; env: Record<string, string> } | undefined> {
    // Git Bash and the Windows shells retain their existing launch paths.
    if (process.platform === "win32") return undefined;
    if (shell.id === "fish")
      return {
        args: [
          ...shell.args,
          "--init-command",
          'if test -n "$IORI_COMMAND_BIN"; set -gx PATH "$IORI_COMMAND_BIN" $PATH; end',
        ],
        env: {},
      };
    if (shell.id !== "bash" && shell.id !== "zsh") return undefined;
    this.#ready ??= this.#writeFiles().catch((error: unknown) => {
      this.#ready = undefined;
      throw error;
    });
    await this.#ready;
    if (shell.id === "zsh")
      return {
        args: shell.args,
        env: {
          ZDOTDIR: this.#directory,
          IORI_SHELL_USER_ZDOTDIR:
            environment.ZDOTDIR ?? environment.HOME ?? homedir(),
        },
      };
    // --init-file is not read by a login Bash. As in VS Code, the script
    // sources the login profiles instead; Bash itself is then non-login.
    return {
      args: [
        "--init-file",
        join(this.#directory, "bash-login.sh"),
        ...shell.args.filter((arg) => !["-l", "--login"].includes(arg)),
      ],
      env: {},
    };
  }

  async #writeFiles(): Promise<void> {
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await Promise.all(
      Object.entries(files).map(([name, contents]) =>
        writeFileAtomic(join(this.#directory, name), contents),
      ),
    );
  }
}
