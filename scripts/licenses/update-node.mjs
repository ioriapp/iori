import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const version = (await readFile(".node-version", "utf8")).trim();
const url = `https://raw.githubusercontent.com/nodejs/node/v${version}/LICENSE`;
const response = await fetch(url);
if (!response.ok)
  throw new Error(`Node.js ${version}: ${url} (${response.status})`);
const directory = path.join("scripts/licenses/sources/node", version);
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, "LICENSE"), await response.text());
await writeFile(path.join(directory, "SOURCE.txt"), `${url}\n`);
console.log(`Node.js ${version}: ${directory}`);
