import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { localCache } from "./cache.mjs";

const androidTarget = "aarch64-linux-android";
// Match verification/connection/build-android.mjs: the distribution APK is
// built with this Cargo and Rustup, which may not be on the ambient PATH.
const androidCargoBin = "/root/projects/iori/.local/android-cargo/bin";
const androidRustupHome = "/root/projects/iori/.local/android-rustup";

async function isDirectory(candidate) {
  try {
    return (await stat(candidate)).isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function sourceFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(file)));
    else if (entry.isFile() && /\.(?:kt|java)$/u.test(entry.name))
      files.push(file);
  }
  return files;
}

function readCargoMetadata(cargoManifest) {
  let output;
  try {
    output = execFileSync(
      "cargo",
      [
        "metadata",
        "--format-version",
        "1",
        "--offline",
        "--filter-platform",
        androidTarget,
        "--manifest-path",
        cargoManifest,
      ],
      {
        cwd: path.dirname(cargoManifest),
        // The verification helper builds Android with these caches, so the
        // locked crates are already there and no network is needed.
        env: {
          ...process.env,
          CARGO_HOME: path.join(localCache, "android/cargo-home"),
          RUSTUP_HOME: androidRustupHome,
          PATH: [androidCargoBin, process.env.PATH]
            .filter(Boolean)
            .join(path.delimiter),
        },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const detail = String(error.stderr ?? "").trim() || error.message;
    throw new Error(
      `配布APKの静的検査: CargoのAndroid向け依存を取得できません（cargo metadata）。${detail}`,
      { cause: error },
    );
  }
  return JSON.parse(output);
}

function reachablePackages(metadata) {
  if (!metadata.resolve?.root)
    throw new Error(
      "配布APKの静的検査: cargo metadataにroot packageがありません",
    );
  const packages = new Map(metadata.packages.map((item) => [item.id, item]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const pending = [metadata.resolve.root];
  const seen = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dependency of nodes.get(id)?.dependencies ?? [])
      pending.push(dependency);
  }
  return [...seen].map((id) => packages.get(id)).filter(Boolean);
}

// Tauri names a plugin's Gradle module after the crate's `links` value
// (lowercased, underscores as hyphens). The generated settings are recorded
// as evidence; the plugin itself is found from Cargo and its crates' Android
// directories, so a Tauri format change cannot stop a correct APK.
async function androidPlugins(cargoManifest) {
  const metadata = readCargoMetadata(cargoManifest);
  const plugins = new Map();
  for (const package_ of reachablePackages(metadata)) {
    if (!package_.links?.startsWith("tauri-plugin-")) continue;
    const androidDirectory = path.join(
      path.dirname(package_.manifest_path),
      "android",
    );
    // A plugin without an Android library is desktop-only and cannot be in the APK.
    if (!(await isDirectory(androidDirectory))) continue;
    const name = package_.links.toLowerCase().replaceAll("_", "-");
    plugins.set(name, { package: package_.name, androidDirectory });
  }
  return plugins;
}

async function readGradleSettings(settingsFile) {
  let settings;
  try {
    settings = await readFile(settingsFile, "utf8");
  } catch (error) {
    // Gradle settings are evidence only; a missing file or a Tauri format
    // change must not stop a correct APK.
    return { read: false, error: error.message, modules: new Map() };
  }
  const modules = new Map();
  for (const line of settings.split(/\r?\n/u)) {
    const include = /^\s*include\s+'(:[^']+)'\s*$/u.exec(line);
    if (include) {
      const name = include[1].slice(1);
      if (!modules.has(name)) modules.set(name, undefined);
      continue;
    }
    const project =
      /^\s*project\('(:[^']+)'\)\.projectDir\s*=\s*new File\("((?:[^"\\]|\\.)*)"\)\s*$/u.exec(
        line,
      );
    if (!project) continue;
    let directory = project[2];
    try {
      directory = JSON.parse(`"${project[2]}"`);
    } catch {
      directory = project[2];
    }
    modules.set(project[1].slice(1), directory);
  }
  return { read: true, modules };
}

