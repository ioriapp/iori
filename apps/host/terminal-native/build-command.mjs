import { execFileSync } from "node:child_process";
import { copyFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

{
  const suffix = process.platform === "win32" ? ".exe" : "";
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const manifest = path.resolve(directory, "../../../Cargo.toml");
  const release = process.argv.includes("--release");
  execFileSync(
    "cargo",
    [
      "build",
      "--manifest-path",
      manifest,
      "--package",
      "iori-terminal-native",
      "--bin",
      "iori-team-command",
      "--locked",
      ...(release ? ["--release"] : []),
    ],
    { stdio: "inherit" },
  );
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--manifest-path",
        manifest,
        "--no-deps",
        "--format-version=1",
      ],
      { encoding: "utf8" },
    ),
  );
  await copyFile(
    path.join(
      metadata.target_directory,
      release ? "release" : "debug",
      `iori-team-command${suffix}`,
    ),
    path.join(directory, `iori${suffix}`),
  );
  if (process.platform !== "win32")
    await chmod(path.join(directory, "iori"), 0o700);
}
