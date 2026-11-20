import { execFileSync } from "node:child_process";
import {
  existsSync,
  globSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

const target = resolve(process.env.CARGO_TARGET_DIR);
const marker = join(target, ".iori-needs-clean");
if (existsSync(marker)) {
  for (const manifest of ["Cargo.toml", "apps/client/src-tauri/Cargo.toml"]) {
    const metadata = JSON.parse(
      execFileSync(
        "cargo",
        [
          "metadata",
          "--format-version",
          "1",
          "--locked",
          "--manifest-path",
          manifest,
        ],
        { maxBuffer: Infinity },
      ),
    );
    const packages = metadata.packages.filter((pkg) => pkg.source === null);
    const selection = packages.flatMap((pkg) => ["-p", pkg.name]);
    if (selection.length === 0)
      throw new Error(`No local Cargo packages found in ${manifest}`);
    for (const profile of [[], ["--release"]]) {
      execFileSync(
        "cargo",
        ["clean", "--manifest-path", manifest, ...profile, ...selection],
        { stdio: "inherit" },
      );
    }
  }
}

// Older seeds may still reference another target after their marker was cleared.
const targetPrefix = RegExp.escape(`${dirname(target)}${sep}`);
const currentKey = RegExp.escape(basename(target));
const foreignTarget = new RegExp(
  `${targetPrefix}(?!${currentKey}\\b)[a-f0-9]{64}\\b`,
);
for (const profile of ["debug", "release"]) {
  const directory = join(target, profile);
  for (const file of globSync("build/*/output", { cwd: directory })) {
    if (!foreignTarget.test(readFileSync(join(directory, file), "utf8")))
      continue;

    // Cargo rebases its directives, but generated files can embed the old path.
    // Invalidate this run so Cargo reuses the script binary and regenerates its output.
    const run = dirname(file);
    rmSync(join(directory, ".fingerprint", basename(run)), {
      recursive: true,
      force: true,
    });
    // Keep the stale output record until its generated files are gone.
    rmSync(join(directory, run, "out"), { recursive: true, force: true });
    rmSync(join(directory, run), { recursive: true, force: true });
  }
  for (const file of globSync("build/*/root-output", { cwd: directory })) {
    const path = join(directory, file);
    // Cargo uses root-output to rebase directives. The remaining directives
    // contain no old target paths, so the cached build can use its new OUT_DIR.
    if (foreignTarget.test(readFileSync(path, "utf8"))) {
      writeFileSync(path, join(dirname(path), "out"));
    }
  }
}

if (existsSync(marker)) unlinkSync(marker);
