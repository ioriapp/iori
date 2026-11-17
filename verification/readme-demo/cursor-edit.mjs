import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";

const exec = promisify(execFile);
const ffmpeg = (args, options) =>
  exec(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    options,
  );

// A cursor edit names original capture frames and records the observed hit
// rectangles. Only the baked cursor is covered; CLI output stays in the source.
export async function prepareCursorEdit(output, capture) {
  const edit = JSON.parse(
    await readFile(join(output, "interaction-edit.json")),
  );
  const assets = join(output, "public");
  const frame = ([scene, index]) => capture.scenes[scene].frames[index].path;
  for (const [name, patch] of Object.entries(edit.patches)) {
    const [x, y, width, height] = patch.sourceRect;
    const { stdout } = await ffmpeg(
      [
        "-i",
        frame(patch.frame),
        "-vf",
        `crop=${width}:${height}:${x}:${y}`,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ],
      { encoding: "buffer" },
    );
    if (patch.background) {
      const { from, to } = patch.background;
      // Preserve the recorded gray text while matching its selected-row
      // background. This recovers text that was underneath the old pointer.
      for (let i = 0; i < stdout.length; i += 3) {
        const row = Math.floor(i / 3 / width);
        if (
          patch.background.rows &&
          (row < patch.background.rows[0] || row >= patch.background.rows[1])
        )
          continue;
        const alpha = Math.min(
          1,
          Math.max(0, (stdout[i + 1] - from[1]) / (150 - from[1])),
        );
        for (let c = 0; c < 3; c++)
          stdout[i + c] = Math.round(
            stdout[i + c] + (to[c] - from[c]) * (1 - alpha),
          );
      }
    }
    const raw = join(output, `${name}.rgb`);
    await writeFile(raw, stdout);
    await ffmpeg([
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-s",
      `${width}x${height}`,
      "-i",
      raw,
      "-frames:v",
      "1",
      join(assets, `${name}.png`),
    ]);
  }
  const patchFilter = (patches, first = "0:v") => {
    const inputs = [];
    const filters = [];
    let previous = first;
    for (const [i, patch] of patches.entries()) {
      inputs.push("-i", join(assets, `${patch.name}.png`));
      const label = `patched${i}`;
      const condition =
        patch.until !== undefined
          ? `:enable='lt(t,${patch.until})'`
          : patch.after !== undefined
            ? `:enable='gte(t,${patch.after})'`
            : "";
      filters.push(
        `[${previous}][${i + 1}:v]overlay=${patch.at[0]}:${patch.at[1]}${condition}[${label}]`,
      );
      previous = label;
    }
    return { inputs, filter: filters.join(";"), map: previous };
  };
  for (const clip of edit.clips) {
    if (!clip.source) continue;
    const filter = patchFilter(clip.patches ?? []);
    await ffmpeg([
      "-ss",
      String(clip.trim),
      "-i",
      join(assets, `${clip.source}.mp4`),
      ...filter.inputs,
      ...(filter.filter
        ? ["-filter_complex", filter.filter, "-map", `[${filter.map}]`]
        : []),
      "-t",
      String(clip.duration * (clip.rate ?? 1)),
      "-an",
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
      join(assets, `${clip.id}.mp4`),
    ]);
    clip.src = `${clip.id}.mp4`;
  }
  for (const interaction of edit.interactions) {
    for (const side of ["before", "after"]) {
      const image = interaction[side];
      const filter = patchFilter(image.patches ?? []);
      image.src = `${interaction.id}-${side}.png`;
      await ffmpeg([
        "-i",
        frame(image.frame),
        ...filter.inputs,
        ...(filter.filter
          ? ["-filter_complex", filter.filter, "-map", `[${filter.map}]`]
          : []),
        "-frames:v",
        "1",
        join(assets, image.src),
      ]);
    }
  }
  // Use the installed OS arrow at DPR 2, with the requested white fill and
  // black edge. Xcursor pixels are premultiplied BGRA; invert within alpha.
  const native = await readFile("/usr/share/icons/Adwaita/cursors/default");
  let cursor;
  for (let i = 0; i < native.readUInt32LE(12); i++) {
    const entry = 16 + i * 12;
    if (
      native.readUInt32LE(entry) !== 0xfffd0002 ||
      native.readUInt32LE(entry + 4) !== 48
    )
      continue;
    const position = native.readUInt32LE(entry + 8);
    cursor = {
      width: native.readUInt32LE(position + 16),
      height: native.readUInt32LE(position + 20),
      xhot: native.readUInt32LE(position + 24),
      yhot: native.readUInt32LE(position + 28),
    };
    const pixels = Buffer.from(
      native.subarray(
        position + 36,
        position + 36 + cursor.width * cursor.height * 4,
      ),
    );
    for (let p = 0; p < pixels.length; p += 4)
      for (let c = 0; c < 3; c++) pixels[p + c] = pixels[p + 3] - pixels[p + c];
    await writeFile(join(output, "pointer.bgra"), pixels);
  }
  if (!cursor) throw new Error("The installed OS cursor has no DPR 2 arrow");
  await ffmpeg([
    "-f",
    "rawvideo",
    "-pix_fmt",
    "bgra",
    "-s",
    `${cursor.width}x${cursor.height}`,
    "-i",
    join(output, "pointer.bgra"),
    "-frames:v",
    "1",
    join(assets, "pointer.png"),
  ]);
  const clips = [];
  const switches = [];
  let from = 0;
  for (const clip of edit.clips) {
    for (const interaction of edit.interactions.filter(
      (s) => s.beforeClip === clip.id,
    )) {
      switches.push({ ...interaction, from });
      from += 39;
    }
    clips.push({ ...clip, from });
    from += Math.round(clip.duration * 30);
  }
  const props = {
    clips,
    switches,
    pointer: cursor,
    colors: capture.colors,
    durationInFrames: from,
    roleEnd: clips.find((c) => c.id === "parent-launch").from,
    closingFrom: clips.find((c) => c.id === "closing").from,
  };
  await writeFile(
    join(output, "props.json"),
    JSON.stringify(props, null, 2) + "\n",
  );
  await copyFile(
    join(output, "interaction-edit.json"),
    join(output, "interaction-review.json"),
  );
  return props;
}
