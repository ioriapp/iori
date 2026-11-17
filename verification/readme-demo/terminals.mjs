/** Read the mounted Client screen without changing its renderer or state. */
export async function clientTerminal(page) {
  return page.evaluate(() => {
    const element = document.querySelector(
      '[data-iori-view="terminal"][data-iori-displayed="true"] .xterm',
    );
    if (!element) return { text: "" };
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
          const terminal = hook.memoizedState?.current;
          if (terminal?.element !== element || !terminal.buffer?.active)
            continue;
          const buffer = terminal.buffer.active;
          return {
            text: Array.from(
              { length: terminal.rows },
              (_, row) =>
                buffer
                  .getLine(buffer.viewportY + row)
                  ?.translateToString(true) ?? "",
            ).join("\n"),
            fontSize: terminal.options.fontSize,
            cols: terminal.cols,
            rows: terminal.rows,
            bounds: element.getBoundingClientRect().toJSON(),
            deviceScaleFactor: window.devicePixelRatio,
            canvases: Array.from(
              element.querySelectorAll("canvas"),
              (canvas) => ({
                width: canvas.width,
                height: canvas.height,
                cssWidth: canvas.getBoundingClientRect().width,
                cssHeight: canvas.getBoundingClientRect().height,
              }),
            ),
          };
        }
      }
    }
    return { text: "" };
  });
}
