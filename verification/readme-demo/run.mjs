// Install this independent package with: npm ci --prefix verification/readme-demo --workspaces=false
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const base = resolve(".local/evidence/readme-demo-v2");
const renderOnly = process.argv
  .find((arg) => arg.startsWith("--render-only="))
  ?.slice(14);
if (renderOnly) {
  // Author interaction-edit.json beside capture.json with original frame
  // references, observed hit rectangles and cuts before rendering an edit.
  const { render } = await import("./render.mjs");
  await render(resolve(renderOnly));
} else {
  assert.ok(
    process.argv.includes("--real-models"),
    "Recording requires --real-models (Claude Opus 5.5 and Codex GPT-6.1-Sol)",
  );
  await mkdir(base, { recursive: true });
  const fontDirectory = join(base, "fonts");
  await mkdir(fontDirectory, { recursive: true });
  const font = join(fontDirectory, "NotoSansSymbols2-Regular.ttf");
  try {
    await readFile(font);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    execFileSync("curl", [
      "-fsSL",
      "https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSansSymbols2/NotoSansSymbols2-Regular.ttf",
      "-o",
      font,
    ]);
  }
  const fontConfig = join(fontDirectory, "fonts.conf");
  await writeFile(
    fontConfig,
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><include>/etc/fonts/fonts.conf</include><dir>${fontDirectory}</dir></fontconfig>`,
  );
  execFileSync("fc-cache", [fontDirectory], {
    env: { ...process.env, FONTCONFIG_FILE: fontConfig },
  });
  const counter = join(base, "attempts.json");
  const attempts = JSON.parse(
    await readFile(counter, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return "[]";
    }),
  );
  assert.ok(
    attempts.length < 15,
    "The fifteen authorized real-model recording runs have been used",
  );
  const directory = join(base, `take-${attempts.length + 1}`);
  await mkdir(directory, { recursive: true });
  attempts.push({ directory, started: new Date().toISOString() });
  await writeFile(counter, JSON.stringify(attempts, null, 2) + "\n");
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        key !== "CLAUDECODE" &&
        !key.startsWith("CLAUDE_CODE_") &&
        !key.startsWith("IORI_") &&
        !key.startsWith("CODEX_"),
    ),
  );
  const child = spawn(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "--config=verification/readme-demo/playwright.config.ts",
    ],
    {
      stdio: "inherit",
      env: {
        ...environment,
        IORI_DEMO_OUTPUT: directory,
        FONTCONFIG_FILE: fontConfig,
      },
    },
  );
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  assert.equal(code, 0, `Recording failed; evidence: ${directory}`);
  console.log(`Recording: ${directory}`);
}
