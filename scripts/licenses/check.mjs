import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { cargoNotice } from "./cargo.mjs";
import { npmNotice } from "./npm.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const seen = new Set();
let keyringParent;
async function dependencies(directory) {
  directory = await realpath(directory);
  if (seen.has(directory)) return;
  seen.add(directory);
  const manifest = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  if (manifest.name === "@napi-rs/keyring") keyringParent = directory;
  const require = createRequire(path.join(directory, "package.json"));
  for (const [name, optional] of [
    ...Object.keys(manifest.dependencies ?? {}).map((name) => [name, false]),
    ...Object.keys(manifest.optionalDependencies ?? {}).map((name) => [
      name,
      true,
    ]),
  ]) {
    const location = require.resolve
      .paths(name)
      .map((base) => path.join(base, name));
    let found;
    for (const candidate of location) {
      try {
        await readFile(path.join(candidate, "package.json"));
        found = candidate;
        break;
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      }
    }
    if (!found && optional) continue;
    if (!found)
      throw new Error(
        `${name}: dependency not installed; run pnpm install --frozen-lockfile`,
      );
    await dependencies(found);
  }
}
for (const name of ["apps/host", "apps/client"])
  await dependencies(path.join(root, name));
await npmNotice(seen, { keyringParent });
for (const profile of ["host-linux", "host-windows", "client"])
  await cargoNotice(profile, {
    ref: process.argv.includes("--head") ? "HEAD" : undefined,
  });
console.log("Release npm and Cargo license inventories are current");
