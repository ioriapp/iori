import assert from "node:assert/strict";
import { test } from "node:test";
import {
  belowUsageMinimum,
  orderUsageWindows,
  selectUsageWindow,
  statusBarUsageWindows,
} from "./cli.ts";
import { parseCandidate } from "./teams.ts";

const w = (
  minutes: number,
  remaining: number,
  name?: string,
  resetsAt?: number,
) => ({
  ...(name ? { name } : {}),
  remaining,
  minutes,
  ...(resetsAt !== undefined ? { resetsAt } : {}),
});

test("orderUsageWindows puts unnamed windows first, preserves named group order, and sorts each group by duration", () => {
  assert.deepEqual(
    orderUsageWindows([w(300, 80), w(10080, 40), w(10080, 60, "Fable")]),
    [w(300, 80), w(10080, 40), w(10080, 60, "Fable")],
  );

  assert.deepEqual(
    orderUsageWindows([
      w(10080, 10, "Gemini Models"),
      w(300, 90, "Gemini Models"),
      w(10080, 90, "Claude and GPT models"),
      w(300, 20, "Claude and GPT models"),
      w(10080, 30, "Gemini 4 Argon"),
    ]),
    [
      w(300, 90, "Gemini Models"),
      w(10080, 10, "Gemini Models"),
      w(300, 20, "Claude and GPT models"),
      w(10080, 90, "Claude and GPT models"),
      w(10080, 30, "Gemini 4 Argon"),
    ],
  );

  assert.deepEqual(orderUsageWindows([w(10080, 50)]), [w(10080, 50)]);

  assert.deepEqual(
    orderUsageWindows([w(10080, 60, "Fable"), w(10080, 40), w(300, 80)]),
    [w(300, 80), w(10080, 40), w(10080, 60, "Fable")],
  );

  assert.deepEqual(
    orderUsageWindows([w(10080, 50, "Group", 1), w(10080, 50, "Group", 2)]),
    [w(10080, 50, "Group", 1), w(10080, 50, "Group", 2)],
  );
});

test("statusBarUsageWindows picks up to 3 used windows with lowest remaining in received order", () => {
  assert.deepEqual(
    statusBarUsageWindows([w(300, 80), w(10080, 40), w(10080, 60, "Fable")]),
    [w(300, 80), w(10080, 40), w(10080, 60, "Fable")],
  );

  assert.deepEqual(
    statusBarUsageWindows([
      w(300, 90, "Gemini Models"),
      w(10080, 10, "Gemini Models"),
      w(300, 20, "Claude and GPT models"),
      w(10080, 90, "Claude and GPT models"),
      w(10080, 30, "Gemini 4 Argon"),
    ]),
    [
      w(10080, 10, "Gemini Models"),
      w(300, 20, "Claude and GPT models"),
      w(10080, 30, "Gemini 4 Argon"),
    ],
  );

  assert.deepEqual(
    statusBarUsageWindows([w(300, 100), w(10080, 100), w(10080, 100, "Fable")]),
    [w(300, 100)],
  );
});

test("selectUsageWindow returns matched selection or falls back to lowest remaining", () => {
  assert.equal(selectUsageWindow([]), undefined);
  assert.equal(selectUsageWindow([], { minutes: 300 }), undefined);

  const windows = [
    w(300, 25),
    w(10080, 80),
    w(10080, 100, "Sonnet"),
    w(300, 25, "Other"),
  ];
  assert.deepEqual(selectUsageWindow(windows), windows[0]);
  assert.deepEqual(selectUsageWindow(windows, { minutes: 10080 }), windows[1]);
  assert.deepEqual(
    selectUsageWindow(windows, { minutes: 10080, name: "Sonnet" }),
    windows[2],
  );
  assert.deepEqual(
    selectUsageWindow(windows, { minutes: 300, name: "Missing" }),
    windows[0],
  );
});

