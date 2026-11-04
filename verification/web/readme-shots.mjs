import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";

export async function runReadmeThemes(entry) {
  for (const theme of ["dark", "light"]) {
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [entry, "--only=readme-shots", `--readme-theme=${theme}`],
        { stdio: "inherit" },
      );
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        code === 0
          ? resolve()
          : reject(new Error(`README ${theme}: exit ${signal ?? code}`)),
      );
    });
  }
}

// Check actual canvas text as well as DOM text. A video is scanned on every
// animation frame throughout the recorded delegation, including transitions.
export async function readmeCapture({
  client,
  shot,
  evidence,
  privacyFile,
  theme,
  recording,
}) {
  const { forbidden } = JSON.parse(await readFile(privacyFile, "utf8"));
  assert.ok(Array.isArray(forbidden), "公開禁止の値を設定してください");
  const output = resolve(import.meta.dirname, "../../docs/images");
  await mkdir(output, { recursive: true });
  const images = [];
  let screenshots = 0;
  let clipStart, clipEnd, videoPrivacy;
  const scan = `() => {
    const normalize = value => value.toLowerCase().replace(/\\s+/gu, '');
    let text = document.body.innerText;
    for (const element of document.querySelectorAll('.xterm')) {
      if (!element.checkVisibility()) continue;
      const terminal = element.parentElement.__e2eTerminal ?? element.__e2eTerminal;
      if (!terminal) return false;
      const buffer = terminal.buffer.active;
      for (let row = buffer.viewportY; row < buffer.viewportY + terminal.rows; row++)
        text += '\\n' + (buffer.getLine(row)?.translateToString() ?? '');
    }
    for (const element of document.querySelectorAll('input,textarea'))
      if (element.checkVisibility()) text += '\\n' + element.value;
    const normalized = normalize(text);
    return !${JSON.stringify(forbidden)}.some(value => normalize(value) && normalized.includes(normalize(value)));
  }`;
  const capture = async (name) => {
    assert.equal(
      await client.screen.evaluate(`(${scan})()`),
      true,
      "撮影画面に公開禁止の値があるか、Terminal本文を照合できません",
    );
    const filename = `${name}-${theme}.png`;
    await shot(`${name}-${theme}`);
    await copyFile(join(evidence, filename), join(output, filename));
    screenshots++;
    images.push({
      path: `docs/images/${filename}`,
      bytes: (await stat(join(output, filename))).size,
    });
  };
  return {
    capture,
    async startVideo() {
      await client.screen.evaluate(`(() => {
        const observation = window.__readmeVideoPrivacy = { checked: 0, safe: true };
        const check = () => {
          observation.safe = (${scan})() && observation.safe;
          observation.checked++;
          observation.frame = requestAnimationFrame(check);
        };
        check();
      })()`);
      clipStart = recording.mark();
    },
    async stopVideo() {
      clipEnd = recording.mark();
      videoPrivacy = await client.screen.evaluate(`(() => {
        const observation = window.__readmeVideoPrivacy;
        cancelAnimationFrame(observation.frame);
        return { checked: observation.checked, safe: observation.safe };
      })()`);
      assert.equal(
        videoPrivacy.safe,
        true,
        "動画に公開禁止の値があるか、Terminal本文を照合できません",
      );
    },
    async finish() {
      const source = await recording.close();
      const filename = `team-delegation-${theme}.gif`;
      const target = join(output, filename);
      const duration = clipEnd - clipStart;
      let outputFps = 12;
      const encode = () =>
        execFileSync("ffmpeg", [
          "-v",
          "error",
          "-y",
          "-i",
          source,
          "-vf",
          `trim=start=${clipStart}:end=${clipEnd},setpts=PTS-STARTPTS,fps=${outputFps},scale=1280:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
          "-loop",
          "0",
          target,
        ]);
      encode();
      if ((await stat(target)).size > 8_000_000) {
        outputFps = 10;
        encode();
      }
      images.push({
        path: `docs/images/${filename}`,
        bytes: (await stat(target)).size,
      });
      const privacy = {
        screenshots,
        videoFramesChecked: videoPrivacy.checked,
        forbiddenValues: forbidden.length,
        method:
          "Visible DOM, input values and xterm viewport; every animation frame during the video",
        passed: true,
      };
      await writeFile(
        join(evidence, "readme-images.json"),
        JSON.stringify(
          {
            images,
            privacy,
            video: {
              source,
              clipStart,
              clipEnd,
              sourceSeconds: duration,
              outputFps,
            },
          },
          null,
          2,
        ) + "\n",
      );
      console.log(JSON.stringify({ images, privacy }));
    },
  };
}
