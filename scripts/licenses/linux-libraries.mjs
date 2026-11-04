import { execFile } from "node:child_process";
import { open, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { collectLinuxSources } from "./linux-sources.mjs";

const exec = promisify(execFile);

async function libraries(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await libraries(file)));
    else if (entry.isFile() && /\.so(?:\.|$)/.test(entry.name)) {
      const handle = await open(file, "r");
      try {
        const header = Buffer.alloc(18);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        if (
          bytesRead === 18 &&
          header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) &&
          header[16] === 3 &&
          header[17] === 0
        )
          result.push(file);
      } finally {
        await handle.close();
      }
    }
  }
  return result.sort();
}

export async function linuxLibrariesNotice(
  appDir,
  destination,
  { strict = true } = {},
) {
  const files = await libraries(appDir);
  const packages = new Map();
  const missing = [];
  for (const file of files) {
    let owners;
    try {
      const { stdout } = await exec("dpkg-query", [
        "-S",
        `*/${path.basename(file)}`,
      ]);
      owners = stdout
        .trim()
        .split("\n")
        .flatMap((line) => {
          const separator = line.indexOf(": /");
          return separator < 0 ? [] : line.slice(0, separator).split(", ");
        });
    } catch {
      owners = [];
    }
    if (!owners.length)
      missing.push(`No Ubuntu package for ${path.relative(appDir, file)}`);
    for (const owner of owners) {
      if (!packages.has(owner)) packages.set(owner, []);
      packages.get(owner).push(path.relative(appDir, file));
    }
  }
  const entries = [];
  for (const [name, ownedFiles] of [...packages].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const { stdout } = await exec("dpkg-query", [
      "-W",
      "-f=${Version}\t${source:Package}\t${source:Version}",
      name,
    ]);
    const [version, source, sourceVersion] = stdout.split("\t");
    let copyright;
    try {
      copyright = await readFile(
        `/usr/share/doc/${name.split(":")[0]}/copyright`,
        "utf8",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(`Missing copyright for ${name}`);
      continue;
    }
    entries.push({
      name,
      version,
      source,
      sourceVersion,
      files: ownedFiles,
      copyright,
    });
  }
  if (missing.length) {
    const message = `Linux library notices incomplete:\n${missing.join("\n")}`;
    if (strict) throw new Error(message);
    console.warn(message);
  }
  const commonLicenses = new Set();
  for (const entry of entries) {
    for (const match of entry.copyright.matchAll(
      /\/usr\/share\/common-licenses\/([A-Za-z0-9.+_-]+)/g,
    ))
      commonLicenses.add(
        match[1].replace(/\.$/, "").replace(/^(GPL-[23])\.0$/, "$1"),
      );
  }
  const commonTexts = [];
  for (const name of [...commonLicenses].sort()) {
    try {
      commonTexts.push(
        `===== /usr/share/common-licenses/${name} =====\n${await readFile(`/usr/share/common-licenses/${name}`, "utf8")}`,
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const message = `Missing common license ${name}`;
      if (strict) throw new Error(message);
      console.warn(message);
    }
  }
  const header = [
    "The following shared libraries are bundled from Ubuntu 22.04 packages.",
    `Their corresponding source code is available from ${(
      await readFile(
        new URL("../../release-source.txt", import.meta.url),
        "utf8",
      )
    ).trim()} (AppImage sources releases).`,
    "Ubuntu source archives are named ubuntu-<package>-<version>.tar; punctuation in names and versions is encoded as an underscore followed by its hexadecimal character code.",
    "",
    ...entries.map(
      (entry) =>
        `${entry.name} ${entry.version} — source: ${entry.source} ${entry.sourceVersion}`,
    ),
  ].join("\n");
  const text = entries
    .map(
      (entry) =>
        `===== ${entry.name} ${entry.version} =====\nSource: ${entry.source} ${entry.sourceVersion}\nFiles:\n${entry.files.join("\n")}\n\n${entry.copyright}`,
    )
    .join("\n\n");
  const runtimeDirectory = path.join(
    import.meta.dirname,
    "sources/linux-runtime",
  );
  const runtimeTexts = [];
  for (const name of [
    "type2-runtime",
    "musl",
    "libfuse",
    "squashfuse",
    "zstd",
    "zlib",
    "mimalloc",
  ]) {
    try {
      runtimeTexts.push(
        `===== ${name} =====\n${await readFile(path.join(runtimeDirectory, `${name}.txt`), "utf8")}`,
      );
    } catch (error) {
      if (error.code !== "ENOENT" || strict) throw error;
      console.warn(`Missing runtime license: ${name}`);
    }
  }
  if (strict && process.env.IORI_APPIMAGE_SOURCE_DIR)
    await collectLinuxSources(entries, process.env.IORI_APPIMAGE_SOURCE_DIR);
  const runtime = [
    "AppImage type2-runtime 20251108, commit dd6cebedcbddde9c82f89b011e8e1d40b6e43868",
    "Source and build instructions: https://github.com/AppImage/type2-runtime/tree/20251108",
    "This runtime statically links musl, libfuse, squashfuse, zstd, zlib and mimalloc.",
    "The musl 1.2.5, zstd 1.5.6, zlib 1.3.1 and mimalloc 2.1.7 license texts below are from Alpine 3.21-era versions; the exact versions linked into the runtime could not be determined from its build records.",
    ...runtimeTexts,
  ].join("\n\n");
  await writeFile(
    destination,
    `${header}\n\n${text}\n\n${commonTexts.join("\n\n")}\n\n${runtime}\n`,
  );
  console.log(
    `Linux library licenses: libraries=${files.length}, packages=${entries.length}`,
  );
}

if (process.argv[1] === import.meta.filename) {
  const appDir = process.argv[2];
  await linuxLibrariesNotice(
    appDir,
    path.join(appDir, "THIRD-PARTY-LINUX-LIBRARIES.txt"),
    {
      strict: process.env.IORI_RELEASE_BUILD === "1",
    },
  );
}
