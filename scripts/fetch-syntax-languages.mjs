import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const VSCODE_VERSION = "1.143.1";
export const LINGUIST_COMMIT = "73ee9a3b277f398c37ca4ab0dea0193849de6460";
export const sourcesDirectory = fileURLToPath(
  new URL("../.local/research/syntax-languages", import.meta.url),
);

async function source(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response.text();
}

async function fetchSources() {
  const tree = JSON.parse(
    await source(
      `https://api.github.com/repos/microsoft/vscode/git/trees/${VSCODE_VERSION}?recursive=1`,
    ),
  );
  const paths = tree.tree
    .map((entry) => entry.path)
    .filter((path) => /^extensions\/[^/]+\/package.json$/u.test(path));
  await mkdir(`${sourcesDirectory}/vscode`, { recursive: true });
  let index = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (index < paths.length) {
        const path = paths[index++];
        const text = await source(
          `https://raw.githubusercontent.com/microsoft/vscode/${VSCODE_VERSION}/${path}`,
        );
        await writeFile(
          `${sourcesDirectory}/vscode/${path.split("/")[1]}.json`,
          text,
        );
      }
    }),
  );
  await writeFile(
    `${sourcesDirectory}/languages.yml`,
    await source(
      `https://raw.githubusercontent.com/github-linguist/linguist/${LINGUIST_COMMIT}/lib/linguist/languages.yml`,
    ),
  );
  console.log({
    manifests: paths.length,
    vscode: VSCODE_VERSION,
    linguist: LINGUIST_COMMIT,
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await fetchSources();