test("belowUsageMinimum checks only the selected window while it is available", () => {
  const selected = { minutes: 10080 };
  assert.equal(
    belowUsageMinimum(
      "50",
      { windows: [w(300, 20), w(10080, 50)] },
      "",
      selected,
    ),
    false,
  );
  assert.equal(
    belowUsageMinimum(
      "50",
      { windows: [w(300, 80), w(10080, 49)] },
      "",
      selected,
    ),
    true,
  );
  assert.equal(
    belowUsageMinimum("50", { windows: [w(300, 20)] }, "", selected),
    true,
  );
});

test("belowUsageMinimum matches named windows only when they apply to the model", () => {
  const claudeAndGpt = "Claude and GPT models";
  const gemini = "Gemini models";
  const usage = {
    windows: [
      { ...w(300, 20, gemini), modelPatterns: ["gemini-*"] },
      { ...w(10080, 10, gemini), modelPatterns: ["gemini-*"] },
      { ...w(300, 30, claudeAndGpt), modelPatterns: ["claude-*", "gpt-*"] },
      { ...w(10080, 80, claudeAndGpt), modelPatterns: ["claude-*", "gpt-*"] },
    ],
  };
  assert.equal(
    belowUsageMinimum("50", usage, "claude-sonnet", {
      minutes: 10080,
      name: claudeAndGpt,
    }),
    false,
  );
  assert.equal(
    belowUsageMinimum("25", usage, "claude-sonnet", {
      minutes: 10080,
      name: gemini,
    }),
    false,
  );
  assert.equal(
    belowUsageMinimum("50", usage, "claude-sonnet", {
      minutes: 10080,
      name: gemini,
    }),
    true,
  );
});

test("parseCandidate preserves an omitted minimum window and normalizes valid selections", () => {
  const candidate = {
    id: "worker",
    cli: "codex",
    model: "",
    tools: [],
    minimum: "50",
  };
  assert.deepEqual(parseCandidate(candidate), candidate);
  for (const minimumWindow of [
    { minutes: 10080 },
    { minutes: 10080, name: "Claude and GPT models" },
  ]) {
    assert.deepEqual(
      parseCandidate({
        ...candidate,
        minimumWindow: { ...minimumWindow, remaining: 50 },
      }),
      { ...candidate, minimumWindow },
    );
  }
  for (const minimumWindow of [
    null,
    [],
    {},
    { minutes: "10080" },
    { minutes: 0 },
    { minutes: -1 },
    { minutes: NaN },
    { minutes: Infinity },
    { minutes: 10080, name: "" },
    { minutes: 10080, name: 1 },
  ])
    assert.throws(() => parseCandidate({ ...candidate, minimumWindow }));
});

test("statusBarUsageWindows always includes pinned window even at 0% used without duplicates", () => {
  const w5h = w(300, 25);
  const w7d = w(10080, 80);
  const wSonnet = w(10080, 100, "Sonnet");
  const wExtra = w(10080, 50, "Extra");
  const wLowest = w(300, 10, "Lowest");

  // Pinned 0% used window is included alongside up to 2 used windows in original order.
  assert.deepEqual(
    statusBarUsageWindows([w5h, w7d, wSonnet, wExtra, wLowest], wSonnet),
    [w5h, wSonnet, wLowest],
  );

  // Pinned window already in top 3 used windows is not duplicated.
  assert.deepEqual(
    statusBarUsageWindows([w5h, w7d, wSonnet, wExtra, wLowest], w5h),
    [w5h, wExtra, wLowest],
  );

  // When all windows are unused, pinned window is returned alone.
  const unusedA = w(300, 100);
  const unusedB = w(10080, 100, "Sonnet");
  assert.deepEqual(statusBarUsageWindows([unusedA, unusedB], unusedB), [
    unusedB,
  ]);

  // Pinned window not in the array falls back to default behavior.
  assert.deepEqual(
    statusBarUsageWindows([w5h, w7d, wSonnet], w(10080, 100, "Unknown")),
    [w5h, w7d],
  );
});
