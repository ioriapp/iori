import path from "node:path";
import { ps, windowsBuildNode } from "../native/remote.mjs";

export const windowsClaudeDirectory = (root) =>
  path.win32.join(
    root,
    "cli-tools",
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "bin",
  );

/** Current Claude packages place claude.exe in postinstall. Permit that one
 * package in this disposable npm project; never change the user's npm policy. */
export function windowsClaudeInstall(root) {
  const prefix = root + "\\cli-tools";
  const manifest = JSON.stringify({
    private: true,
    allowScripts: { "@anthropic-ai/claude-code": true },
  });
  const npm = path.win32.join(
    path.win32.dirname(windowsBuildNode),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  return `[IO.Directory]::CreateDirectory(${ps(prefix)}) | Out-Null;[IO.File]::WriteAllText(${ps(prefix + "\\package.json")},${ps(manifest)});& ${ps(windowsBuildNode)} ${ps(npm)} install --prefix ${ps(prefix)} --no-save --package-lock=false @anthropic-ai/claude-code@latest;if($LASTEXITCODE -ne 0){throw 'Claude Code installation failed'};$env:PATH=${ps(windowsClaudeDirectory(root) + ";")}+$env:PATH;& ${ps(windowsClaudeDirectory(root) + "\\claude.exe")} --version;if($LASTEXITCODE -ne 0){throw 'Claude Code executable is unavailable'};`;
}
