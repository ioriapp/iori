import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { npmNotice } from "./npm.mjs";
import { cargoNotice } from "./cargo.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const client = path.join(root, "apps/client");
async function packageDirectory(file) {
  file = file.replaceAll("/", path.sep);
  if (!file.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
  let directory = path.dirname(file);
  while (directory.includes(`${path.sep}node_modules${path.sep}`)) {
    try {
      await readFile(path.join(directory, "package.json"));
      return await realpath(directory);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    directory = path.dirname(directory);
  }
}

export function thirdPartyLicenses() {
  return {
    name: "iori-third-party-licenses",
    apply: "build",
    async generateBundle(_options, bundle) {
      const inputs = new Set();
      for (const item of Object.values(bundle)) {
        if (item.type === "chunk")
          for (const id of item.moduleIds) inputs.add(id.split("?")[0]);
        else
          for (const name of item.originalFileNames ?? [])
            inputs.add(path.resolve(client, name));
      }
      const packages = new Set();
      for (const file of inputs) {
        const directory = await packageDirectory(file);
        if (directory) packages.add(directory);
      }
      let warned = false;
      const options = {
        strict: process.env.IORI_RELEASE_BUILD === "1",
        warn: () => {
          if (!warned) {
            console.warn(
              "Client license inventory is incomplete or stale; update licenses before release",
            );
            warned = true;
          }
        },
      };
      const npm = await npmNotice(packages, options);
      const cargo = await cargoNotice("client", options);
      const copied = [
        "apps/client/third-party/ORCA-MIT-LICENSE.txt",
        "apps/client/third-party/TAURI-WINDOW-CONTROLS-MIT-LICENSE.txt",
      ];
      const icons = "apps/client/third-party/cli-icons";
      for (const name of (await readdir(path.join(root, icons)))
        .filter((name) => name.endsWith("LICENSE.txt"))
        .sort())
        copied.push(`${icons}/${name}`);
      const symbols = "scripts/licenses/sources/nerd-fonts-3.5.1";
      for (const name of (await readdir(path.join(root, symbols))).sort())
        copied.push(`${symbols}/${name}`);
      const copiedText = await Promise.all(
        copied.map(
          async (file) =>
            `===== ${file} =====\n${await readFile(path.join(root, file), "utf8")}`,
        ),
      );
      const text = [
        "iori",
        await readFile(path.join(root, "LICENSE"), "utf8"),
        "Third-party npm packages",
        npm.text,
        "Third-party Rust crates",
        cargo.text,
        ...copiedText,
        "OpenAI's name and logo are trademarks of OpenAI. https://openai.com/brand/",
      ].join("\n\n");
      this.emitFile({
        type: "asset",
        fileName: "THIRD-PARTY-LICENSES.txt",
        source: text,
      });
      console.log(
        `Client licenses: npm=${npm.count}, Rust=${cargo.count}, copied=${copied.length}`,
      );
    },
  };
}
