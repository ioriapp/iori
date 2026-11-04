import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import prettier from "prettier";
import { cargoHashes } from "./cargo.mjs";

const cargo = (...args) =>
  execFileSync("cargo", args, {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
const configurations = [
  ["host-linux", "Cargo.toml", "x86_64-unknown-linux-gnu"],
  ["host-windows", "Cargo.toml", "x86_64-pc-windows-msvc"],
  [
    "client-linux",
    "apps/client/src-tauri/Cargo.toml",
    "x86_64-unknown-linux-gnu",
  ],
  [
    "client-windows",
    "apps/client/src-tauri/Cargo.toml",
    "x86_64-pc-windows-msvc",
  ],
  [
    "client-android",
    "apps/client/src-tauri/Cargo.toml",
    "aarch64-linux-android",
  ],
];
const metadata = new Map();
for (const manifest of new Set(configurations.map(([, file]) => file))) {
  const result = JSON.parse(
    cargo(
      "metadata",
      "--locked",
      "--format-version",
      "1",
      "--manifest-path",
      manifest,
    ),
  );
  for (const item of result.packages)
    if (item.source) metadata.set(`${item.name}@${item.version}`, item);
}
const profiles = {};
for (const [profile, manifest, target] of configurations) {
  const args = [
    "tree",
    "--locked",
    "--manifest-path",
    manifest,
    "--target",
    target,
    "-e",
    "normal",
    "--prefix",
    "depth",
    "--no-dedupe",
    "--format",
    "{p}",
  ];
  if (profile.startsWith("client")) args.push("-p", "iori-client");
  const lines = cargo(...args).split("\n");
  const selected = new Set();
  let skippedDepth;
  for (const line of lines) {
    const match = /^(\d+)(\S+) v(\S+)/.exec(line);
    if (!match) continue;
    const depth = Number(match[1]);
    if (skippedDepth !== undefined && depth > skippedDepth) continue;
    skippedDepth = undefined;
    if (line.includes("(proc-macro)")) {
      skippedDepth = depth;
      continue;
    }
    const key = `${match[2]}@${match[3]}`;
    if (metadata.has(key)) selected.add(key);
  }
  profiles[profile] = [...selected].sort();
  console.log(`${profile}: ${selected.size} crates`);
}
profiles.client = [
  ...new Set([
    ...profiles["client-linux"],
    ...profiles["client-windows"],
    ...profiles["client-android"],
  ]),
].sort();
const selected = [...new Set(Object.values(profiles).flat())].sort();
const cache = new Map();
async function get(url) {
  if (!cache.has(url))
    cache.set(
      url,
      fetch(url).then(async (response) => {
        if (response.status === 404 || response.status === 422) return null;
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        return response.text();
      }),
    );
  return cache.get(url);
}
const objects = new Map();
const clarifications = JSON.parse(
  await readFile(
    path.join(import.meta.dirname, "sources/clarifications/index.json"),
    "utf8",
  ),
);
function sourceFile(name, text, source) {
  const hash = createHash("sha256").update(text).digest("hex");
  objects.set(hash, text);
  return { name, hash, source };
}
const packages = {};
for (const key of selected) {
  const item = metadata.get(key);
  const directory = path.dirname(item.manifest_path);
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(?:licen[cs]e|copying|copyright|notice|unlicense)(?:[._-]|$)/i.test(
          entry.name,
        ),
    )
    .map((entry) => entry.name)
    .sort();
  let files = [];
  for (const name of names)
    files.push(
      sourceFile(
        name,
        await readFile(path.join(directory, name), "utf8"),
        `https://crates.io/api/v1/crates/${item.name}/${item.version}/download`,
      ),
    );
  if (
    !names.some(
      (name) =>
        /^(?:licen[cs]e|copying|unlicense)(?:[._-]|$)/i.test(name) &&
        !/\.spdx$/i.test(name),
    )
  ) {
    let vcs = {};
    try {
      vcs = JSON.parse(
        await readFile(path.join(directory, ".cargo_vcs_info.json"), "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const repo = item.repository?.replace(/\.git$/, "");
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repo ?? ""))
      throw new Error(`${key}: license missing and no supported repository`);
    const raw = repo.replace(
      "https://github.com/",
      "https://raw.githubusercontent.com/",
    );
    const candidates = [
      "LICENSE",
      "LICENSE-MIT",
      "LICENSE-APACHE",
      "LICENSE.txt",
      "LICENSE.md",
      "LICENSE-MIT.md",
      "LICENSE-APACHE.md",
      "COPYING",
      "UNLICENSE",
      "license",
      "license.txt",
    ];
    const ancestors = [""];
    let segment = vcs.path_in_vcs ?? "";
    while (segment) {
      ancestors.unshift(segment);
      segment = path.dirname(segment);
      if (segment === ".") segment = "";
    }
    async function tryRevision(sha) {
      if (!sha) return [];
      const found = [];
      for (const ancestor of ancestors)
        for (const name of candidates) {
          const subpath = ancestor ? `${ancestor}/${name}` : name;
          const url = `${raw}/${sha}/${subpath}`;
          const text = await get(url);
          if (text !== null) found.push(sourceFile(subpath, text, url));
        }
      return found;
    }
    let upstream = await tryRevision(vcs.git?.sha1);
    if (!upstream.length) {
      const api = `${repo.replace("https://github.com/", "https://api.github.com/repos/")}/commits/HEAD`;
      const result = await get(api);
      if (result) upstream = await tryRevision(JSON.parse(result).sha);
    }
    if (!upstream.length && clarifications[key]) {
      const clarification = clarifications[key];
      const text = await readFile(
        path.join(
          import.meta.dirname,
          "sources/clarifications",
          clarification.text,
        ),
        "utf8",
      );
      upstream = [
        sourceFile(
          `clarification (${clarification.license})`,
          `Declared author: ${clarification.author}\nReason: ${clarification.reason}\n\n${text}`,
          clarification.source,
        ),
      ];
    }
    if (!upstream.length)
      throw new Error(
        `${key}: license text missing; add a reviewed clarification`,
      );
    files = files.concat(upstream);
  }
  packages[key] = {
    license: item.license,
    authors: item.authors.map((author) => author.replace(/\s*<[^>]+>/g, "")),
    files,
  };
}
const root = path.join(import.meta.dirname, "sources/cargo");
await mkdir(path.join(root, "objects"), { recursive: true });
for (const [hash, text] of objects)
  await writeFile(path.join(root, "objects", hash), text);
await writeFile(
  path.join(root, "index.json"),
  await prettier.format(
    JSON.stringify({ inputs: await cargoHashes(), profiles, packages }),
    { parser: "json" },
  ),
);
console.log(
  `Cargo: ${selected.length} crates, ${objects.size} unique original texts`,
);
