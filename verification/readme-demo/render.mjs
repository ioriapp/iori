import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prepareCursorEdit } from "./cursor-edit.mjs";
import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";

const exec = promisify(execFile);
const quote = (path) => "'" + path.replaceAll("'", "'\\''") + "'";

export async function exportGif(output) {
  const gif = join(output, "team-delegation-dark.gif");
  await exec("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    join(output, "opening-dark.mp4"),
    "-filter_complex",
    "fps=15,scale=1100:-1:flags=lanczos,split[frames][colors];[colors]palettegen=max_colors=128:stats_mode=diff[palette];[frames][palette]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    "-loop",
    "0",
    gif,
  ]);
  return gif;
}

export async function render(output) {
  const capture = JSON.parse(
    await readFile(join(output, "capture.json"), "utf8"),
  );
  assert.equal(
    capture.privacy.safe,
    true,
    "Only privacy-checked recordings can be rendered",
  );
  assert.equal(capture.scenes.length, 6);
  const assets = join(output, "public");
  await mkdir(assets, { recursive: true });
  await copyFile(
    resolve(
      "apps/client/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
    ),
    join(assets, "inter.woff2"),
  );
  await copyFile(
    resolve("apps/client/src/assets/iori-icon.svg"),
    join(assets, "iori-icon.svg"),
  );
  // This transcodes the original compositor frames at their real timestamps.
  // Trimming, sequence timing, layout and captions are authored in Remotion.
  for (const [index, scene] of capture.scenes.entries()) {
    const video = join(assets, `${scene.name}.mp4`);
    // A take's source frames are immutable; editing does not need to encode
    // those same original frames again.
    const exists = await access(video).then(
      () => true,
      (error) => {
        if (error.code !== "ENOENT") throw error;
        return false;
      },
    );
    if (exists) continue;
    const lines = ["ffconcat version 1.0"];
    for (let i = 0; i < scene.frames.length; i++) {
      lines.push(`file ${quote(scene.frames[i].path)}`);
      if (i + 1 < scene.frames.length)
        lines.push(
          `duration ${Math.max(0.001, (scene.frames[i + 1].time - scene.frames[i].time) / 1000)}`,
        );
    }
    const list = join(output, `${index}-source.ffconcat`);
    await writeFile(list, lines.join("\n") + "\n");
    await exec("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-safe",
      "0",
      "-i",
      list,
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-crf",
      "14",
      "-preset",
      "veryfast",
      "-threads",
      "4",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);
  }
  const inputProps = await prepareCursorEdit(output, capture);
  const serveUrl = await bundle({
    rootDir: resolve("verification/readme-demo"),
    entryPoint: resolve("verification/readme-demo/index.tsx"),
    publicDir: assets,
  });
  const composition = await selectComposition({
    serveUrl,
    id: "Opening",
    inputProps,
  });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    licenseKey: "free-license",
    concurrency: 2,
    crf: 16,
    pixelFormat: "yuv420p",
    outputLocation: join(output, "opening-dark.mp4"),
  });
  await exec("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    join(output, "opening-dark.mp4"),
    "-vf",
    "scale=880:-2",
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    join(output, "opening-dark-880.mp4"),
  ]);
  await exportGif(output);
  await mkdir(join(output, "stills"), { recursive: true });
  const stills = [
    ["01-ask", "ask", 5.9],
    ["02-parent", "plan", 3.8],
    ["02-delegation", "plan", 4.95],
    ["03-worker", "worker", 3],
    ["03-worker-report", "worker-report", 1.5],
    ["04-reviewer-started", "parent-launch", 2.8],
    ["04-diff", "diff", 1.5],
    ["04-reviewer", "reviewer", 1.5],
    ["04-reviewer-report", "reviewer-report", 2],
    ["04-accepted", "accept", 3],
    ["05-complete", "complete", 1.5],
    ["07-closing", "closing", 2],
  ].map(([name, id, offset]) => [
    name,
    inputProps.clips.find((c) => c.id === id).from + Math.round(offset * 30),
  ]);
  for (const interaction of inputProps.switches)
    stills.push([`click-${interaction.id}`, interaction.from + 28]);
  for (const [name, frame] of stills)
    await renderStill({
      serveUrl,
      composition,
      inputProps,
      frame,
      imageFormat: "png",
      output: join(output, "stills", `${name}.png`),
    });
  // Preserve a readable-width copy of every delivered state alongside the DPR 2 original.
  await mkdir(join(output, "stills-880"), { recursive: true });
  const { readdir } = await import("node:fs/promises");
  for (const name of await readdir(join(output, "stills"))) {
    await exec("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      join(output, "stills", name),
      "-vf",
      "scale=880:-1",
      join(output, "stills-880", name),
    ]);
  }
  await writeFile(
    join(output, "timeline.json"),
    JSON.stringify(
      {
        fps: 30,
        duration: inputProps.durationInFrames / 30,
        scenes: inputProps.clips.map((clip) => ({
          name: clip.name,
          start: clip.from / 30,
          end: clip.from / 30 + clip.duration,
        })),
        interactions: inputProps.switches.map(
          ({ id, from, hitRect, target, before, after }) => ({
            id,
            start: from / 30,
            end: (from + 39) / 30,
            hitRect,
            target,
            sourceBefore: before.frame,
            sourceAfter: after.frame,
          }),
        ),
        inputProps,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Video: ${join(output, "opening-dark.mp4")}`);
}
