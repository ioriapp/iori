import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { waitFor } from "../../verification/ui.mjs";

export const definitionIconSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ea580c" d="M2 2h20v20H2z"/><circle cx="12" cy="12" r="6" fill="#172554"/></svg>',
);
/** Choose actual File objects through the same input as the OS picker. */
export async function chooseFiles(screen, selector, files) {
  const entries = files.map(({ name, bytes, type }) => ({
    name,
    data: Buffer.from(bytes).toString("base64"),
    type,
  }));
  await screen.evaluate(`(()=>{
    const input=document.querySelector(${JSON.stringify(selector)});
    const transfer=new DataTransfer();
    for(const file of ${JSON.stringify(entries)})transfer.items.add(new File([Uint8Array.from(atob(file.data),c=>c.charCodeAt(0))],file.name,{type:file.type}));
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
}
/** Both the rendered image and the transferred bytes must match the file. */
export async function assertIcon(screen, selector, bytes, theme = "light") {
  const expected = createHash("sha256").update(bytes).digest("hex");
  await waitFor(
    () =>
      screen.evaluate(`(async()=>{
    const image=document.querySelector(${JSON.stringify(`${selector} .cli-icon-${theme}`)});
    if(!image?.complete||!image.naturalWidth)return false;
    const bytes=await (await fetch(image.src)).arrayBuffer();
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    return hash===${JSON.stringify(expected)};
  })()`),
    Boolean,
    undefined,
    "選んだ画像が実際のimgに出る",
  );
}
/** Bundled SVGs can be inlined by Vite. Confirm the selected official asset
 * and its painted image; only Host-transferred images use byte hashes. */
export async function assertBundledIcon(screen, selector, icon) {
  const wasDark = await screen.evaluate(
    "document.documentElement.classList.contains('dark')",
  );
  try {
    for (const theme of ["light", "dark"]) {
      const name = theme === "dark" ? (icon.dark ?? icon.light) : icon.light;
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await waitFor(
        () =>
          screen.evaluate(`(async()=>{
        const {default: asset}=await import(${JSON.stringify("/third-party/cli-icons/")}+${JSON.stringify(name)}+'?import&url');
        const expected=new URL(asset,location.href).href;
        const images=[...document.querySelectorAll(${JSON.stringify(`${selector} .cli-icon-${theme}`)})];
        return images.length>0&&images.every(image=>image.src===expected&&image.complete&&image.naturalWidth>0&&getComputedStyle(image).display!=='none'&&image.getBoundingClientRect().width>0&&image.getBoundingClientRect().height>0);
      })()`),
        Boolean,
        undefined,
        `同梱の素材 ${name} が選ばれ、画像として描かれる`,
      );
    }
  } finally {
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${wasDark})`,
    );
  }
}
export async function changeIcon(screen, id, name, bytes) {
  await chooseFiles(
    screen,
    `[data-iori-cli-row="${id}"] [data-iori-field="cli-icon-image"]`,
    [
      {
        name,
        bytes,
        type: name.endsWith(".svg") ? "image/svg+xml" : "image/png",
      },
    ],
  );
  await assertIcon(screen, `[data-iori-cli-row="${id}"]`, bytes, "light");
  await assertIcon(screen, `[data-iori-cli-row="${id}"]`, bytes, "dark");
}
export async function editDefinitionIcon({ screen, id, pictures, record }) {
  const row = `[data-iori-cli-row="${id}"]`;
  await assertIcon(screen, row, definitionIconSvg);
  const light = await readFile(
    new URL(
      "../../apps/client/third-party/cli-icons/cursor-light.png",
      import.meta.url,
    ),
  );
  await changeIcon(screen, id, "light.png", light);
  await pictures.capture("icons-detail", () =>
    screen.reveal(`${row} .cli-def-icon-row`),
  );
  // A bad extension and malformed SVG must leave the existing icon in place.
  for (const [name, bytes] of [
    ["bad.jpg", light],
    [
      "bad.svg",
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path></svg>'),
    ],
    ["bad.png", Buffer.from("not a PNG")],
  ]) {
    await chooseFiles(screen, `${row} [data-iori-field="cli-icon-image"]`, [
      { name, bytes, type: "application/octet-stream" },
    ]);
    await waitFor(
      () => screen.text(`${row} .cli-def-icon-row [role="alert"]`),
      (text) => text === "SVGかPNGの画像を選んでください。",
    );
    await assertIcon(screen, row, light);
  }
  // An upload transport failure must not be described as a bad image.
  await screen.evaluate(`(async()=>{
    const {connection}=await import('/src/connection.ts');
    const original=connection.requestHost;
    window.__restoreIconUpload=()=>{connection.requestHost=original;};
    connection.requestHost=(...args)=>args[1]==='cli.definition.file.write'
      ? Promise.reject(new Error('upload failed')) : original.apply(connection,args);
  })()`);
  try {
    await chooseFiles(screen, `${row} [data-iori-field="cli-icon-image"]`, [
      { name: "light.png", bytes: light, type: "image/png" },
    ]);
    await waitFor(
      () => screen.text(`${row} .cli-def-icon-row [role="alert"]`),
      (text) => text === "Hostで処理できませんでした。もう一度お試しください。",
    );
  } finally {
    await screen.evaluate(
      "window.__restoreIconUpload();delete window.__restoreIconUpload",
    );
  }
  await screen.click(`${row} [data-iori-action="cli-icon-reset"]`);
  await waitFor(() =>
    screen.evaluate(
      `!!document.querySelector(${JSON.stringify(`${row} .cli-def-icon-row svg.lucide-bot`)})&&!document.querySelector(${JSON.stringify(`${row} .cli-icon img`)})`,
    ),
  );
  // The SVG remains on the later launcher's and conversation's icons.
  await changeIcon(screen, id, "icon.svg", definitionIconSvg);
  await pictures.capture("icons-list", () => screen.reveal(row));
  await record(
    "画像を選ぶと、定義のライトとダークの両方のアイコンが同じPNGに替わる。不正な画像では替わらず、共通のアイコンへ戻せる",
  );
}
