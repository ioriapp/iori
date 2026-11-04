import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const safe = (value) =>
  value.replace(
    /[^A-Za-z0-9]/g,
    (character) => `_${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );

export async function collectLinuxSources(entries, output) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "iori-appimage-sources-"),
  );
  try {
    const packages = new Map(
      entries.map(({ source, sourceVersion }) => [
        `${source}=${sourceVersion}`,
        { source, sourceVersion },
      ]),
    );
    for (const { source, sourceVersion } of packages.values()) {
      const directory = await mkdtemp(path.join(temporary, "package-"));
      console.log(`Ubuntu source: ${source}=${sourceVersion}`);
      try {
        await exec(
          "apt-get",
          ["source", "--download-only", `${source}=${sourceVersion}`],
          { cwd: directory, maxBuffer: 16 * 1024 * 1024 },
        );
      } catch (error) {
        throw new Error(
          `Ubuntu source unavailable: ${source}=${sourceVersion}\n${error.stderr ?? error.message}`,
          { cause: error },
        );
      }
      await exec("tar", [
        "-cf",
        path.join(output, `ubuntu-${safe(source)}-${safe(sourceVersion)}.tar`),
        "-C",
        directory,
        ".",
      ]);
      await rm(directory, { recursive: true, force: true });
    }
    const runtime = [
      [
        "type2-runtime-dd6cebedcbddde9c82f89b011e8e1d40b6e43868.tar.gz",
        "https://github.com/AppImage/type2-runtime/archive/dd6cebedcbddde9c82f89b011e8e1d40b6e43868.tar.gz",
        "f5fec23be76e50e2445ed2d018bac49b367490fc483c62c4637e99ec705d27ba",
      ],
      [
        "libfuse-3.15.0.tar.xz",
        "https://github.com/libfuse/libfuse/releases/download/fuse-3.15.0/fuse-3.15.0.tar.xz",
        "70589cfd5e1cff7ccd6ac91c86c01be340b227285c5e200baa284e401eea2ca0",
      ],
      [
        "squashfuse-0.5.2.tar.gz",
        "https://github.com/vasi/squashfuse/archive/0.5.2.tar.gz",
        "db0238c5981dabbd80ee09ae15387f390091668ca060a7bc38047912491443d3",
      ],
    ];
    for (const [name, url, expected] of runtime) {
      const file = path.join(output, name);
      await exec("curl", ["-fLsS", url, "-o", file]);
      if (expected) {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        if (hash.digest("hex") !== expected)
          throw new Error(`Source checksum mismatch: ${name}`);
      }
    }
    console.log(`AppImage sources: ${(await readdir(output)).length} archives`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
