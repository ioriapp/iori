import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [name, version] = process.argv.slice(2);
if (!name || !version)
  throw new Error(
    "Usage: node scripts/licenses/update-npm.mjs <package-name> <version>",
  );
const metadataUrl = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
const metadataResponse = await fetch(metadataUrl);
if (!metadataResponse.ok)
  throw new Error(`${metadataUrl}: ${metadataResponse.status}`);
const metadata = await metadataResponse.json();
const commit = metadata.gitHead ?? metadata.commit;
const repository = (
  typeof metadata.repository === "string"
    ? metadata.repository
    : metadata.repository?.url
)
  ?.replace(/^git\+/, "")
  .replace(/\.git(?:#.*)?$/, "");
if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repository ?? ""))
  throw new Error(`${name}@${version}: GitHub repository required`);
const directory = path.join(
  "scripts/licenses/sources/npm",
  encodeURIComponent(name),
  version,
);
async function tryCommit(revision) {
  if (!revision) return false;
  for (const filename of [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "license",
    "license.md",
    "license.txt",
    "COPYING",
  ]) {
    const url = `${repository.replace("https://github.com/", "https://raw.githubusercontent.com/")}/${revision}/${filename}`;
    const response = await fetch(url);
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "LICENSE"), await response.text());
    await writeFile(
      path.join(directory, "SOURCE.txt"),
      `${metadataUrl}\n${url}\n`,
    );
    console.log(`${name}@${version}: ${url}`);
    return true;
  }
  return false;
}
if (!(await tryCommit(commit))) {
  const api = repository.replace(
    "https://github.com/",
    "https://api.github.com/repos/",
  );
  const response = await fetch(`${api}/commits/HEAD`);
  if (!response.ok) throw new Error(`${api}/commits/HEAD: ${response.status}`);
  const latest = (await response.json()).sha;
  if (!(await tryCommit(latest)))
    throw new Error(
      `${name}@${version}: no license in repository root at ${commit} or ${latest}`,
    );
}
