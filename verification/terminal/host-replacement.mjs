import {
  cp,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { buildHost } from "../../scripts/release/host.mjs";

/** Two owned distributions differ only in a Host title decision, never in daemon code. */
export async function prepareHostReplacement(root) {
  const distribution = join(root, "host-distribution"),
    replacement = join(root, "host-replacement");
  await buildHost(distribution);
  await cp(distribution, replacement, { recursive: true });
  const title = join(replacement, "src", "cli", "title.js"),
    source = await readFile(title, "utf8");
  const changed = source.replace(
    "const clean =",
    'if(title === "IORI_HOST_TITLE_PROBE") return "UPDATED_HOST_TITLE";\n    const clean =',
  );
  if (changed === source)
    throw new Error("Host title fixture no longer matches its source");
  await writeFile(title, changed);
  async function bytes(file) {
    const info = await stat(file);
    if (!info.isDirectory()) return info.size;
    let total = 0;
    for (const entry of await readdir(file))
      total += await bytes(join(file, entry));
    return total;
  }
  const manifest = JSON.parse(
    await readFile(join(distribution, "terminal-daemon-files.json"), "utf8"),
  );
  const copied = [
    "runtime",
    "package.json",
    ...manifest.sources,
    ...manifest.packages.map((name) => "node_modules/" + name),
  ];
  let daemonBytes = 0;
  for (const file of copied)
    daemonBytes += await bytes(join(distribution, file));
  const footprint = {
    daemonBytes,
    distributionBytes: await bytes(distribution),
    sourceFiles: manifest.sources.length,
    packages: manifest.packages,
  };
  let replaced = false;
  return {
    footprint,
    distribution,
    async replace() {
      if (replaced) return;
      const previous = join(root, "host-previous");
      await rename(distribution, previous);
      await rename(replacement, distribution);
      await rm(previous, { recursive: true });
      replaced = true;
    },
  };
}
