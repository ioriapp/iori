import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { androidHashes } from "./android.mjs";

const root = path.join(import.meta.dirname, "sources/android");
const clarificationRoot = path.join(
  import.meta.dirname,
  "sources/clarifications",
);
const repositories = JSON.parse(
  await readFile(
    path.join(import.meta.dirname, "android-repositories.json"),
    "utf8",
  ),
);
const clarifications = JSON.parse(
  await readFile(path.join(clarificationRoot, "android.json"), "utf8"),
);
const run = (file, args) =>
  execFileSync(file, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
async function list(directory) {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function cachedFiles(directory) {
  const files = [];
  for (const hash of await list(directory))
    for (const name of await list(path.join(directory, hash)))
      files.push(path.join(directory, hash, name));
  return files;
}
const tag = (text, name) =>
  new RegExp(`<${name}>([^<]+)</${name}>`).exec(text)?.[1]?.trim();
const section = (text, name) =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1] ?? "";

export async function collectAndroid(report, gradleHome) {
  const body = report
    .split("universalReleaseRuntimeClasspath -")[1]
    ?.split("(c) - A dependency constraint")[0];
  if (!body || report.includes(" FAILED"))
    throw new Error("Gradle runtime dependency report is incomplete");
  const coordinates = new Set();
  for (const line of body.split("\n")) {
    if (line.trim().endsWith("(c)")) continue;
    const match =
      /(?:\+---|\\---) ([^: ]+):([^: ]+)(?::([^ ]+))?(?: -> ([^ ]+))?/.exec(
        line,
      );
    if (!match) continue;
    const [, group, name, requested, selected] = match;
    const version = selected ?? requested;
    if (version) coordinates.add(`${group}:${name}:${version}`);
  }
  const cache = path.join(gradleHome, "caches/modules-2/files-2.1");
  const objects = new Map(),
    packages = {},
    revisions = new Map(),
    fetched = new Map();
  const sourceFile = (name, content, source) => {
    const hash = createHash("sha256").update(content).digest("hex");
    objects.set(hash, content);
    return { name, source, hash };
  };
  for (const key of [...coordinates].sort()) {
    const [group, name, version] = key.split(":");
    const files = await cachedFiles(path.join(cache, group, name, version));
    const artifacts = files.filter(
      (file) =>
        /\.(?:jar|aar)$/.test(file) && !/-(?:sources|javadoc)\.jar$/.test(file),
    );
    if (!artifacts.length) {
      const modulePath = files.find((file) => file.endsWith(".module"));
      const pomPath = files.find((file) => file.endsWith(".pom"));
      const module = modulePath
        ? JSON.parse(await readFile(modulePath, "utf8"))
        : {};
      const redirected = (module.variants ?? []).some((variant) => {
        const target = variant["available-at"];
        return (
          target &&
          coordinates.has(`${target.group}:${target.module}:${target.version}`)
        );
      });
      const pom = pomPath ? await readFile(pomPath, "utf8") : "";
      if (redirected || tag(pom, "packaging") === "pom") continue;
      throw new Error(`${key}: resolved artifact missing from Gradle cache`);
    }
    if (artifacts.length > 1)
      throw new Error(
        `${key}: multiple cached artifacts; identify the selected variant`,
      );
    const artifact = artifacts[0];
    const pomPath = files.find((file) => file.endsWith(".pom"));
    if (!pomPath) throw new Error(`${key}: POM missing from Gradle cache`);
    const pom = await readFile(pomPath, "utf8");
    const artifactName = path.basename(artifact);
    const maven =
      group.startsWith("androidx.") || group === "com.google.android.material"
        ? "https://dl.google.com/dl/android/maven2"
        : "https://repo.maven.apache.org/maven2";
    const metadata = `${maven}/${group.replaceAll(".", "/")}/${name}/${version}/${name}-${version}.pom`;
    const author =
      tag(section(section(pom, "developers"), "developer"), "name") ??
      tag(section(pom, "organization"), "name");
    const origin = `${maven}/${group.replaceAll(".", "/")}/${name}/${version}/${artifactName}`;
    const embedded = run("unzip", ["-Z1", artifact])
      .split("\n")
      .filter(
        (file) =>
          /(?:^|\/)(?:licen[cs]e|notice|copying|copyright)(?:[._-]|$)/i.test(
            file,
          ) && !file.endsWith("/"),
      );
    let notices = embedded.map((file) =>
      sourceFile(
        file,
        run("unzip", ["-p", artifact, file]),
        `${origin}!/${file}`,
      ),
    );
    if (!notices.length) {
      let repo =
        repositories[`${group}:${name}`] ?? tag(section(pom, "scm"), "url");
      repo = repo?.replace(/\/$/, "").replace(/\.git$/, "");
      if (/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repo ?? "")) {
        if (!revisions.has(repo))
          revisions.set(
            repo,
            run("git", ["ls-remote", `${repo}.git`, "HEAD"])
              .trim()
              .split(/\s+/)[0],
          );
        const sha = revisions.get(repo);
        const base = repo.replace(
          "https://github.com/",
          "https://raw.githubusercontent.com/",
        );
        for (const name of [
          "LICENSE",
          "LICENSE.txt",
          "LICENSE.md",
          "COPYING",
          "NOTICE",
          "NOTICE.txt",
          "license/LICENSE.txt",
          "license/COPYRIGHT.txt",
          "license/NOTICE.txt",
        ]) {
          const url = `${base}/${sha}/${name}`;
          if (!fetched.has(url))
            fetched.set(
              url,
              fetch(url).then(async (response) => {
                if (response.status === 404) return null;
                if (!response.ok)
                  throw new Error(`${url}: HTTP ${response.status}`);
                return response.text();
              }),
            );
          const content = await fetched.get(url);
          if (content !== null) notices.push(sourceFile(name, content, url));
        }
      }
      if (
        !notices.some((entry) => /(?:license|copying)/i.test(entry.name)) &&
        clarifications[key]
      ) {
        const detail = clarifications[key];
        const content = await readFile(
          path.join(clarificationRoot, detail.text),
          "utf8",
        );
        notices.push(
          sourceFile(
            `clarification (${detail.license})`,
            `Declared author: ${detail.author}\nReason: ${detail.reason}\nMetadata: ${detail.metadata}\n\n${content}`,
            detail.source,
          ),
        );
      }
      if (
        !notices.some((entry) =>
          /(?:license|copying|clarification)/i.test(entry.name),
        )
      )
        throw new Error(
          `${key}: license text missing; review and add a clarification`,
        );
    }
    packages[key] = { author, metadata, files: notices };
  }
  await mkdir(path.join(root, "objects"), { recursive: true });
  for (const [hash, text] of objects)
    await writeFile(path.join(root, "objects", hash), text);
  const entries = [];
  for (const [key, item] of Object.entries(packages)) {
    const texts = item.files.map(
      (file) =>
        `--- ${file.name} (${file.source}) ---\n${objects.get(file.hash)}`,
    );
    entries.push(
      `===== ${key} =====\n${item.author ? `Declared author: ${item.author}\n` : ""}Metadata: ${item.metadata}\n${texts.join("\n\n")}`,
    );
  }
  await writeFile(
    path.join(root, "THIRD-PARTY-ANDROID.txt"),
    entries.join("\n\n") + "\n",
  );
  await writeFile(
    path.join(root, "index.json"),
    JSON.stringify(
      { inputs: await androidHashes(), count: entries.length, packages },
      null,
      2,
    ) + "\n",
  );
  console.log(`Android Gradle licenses: ${entries.length}`);
}
