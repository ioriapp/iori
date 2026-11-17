import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { clientTerminal } from "./terminals.mjs";

const requireClient = createRequire(
  new URL("../../apps/client/package.json", import.meta.url),
);
const { createElement } = requireClient("react");
const { renderToStaticMarkup } = requireClient("react-dom/server");
const { MousePointer2 } = requireClient("lucide-react");

export async function captureScenes(page, output) {
  const { forbidden } = JSON.parse(
    await readFile(join(homedir(), ".config/iori/publish.json"), "utf8"),
  );
  assert.ok(Array.isArray(forbidden) && forbidden.length);
  const cursorSvg = renderToStaticMarkup(
    createElement(MousePointer2, {
      size: 25,
      fill: "var(--foreground)",
      stroke: "var(--background)",
      strokeWidth: 1.6,
    }),
  );
  await page.evaluate(
    ({ forbidden, cursorSvg }) => {
      const observation = {
        frames: 0,
        terminalFrames: 0,
        safe: true,
        missingTerminal: false,
        frame: 0,
      };
      const normalize = (value) => value.toLowerCase().replace(/\s+/gu, "");
      // Read the already mounted Terminal ref. Nothing in React or xterm is
      // replaced or assigned. Unlike the removed web-only fixture property,
      // this reads the actual renderer buffer, including cursor overwrites.
      const renderer = (element) => {
        for (let owner = element; owner; owner = owner.parentElement) {
          const key = Object.keys(owner).find((key) =>
            key.startsWith("__reactFiber$"),
          );
          for (let fiber = key && owner[key]; fiber; fiber = fiber.return) {
            for (
              let hook = fiber.memoizedState;
              hook && typeof hook === "object";
              hook = hook.next
            ) {
              const current = hook.memoizedState?.current;
              if (current?.element === element && current.buffer?.active)
                return current;
            }
          }
        }
      };
      const check = () => {
        let text = document.body.innerText;
        for (const element of document.querySelectorAll("input,textarea"))
          if (element.checkVisibility()) text += "\n" + element.value;
        let terminals = 0;
        for (const element of document.querySelectorAll(
          '[data-iori-view="terminal"][data-iori-displayed="true"] .xterm',
        )) {
          if (!element.checkVisibility()) continue;
          const terminal = renderer(element);
          if (!terminal) {
            observation.missingTerminal = true;
            observation.safe = false;
            continue;
          }
          terminals++;
          const buffer = terminal.buffer.active;
          for (
            let row = buffer.viewportY;
            row < buffer.viewportY + terminal.rows;
            row++
          )
            text += "\n" + (buffer.getLine(row)?.translateToString() ?? "");
        }
        const normalized = normalize(text);
        if (
          forbidden.some(
            (value) =>
              normalize(value) && normalized.includes(normalize(value)),
          )
        )
          observation.safe = false;
        observation.frames++;
        if (terminals) observation.terminalFrames++;
        observation.frame = requestAnimationFrame(check);
      };
      // A recording-only cursor uses the same Lucide component and tokens as
      // the product. It has no handlers and never intercepts an operation.
      const cursor = document.createElement("div");
      cursor.innerHTML = cursorSvg;
      cursor.style.cssText =
        "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:25px;height:25px;transform:translate(-50px,-50px)";
      document.body.append(cursor);
      const move = (event) => {
        cursor.style.transform = `translate(${event.clientX}px,${event.clientY}px)`;
      };
      document.addEventListener("mousemove", move);
      window.__ioriDemoCapture = {
        observation,
        stop() {
          cancelAnimationFrame(observation.frame);
          document.removeEventListener("mousemove", move);
          cursor.remove();
        },
      };
      check();
    },
    { forbidden, cursorSvg },
  );
  const colors = await page.evaluate(() => {
    const token = (name) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${name})`;
      document.body.append(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = rgb;
      ctx.fillRect(0, 0, 1, 1);
      return (
        "#" +
        Array.from(ctx.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("")
      );
    };
    return {
      background: token("--sidebar"),
      foreground: token("--foreground"),
      fontFamily: getComputedStyle(document.body).fontFamily,
    };
  });
  const scenes = [];
  let current;
  let failure;
  let number = 0;
  await mkdir(join(output, "frames"), { recursive: true });
  const session = await page.context().newCDPSession(page);
  await session.send("Page.enable");
  let pending = Promise.resolve();
  session.on("Page.screencastFrame", (frame) => {
    const scene = current;
    pending = pending.then(async () => {
      try {
        if (scene) {
          const path = join(
            output,
            "frames",
            `frame-${String(number++).padStart(6, "0")}.jpg`,
          );
          await writeFile(path, Buffer.from(frame.data, "base64"));
          scene.frames.push({
            path,
            time: frame.metadata.timestamp * 1000,
            text: (await clientTerminal(page)).text,
          });
        }
      } catch (error) {
        failure = error;
      } finally {
        await session.send("Page.screencastFrameAck", {
          sessionId: frame.sessionId,
        });
      }
    });
  });
  // Record actual compositor frames at physical DPR 2. Acknowledging after
  // persistence provides back pressure without repeated PNG screenshots.
  const viewport = page.viewportSize();
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  await session.send("Page.startScreencast", {
    format: "jpeg",
    quality: 95,
    maxWidth: viewport.width * dpr,
    maxHeight: viewport.height * dpr,
    everyNthFrame: 1,
  });
  return {
    checkpoint(name, terminal) {
      if (current) {
        (current.checkpoints ??= {})[name] = current.frames.length;
        if (terminal) current.reading = terminal;
      }
    },
    async scene(name, focus, body) {
      assert.ifError(failure);
      const scene = { name, focus, frames: [] };
      scenes.push(scene);
      current = scene;
      try {
        await body();
      } finally {
        current = undefined;
        await pending;
      }
      assert.ok(scene.frames.length, `Scene ${name} has no frames`);
      assert.ifError(failure);
    },
    // Editorial screen time, not a test wait or an operation timeout.
    hold: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    async finish() {
      await session.send("Page.stopScreencast");
      await pending;
      await session.detach();
      const privacy = await page.evaluate(() => {
        const capture = window.__ioriDemoCapture;
        capture.stop();
        return capture.observation;
      });
      const manifest = {
        scenes,
        colors,
        privacy: {
          ...privacy,
          forbiddenValues: forbidden.length,
          method:
            "Visible DOM, input values and actual xterm renderer viewport on every animation frame",
        },
      };
      await writeFile(
        join(output, "capture.json"),
        JSON.stringify(manifest, null, 2) + "\n",
      );
      assert.ifError(failure);
      assert.equal(
        privacy.safe,
        true,
        "公開禁止の値、または読み取れないTerminalがあります（値は記録しません）",
      );
      assert.ok(privacy.terminalFrames > 0);
      return manifest;
    },
  };
}
