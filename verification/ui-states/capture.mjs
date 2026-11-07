import { mkdir, readFile, copyFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createStateServer, readCatalog, defaultCatalog } from "./server.mjs";
import { chromiumExecutable } from "../web/browser.mjs";
import { fixture } from "./fixtures.ts";

const args = process.argv.slice(2);
const option = (name, fallback) =>
  args
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
const catalogPath = resolve(option("catalog", defaultCatalog));
const reference = resolve(
  option(
    "reference",
    "/root/projects/iori/.local/ui-sample/dist-shots-v16-host-setup",
  ),
);
const output = resolve(
  option(
    "output",
    `.local/evidence/v16-state-shots/${new Date().toISOString().replaceAll(":", "-")}`,
  ),
);
const states = (await readCatalog(catalogPath)).filter(
  (state) =>
    !option("only", "") || option("only", "").split(",").includes(state.id),
);
const sizes = [
  { name: "pc", width: 1440, height: 900 },
  { name: "wqhd", width: 2560, height: 1440 },
  { name: "phone", width: 390, height: 844 },
].filter(
  (size) =>
    !option("sizes", "") || option("sizes", "").split(",").includes(size.name),
);
const { chromium } = await import(
  pathToFileURL(
    resolve(
      process.env.IORI_PLAYWRIGHT_MODULE ??
        "/root/.pi/agent/npm/node_modules/playwright/index.mjs",
    ),
  )
);
await mkdir(output, { recursive: true });
const server = await createStateServer({ catalog: catalogPath });
let browser;
const rows = [];
try {
  browser = await chromium.launch({
    executablePath: await chromiumExecutable(chromium),
    headless: true,
    args: ["--no-sandbox"],
  });
  for (const size of sizes) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    let renderError;
    page.on("pageerror", (error) => {
      renderError = error.message;
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgent", {
        get: () =>
          new URLSearchParams(location.search).get("state") === "A1c-linux"
            ? "Linux"
            : "Windows",
      });
    });
    for (const theme of ["light", "dark"])
      for (const state of states) {
        const name = `${size.name}-${state.id}-${theme}.png`;
        const row = {
          ...state,
          size: size.name,
          theme,
          name,
          expectedHeight:
            size.name === "phone" ? 844 : state.id.startsWith("A") ? 700 : 580,
          notes: fixture(state.id).notes,
        };
        try {
          await copyFile(
            join(reference, name),
            join(output, `reference-${name}`),
          );
          row.reference = `reference-${name}`;
        } catch (cause) {
          row.referenceMissing = cause.message;
        }
        const reason = fixture(state.id).unavailable;
        if (reason) row.unavailable = reason;
        else
          try {
            renderError = undefined;
            await page.setExtraHTTPHeaders({
              "User-Agent": state.id === "A1c-linux" ? "Linux" : "Windows",
            });
            await page.goto(
              `${server.resolvedUrls.local[0]}?frame&state=${encodeURIComponent(state.id)}&theme=${theme}`,
              { waitUntil: "load" },
            );
            await page.evaluate(async () => {
              await document.fonts.ready;
              await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              );
            });
            if (renderError) row.unavailable = renderError;
            row.height = await page
              .locator(".host-flow-dialog")
              .evaluateAll((elements) =>
                elements.map(
                  (element) => element.getBoundingClientRect().height,
                ),
              );
            row.text = await page
              .locator(
                ".host-flow-dialog, .host-toast, [data-iori-view='host-version'], [data-iori-view='initializing']",
              )
              .allTextContents();
            await page.screenshot({
              path: join(output, name),
              animations: "disabled",
            });
            row.product = name;
          } catch (cause) {
            row.unavailable = cause.message;
          }
        rows.push(row);
        console.log(
          `${size.name} ${theme} ${state.id}: ${row.product ? (row.height.length ? `${row.height.join(", ")}px` : "ダイアログなし") : row.unavailable}`,
        );
      }
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
await writeFile(
  join(output, "measurements.json"),
  JSON.stringify({ catalog: catalogPath, reference, rows }, null, 2),
);
const css = await readFile(
  resolve(import.meta.dirname, "../../apps/client/src/index.css"),
  "utf8",
);
// 一覧は合否を判定しない。高さの実測値と見本の値をそのまま示す。
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>iori Hostの画面の比較</title><style>:root{${css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? ""}}body{font-family:var(--font-sans),sans-serif;background:var(--background);color:var(--foreground);margin:24px}article{margin-block:32px;border-top:1px solid var(--border);content-visibility:auto;contain-intrinsic-size:auto 600px}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.pair img{width:100%;height:auto;border:1px solid var(--border)}figure{margin:0}summary{cursor:pointer}a{color:inherit}nav{display:flex;gap:16px;flex-wrap:wrap}</style><h1>iori Hostの画面の比較</h1><p>左: 見本 / 右: 製品。${states.length}状態 × 3サイズ × 2テーマ。高さは比較のための実測値で、合否を判定しません。</p><p>背景は製品の設定部品を組み合わせた静止画です。B5-last以外の完了後の背景は対象外（設定を閉じた後の画面は E2E で確認済み）で、製品のトークンの無地を使います。処理や状態の移り方の確認には使いません。</p><nav>${sizes.flatMap((size) => ["light", "dark"].map((theme) => `<a href="#${size.name}-${theme}">${size.name} ${theme}</a>`)).join("")}</nav>${rows.map((row, index) => `${index % states.length === 0 ? `<h2 id="${row.size}-${row.theme}">${row.size} ${row.theme}</h2>` : ""}<article id="${row.size}-${row.id}-${row.theme}"><h3>${escape(row.label)}</h3><p>ダイアログの高さ: 見本 ${row.expectedHeight}px / 製品 ${row.height?.length ? row.height.map((height) => `${height}px（差 ${height - row.expectedHeight}px）`).join(", ") : "対象のダイアログなし"}</p>${row.unavailable ? `<p>描画できない理由: ${escape(row.unavailable)}</p>` : ""}${row.notes.map((note) => `<p>${escape(note)}</p>`).join("")}<div class="pair"><figure><figcaption>見本</figcaption>${row.reference ? `<a href="${row.reference}"><img loading="lazy" src="${row.reference}" alt="見本 ${escape(row.label)}"></a>` : `<p>${escape(row.referenceMissing)}</p>`}</figure><figure><figcaption>製品</figcaption>${row.product ? `<a href="${row.product}"><img loading="lazy" src="${row.product}" alt="製品 ${escape(row.label)}"></a>` : ""}</figure></div><details><summary>製品の文</summary><pre>${escape(row.text?.join("\n") ?? "")}</pre></details></article>`).join("")}</html>`;
await writeFile(join(output, "index.html"), html);
console.log(`比較一覧: ${join(output, "index.html")}`);
