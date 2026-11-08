import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const safe = (value) =>
  value.replace(
    /[^A-Za-z0-9]/g,
    (character) => `_${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );

export function sourcesToDownload(required, available) {
  const existing = new Set(available);
  return required
    .filter(({ name, versioned }) => !versioned || !existing.has(name))
    .map(({ name }) => name);
}

async function existingSources() {
  const directories = [];
  if (process.env.IORI_APPIMAGE_SOURCE_CACHE)
    directories.push(process.env.IORI_APPIMAGE_SOURCE_CACHE);
  const previous = process.env.IORI_APPIMAGE_PREVIOUS_RELEASES;
  if (previous)
    for (const entry of await readdir(previous, { withFileTypes: true }))
      if (entry.isDirectory())
        directories.push(path.join(previous, entry.name, "appimage-sources"));
  const found = new Map();
  for (const directory of directories) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries)
      if (entry.isFile() && !found.has(entry.name))
        found.set(entry.name, path.join(directory, entry.name));
  }
  return found;
}

export async function collectLinuxSources(entries, output) {
  const existing = await existingSources();
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
      const name = `ubuntu-${safe(source)}-${safe(sourceVersion)}.tar`;
      const versioned = Boolean(sourceVersion);
      if (
        !sourcesToDownload([{ name, versioned }], [...existing.keys()]).length
      ) {
        await cp(existing.get(name), path.join(output, name));
        continue;
      }
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
      await exec("tar", ["-cf", path.join(output, name), "-C", directory, "."]);
      if (versioned && process.env.IORI_APPIMAGE_SOURCE_CACHE) {
        const cache = process.env.IORI_APPIMAGE_SOURCE_CACHE;
        const pending = path.join(cache, `${name}.${process.pid}.tmp`);
        await cp(path.join(output, name), pending);
        await rename(pending, path.join(cache, name));
      }
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
      if (
        sourcesToDownload([{ name, versioned: true }], [...existing.keys()])
          .length
      )
        await exec("curl", ["-fLsS", url, "-o", file]);
      else await cp(existing.get(name), file);
      if (expected) {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        if (hash.digest("hex") !== expected)
          throw new Error(`Source checksum mismatch: ${name}`);
      }
      if (process.env.IORI_APPIMAGE_SOURCE_CACHE && !existing.has(name)) {
        const cache = process.env.IORI_APPIMAGE_SOURCE_CACHE;
        const pending = path.join(cache, `${name}.${process.pid}.tmp`);
        await cp(file, pending);
        await rename(pending, path.join(cache, name));
      }
    }
    console.log(`AppImage sources: ${(await readdir(output)).length} archives`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
