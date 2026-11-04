import { typeTerminal } from "../terminal/scenario.mjs";

const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function pressCliKey(client, key) {
  // Startup screens can redraw/reset terminal modes between questions.
  await pause(200);
  if (client.browser.webdriver) {
    const value = { Enter: "\uE007", Escape: "\uE00C", ArrowDown: "\uE015" }[
      key
    ];
    await client.browser.call("actions", {
      actions: [
        {
          type: "key",
          id: "cli-input-keyboard",
          actions: [
            { type: "keyDown", value },
            { type: "keyUp", value },
          ],
        },
      ],
    });
  } else {
    const keyCode = { Enter: 13, Escape: 27, ArrowDown: 40 }[key];
    await client.browser.call("Input.dispatchKeyEvent", {
      type: key === "Enter" ? "keyDown" : "rawKeyDown",
      ...(key === "Enter" ? { text: "\r" } : {}),
      key,
      code: key,
      windowsVirtualKeyCode: keyCode,
    });
    await client.browser.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: key,
      windowsVirtualKeyCode: keyCode,
    });
  }
}

/** Type into the CLI's real focused input and submit with a separate key.
 * Pace above Codex's paste-burst thresholds (8/60 ms, 120 ms Enter window).
 * Windows uses WebDriver; Android and browser use CDP. */
export async function submitToCli(
  client,
  text,
  phase,
  prefix = "cli-input",
  options = {},
) {
  await typeTerminal(client, "", phase, prefix, options);
  // Let the focus/size claim settle before the first physical key, as a
  // person pauses after selecting another terminal pane.
  await pause(200);
  for (const character of text) {
    if (client.browser.webdriver) {
      await client.browser.call("actions", {
        actions: [
          {
            type: "key",
            id: "cli-input-keyboard",
            actions: [
              { type: "keyDown", value: character },
              { type: "keyUp", value: character },
            ],
          },
        ],
      });
    } else if (character.codePointAt(0) > 127) {
      // IME text has no corresponding physical key on the device's layout.
      await client.browser.call("Input.insertText", { text: character });
    } else {
      const upper = character.toUpperCase();
      const punctuation = {
        " ": 32,
        ";": 186,
        ":": 186,
        "=": 187,
        "+": 187,
        ",": 188,
        "<": 188,
        "-": 189,
        _: 189,
        ".": 190,
        ">": 190,
        "/": 191,
        "?": 191,
        "`": 192,
        "~": 192,
        "[": 219,
        "{": 219,
        "\\": 220,
        "|": 220,
        "]": 221,
        "}": 221,
        "'": 222,
        '"': 222,
        ")": 48,
        "!": 49,
        "@": 50,
        "#": 51,
        $: 52,
        "%": 53,
        "^": 54,
        "&": 55,
        "*": 56,
        "(": 57,
      };
      const keyCode = punctuation[character] ?? upper.charCodeAt(0);
      const shifted =
        character !== character.toLowerCase() ||
        '~!@#$%^&*()_+{}|:"<>?'.includes(character);
      await client.browser.call("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: character,
        text: character,
        windowsVirtualKeyCode: keyCode,
        modifiers: shifted ? 8 : 0,
      });
      await client.browser.call("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: character,
        windowsVirtualKeyCode: keyCode,
        modifiers: shifted ? 8 : 0,
      });
    }
    await pause(80);
  }
  await pause(200);
  await typeTerminal(client, "\r", phase, `${prefix}-submit`, {
    ...options,
    focus: false,
  });
}
