import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sources = path.join(import.meta.dirname, "sources/npm");

async function filesAt(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

export async function npmNotice(
  packages,
  { strict = true, warn = () => {}, keyringParent } = {},
) {
  const entries = [];
  for (const directory of [...packages].sort()) {
    const metadata = JSON.parse(
      await readFile(path.join(directory, "package.json"), "utf8"),
    );
    if (!metadata.name || metadata.name.startsWith("@iori/")) continue;
    let source = directory;
    let attribution = "";
    let filenames = await filesAt(source);
    if (!filenames.length && metadata.name.startsWith("@napi-rs/keyring-")) {
      const parent =
        keyringParent ?? path.join(path.dirname(directory), "keyring");
      const parentMetadata = JSON.parse(
        await readFile(path.join(parent, "package.json"), "utf8"),
      );
      if (
        parentMetadata.name === "@napi-rs/keyring" &&
        parentMetadata.version === metadata.version
      ) {
        source = parent;
        filenames = await filesAt(source);
        attribution = `License text from ${parentMetadata.name}@${parentMetadata.version}.\n`;
      }
    }
    if (!filenames.length) {
      source = path.join(
        sources,
        encodeURIComponent(metadata.name),
        metadata.version,
      );
      try {
        filenames = await filesAt(source);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (!filenames.length && !strict) {
        warn();
        continue;
      }
      if (!filenames.length)
        throw new Error(
          `${metadata.name}@${metadata.version}: license text missing; run node scripts/licenses/update-npm.mjs ${metadata.name} ${metadata.version}`,
        );
      attribution =
        "License text from the fixed upstream source in scripts/licenses/sources/npm.\n";
    }
    const texts = [];
    for (const filename of filenames)
      texts.push(
        `--- ${filename} ---\n${await readFile(path.join(source, filename), "utf8")}`,
      );
    const author =
      typeof metadata.author === "string"
        ? metadata.author
        : metadata.author?.name;
    entries.push({
      name: metadata.name,
      version: metadata.version,
      text: `${author ? `Declared author: ${author.replace(/\s*<[^>]+>/g, "")}\n` : ""}${attribution}${texts.join("\n\n")}`,
    });
  }
  entries.sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  return {
    count: entries.length,
    text:
      entries
        .map(
          (entry) =>
            `===== ${entry.name}@${entry.version} =====\n${entry.text}`,
        )
        .join("\n\n") + "\n",
  };
}

export async function installedPackages(nodeModules) {
  const result = [];
  for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(nodeModules, entry.name);
    if (entry.name.startsWith("@")) {
      for (const child of await readdir(directory, { withFileTypes: true }))
        if (child.isDirectory()) result.push(path.join(directory, child.name));
    } else result.push(directory);
  }
  return result;
}
