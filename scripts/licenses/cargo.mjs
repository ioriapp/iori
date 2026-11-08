import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

const directory = path.join(import.meta.dirname, "sources/cargo");
const root = path.resolve(import.meta.dirname, "../..");
export const cargoInputs = [
  "Cargo.lock",
  "Cargo.toml",
  "apps/host/native/Cargo.toml",
  "apps/host/terminal-native/Cargo.toml",
  "crates/iori-iroh-config/Cargo.toml",
  "apps/client/src-tauri/Cargo.lock",
  "apps/client/src-tauri/Cargo.toml",
  "apps/client/src-tauri/plugins/apk-installer/Cargo.toml",
  "apps/client/src-tauri/plugins/clipboard-image/Cargo.toml",
];
async function readSource(file, ref) {
  return ref
    ? execFileSync("git", ["show", `${ref}:${file}`], {
        cwd: root,
        encoding: "utf8",
      })
    : await readFile(path.join(root, file), "utf8");
}
export async function cargoHashes(ref) {
  return Object.fromEntries(
    await Promise.all(
      cargoInputs.map(async (file) => {
        let content = await readSource(file, ref);
        if (file === "apps/client/src-tauri/Cargo.toml")
          content = content.replace(
            'tauri = { version = "2.12.0", features = ["tray-icon"] }\n',
            "",
          );
        return [file, createHash("sha256").update(content).digest("hex")];
      }),
    ),
  );
}
export async function cargoNotice(
  profile,
  { strict = true, warn = () => {}, ref } = {},
) {
  let index;
  try {
    index = JSON.parse(
      await readSource("scripts/licenses/sources/cargo/index.json", ref),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (!strict) {
      warn();
      return { count: 0, text: "" };
    }
    throw new Error(
      "Cargo license inventory missing; run node scripts/licenses/update-cargo.mjs",
    );
  }
  const actual = await cargoHashes(ref);
  for (const [file, hash] of Object.entries(actual))
    if (
      (profile.startsWith("host")
        ? !file.startsWith("apps/client/")
        : !file.startsWith("apps/host/") && file !== "Cargo.lock") &&
      index.inputs[file] !== hash
    ) {
      if (strict)
        throw new Error(
          `${file}: Cargo license inventory is stale; run node scripts/licenses/update-cargo.mjs`,
        );
      else warn();
    }
  const entries = [];
  for (const key of index.profiles[profile]) {
    const item = index.packages[key];
    if (!item?.files?.length && !strict) {
      warn();
      continue;
    }
    if (!item?.files?.length)
      throw new Error(
        `${key}: missing license text; run node scripts/licenses/update-cargo.mjs`,
      );
    const files = await Promise.all(
      item.files.map(async (file) => {
        try {
          return `--- ${file.name} (${file.source}) ---\n${await readFile(path.join(directory, "objects", file.hash), "utf8")}`;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          if (!strict) {
            warn();
            return "";
          }
          throw new Error(
            `${key}: missing license text; run node scripts/licenses/update-cargo.mjs`,
          );
        }
      }),
    );
    entries.push(
      `===== ${key} (${item.license ?? "license not declared"}) =====\n${item.authors?.length ? `Declared authors: ${item.authors.join(", ")}\n` : ""}${files.join("\n\n")}`,
    );
  }
  return { count: entries.length, text: entries.join("\n\n") + "\n" };
}