async function pluginClasses(androidDirectory) {
  const classes = new Set();
  for (const file of await sourceFiles(
    path.join(androidDirectory, "src/main"),
  )) {
    const source = await readFile(file, "utf8");
    const packageName = /^\s*package\s+([\w.]+)\s*;?\s*$/mu.exec(source)?.[1];
    for (const annotation of source.matchAll(/@TauriPlugin\b/gu)) {
      const className = /^[\s\S]{0,2000}?\bclass\s+(\w+)/u.exec(
        source.slice(annotation.index + annotation[0].length),
      )?.[1];
      if (!packageName || !className)
        throw new Error(
          `配布APKの静的検査: pluginのclassを特定できません: ${file}。@TauriPluginを付けたclassの宣言を読み取れる形にしてください`,
        );
      classes.add(`${packageName}.${className}`);
    }
  }
  if (!classes.size)
    throw new Error(
      `配布APKの静的検査: Androidのplugin class（@TauriPlugin）がありません: ${androidDirectory}`,
    );
  return [...classes];
}

const endOfCentralDirectory = 0x06054b50;
const centralDirectoryEntry = 0x02014b50;
const localFileHeader = 0x04034b50;

function zipEntries(apk) {
  let end = -1;
  const firstCandidate = Math.max(0, apk.length - 22 - 0xffff);
  for (let offset = apk.length - 22; offset >= firstCandidate; offset -= 1) {
    if (apk.readUInt32LE(offset) === endOfCentralDirectory) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("配布APKの静的検査: APKのzip構造を読めません");
  const count = apk.readUInt16LE(end + 10);
  const directoryOffset = apk.readUInt32LE(end + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff)
    throw new Error("配布APKの静的検査: Zip64形式のAPKには未対応です");
  const entries = [];
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (apk.readUInt32LE(offset) !== centralDirectoryEntry)
      throw new Error(
        "配布APKの静的検査: APKのcentral directoryが壊れています",
      );
    const method = apk.readUInt16LE(offset + 10);
    const compressedSize = apk.readUInt32LE(offset + 20);
    const nameLength = apk.readUInt16LE(offset + 28);
    const extraLength = apk.readUInt16LE(offset + 30);
    const commentLength = apk.readUInt16LE(offset + 32);
    const localOffset = apk.readUInt32LE(offset + 42);
    const name = apk.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.push({ name, method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function entryBytes(apk, entry) {
  if (apk.readUInt32LE(entry.localOffset) !== localFileHeader)
    throw new Error(
      `配布APKの静的検査: ${entry.name}のlocal headerを読めません`,
    );
  const nameLength = apk.readUInt16LE(entry.localOffset + 26);
  const extraLength = apk.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = apk.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRawSync(compressed);
  throw new Error(
    `配布APKの静的検査: ${entry.name}の圧縮方式(${entry.method})には未対応です`,
  );
}

function readUnsignedLeb128(bytes, offset) {
  let value = 0;
  let shift = 0;
  for (;;) {
    const byte = bytes[offset];
    offset += 1;
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [value >>> 0, offset];
    shift += 7;
    if (shift > 28)
      throw new Error("配布APKの静的検査: DEXの文字列長を読めません");
  }
}

function dexClassNames(bytes) {
  if (bytes.toString("latin1", 0, 4) !== "dex\n")
    throw new Error("配布APKの静的検査: DEXの形式が不正です");
  const stringIdsOffset = bytes.readUInt32LE(60);
  const typeIdsOffset = bytes.readUInt32LE(68);
  const classDefsSize = bytes.readUInt32LE(96);
  const classDefsOffset = bytes.readUInt32LE(100);
  const names = [];
  for (let index = 0; index < classDefsSize; index += 1) {
    const classIndex = bytes.readUInt32LE(classDefsOffset + index * 32);
    const typeIndex = bytes.readUInt32LE(typeIdsOffset + classIndex * 4);
    const stringOffset = bytes.readUInt32LE(stringIdsOffset + typeIndex * 4);
    const [, start] = readUnsignedLeb128(bytes, stringOffset);
    let end = start;
    // The descriptor is null-terminated; the uleb128 prefix counts UTF-16
    // code units, not the MUTF-8 byte length.
    while (end < bytes.length && bytes[end] !== 0) end += 1;
    if (end >= bytes.length)
      throw new Error("配布APKの静的検査: DEXの文字列を読めません");
    const descriptor = bytes.toString("utf8", start, end);
    if (descriptor.startsWith("L") && descriptor.endsWith(";"))
      names.push(descriptor.slice(1, -1).replaceAll("/", "."));
  }
  return names;
}

function apkClassNames(apk) {
  const names = new Set();
  const entries = zipEntries(apk).filter((entry) =>
    /^classes\d*\.dex$/u.test(entry.name),
  );
  if (!entries.length)
    throw new Error("配布APKの静的検査: APKにclasses.dexがありません");
  for (const entry of entries)
    for (const name of dexClassNames(entryBytes(apk, entry))) names.add(name);
  return names;
}

// Resource names are shortened in release APKs. aapt2 resolves them through
// the resource table, so compare the actual files rather than ZIP paths.
export async function checkAndroidLauncherIcons(apk) {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const res = path.join(
    repoRoot,
    "apps/client/src-tauri/gen/android/app/src/main/res",
  );
  const aapt2 = path.join(
    localCache,
    "android/android-sdk/build-tools/36.0.0/aapt2",
  );
  const resources = execFileSync(aapt2, ["dump", "resources", apk], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const apkBytes = await readFile(apk);
  const entries = new Map(
    zipEntries(apkBytes).map((entry) => [entry.name, entry]),
  );
  const table = new Map();
  let resource;
  for (const line of resources.split("\n")) {
    const header = /^\s+resource (0x[0-9a-f]+) (\S+)/u.exec(line);
    if (header) {
      resource = { id: header[1], values: new Map() };
      table.set(header[2], resource);
    } else {
      const file = /^\s+\(([^)]*)\) \(file\) (\S+)/u.exec(line);
      if (file && resource) resource.values.set(file[1], file[2]);
    }
  }
  const manifestSource = await readFile(
    path.join(res, "../AndroidManifest.xml"),
    "utf8",
  );
  const manifest = execFileSync(
    aapt2,
    ["dump", "xmltree", apk, "--file", "AndroidManifest.xml"],
    { encoding: "utf8" },
  );
  const launcherNames = new Set();
  for (const attribute of ["icon", "roundIcon"]) {
    const name = new RegExp(`android:${attribute}="@mipmap/([^"]+)"`, "u").exec(
      manifestSource,
    )?.[1];
    const actual = new RegExp(
      `:${attribute}\\(0x[0-9a-f]+\\)=@(0x[0-9a-f]+)`,
      "u",
    ).exec(manifest)?.[1];
    if (name ? actual !== table.get(`mipmap/${name}`)?.id : Boolean(actual))
      throw new Error(`配布APKの${attribute}が一致しません`);
    if (name) launcherNames.add(name);
  }
  const imageNames = new Set(launcherNames);
  for (const name of launcherNames) {
    const adaptive = table.get(`mipmap/${name}`)?.values.get("anydpi-v26");
    const expectedXml = await readFile(
      path.join(res, `mipmap-anydpi-v26/${name}.xml`),
      "utf8",
    );
    if (!adaptive)
      throw new Error(`配布APKのadaptive iconがありません: ${name}`);
    const xml = execFileSync(
      aapt2,
      ["dump", "xmltree", apk, "--file", adaptive],
      { encoding: "utf8" },
    );
    for (const [, kind, type, reference] of expectedXml.matchAll(
      /<(foreground|background)\s+android:drawable="@(mipmap|color)\/([^"]+)"/gu,
    )) {
      const id = table.get(`${type}/${reference}`)?.id;
      const section = new RegExp(
        `E: ${kind}[^\n]*\n([^]*?)(?=\\s+E:|$)`,
        "u",
      ).exec(xml)?.[1];
      if (!id || !section?.includes(id))
        throw new Error(`配布APKのadaptive iconの${kind}が一致しません`);
      if (type === "mipmap") imageNames.add(reference);
      if (type === "color") {
        const source = await readFile(
          path.join(res, `values/${reference}.xml`),
          "utf8",
        );
        const color = />(#[0-9a-fA-F]+)</u
          .exec(source)?.[1]
          .slice(1)
          .toLowerCase();
        const lines = resources.split("\n");
        const index = lines.findIndex((line) =>
          line.includes(` ${type}/${reference}`),
        );
        if (
          !color ||
          index < 0 ||
          !lines
            .slice(index, index + 3)
            .join("\n")
            .toLowerCase()
            .includes(color)
        )
          throw new Error("配布APKのadaptive iconの背景色が一致しません");
      }
    }
  }
  const failures = [];
  for (const directory of await readdir(res)) {
    if (!directory.startsWith("mipmap-") || directory === "mipmap-anydpi-v26")
      continue;
    for (const name of imageNames) {
      const file = path.join(res, directory, `${name}.png`);
      try {
        await stat(file);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      const target = table
        .get(`mipmap/${name}`)
        ?.values.get(directory.slice(7));
      const entry = entries.get(target);
      if (!entry) {
        failures.push(`${directory}/${name}.png`);
        continue;
      }
      // aapt can change PNG encoding and the RGB values of fully transparent pixels.
      // Compare visible RGBA pixels, including the alpha channel.
      const comparison = spawnSync(
        "python3",
        [
          "-c",
          `from PIL import Image
import io,sys
a=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGBA")
b=Image.open(sys.argv[1]).convert("RGBA")
def visible(p): return (p[0],p[1],p[2],p[3]) if p[3] else (0,0,0,0)
sys.exit(0 if a.size==b.size and all(visible(x)==visible(y) for x,y in zip(a.getdata(),b.getdata())) else 1)
`,
          file,
        ],
        { input: entryBytes(apkBytes, entry) },
      );
      if (
        comparison.error ||
        comparison.status === null ||
        comparison.status > 1
      )
        throw new Error(
          `PNGの画素を比較できません: ${comparison.error?.message ?? comparison.stderr.toString()}`,
        );
      if (comparison.status !== 0) failures.push(`${directory}/${name}.png`);
    }
  }
  if (failures.length)
    throw new Error(
      `配布APKのランチャーアイコンが一致しません: ${failures.join(", ")}`,
    );
}

// Verify that every Tauri plugin with an Android library in the Cargo graph
// has its Android class in the APK DEX. The generated Gradle settings are
// recorded as evidence only. 0.1.64 shipped without the fs and dialog classes
// and crashed on startup.
export async function checkAndroidApkPlugins({ apk, sourceRoot, evidence }) {
  const started = performance.now();
  await checkAndroidLauncherIcons(apk);
  const cargoManifest = path.join(
    sourceRoot,
    "apps/client/src-tauri/Cargo.toml",
  );
  const settingsFile = path.join(
    sourceRoot,
    "apps/client/src-tauri/gen/android/tauri.settings.gradle",
  );
  const expected = await androidPlugins(cargoManifest);
  const gradle = await readGradleSettings(settingsFile);
  const classesInApk = apkClassNames(await readFile(apk));
  const plugins = [];
  for (const [plugin, { androidDirectory }] of expected) {
    const classes = await pluginClasses(androidDirectory);
    plugins.push({
      plugin,
      classes,
      gradleModule: gradle.modules.has(plugin),
      missingClasses: classes.filter((name) => !classesInApk.has(name)),
    });
  }
  const result = {
    apk,
    target: androidTarget,
    seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
    plugins,
    gradle: {
      settings: settingsFile,
      read: gradle.read,
      ...(gradle.error ? { error: gradle.error } : {}),
      unexpectedModules: [...gradle.modules.keys()].filter(
        (name) => name !== "tauri-android" && !expected.has(name),
      ),
    },
    passed: plugins.every((plugin) => !plugin.missingClasses.length),
  };
  await mkdir(evidence, { recursive: true });
  await writeFile(
    path.join(evidence, "static-apk-check.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  const failures = plugins.flatMap((plugin) =>
    plugin.missingClasses.map(
      (name) => `${plugin.plugin}: ${name} がAPKのDEXに無い`,
    ),
  );
  if (failures.length)
    throw new Error(
      `配布APKの静的検査に失敗しました。公開に進めません。\n${failures.join("\n")}`,
    );
  const classCount = plugins.reduce(
    (count, plugin) => count + plugin.classes.length,
    0,
  );
  console.log(
    `[release] android/static plugins=${plugins.length} classes=${classCount} seconds=${result.seconds}`,
  );
  return result;
}
