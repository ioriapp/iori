import assert from "node:assert/strict";
import { test } from "node:test";
import {
  limitKey,
  teamNotice,
  type Candidate,
  type Role,
} from "@iori/protocol";
import { chooseCandidate } from "./assignment.ts";
const candidate = (id: string, cli: string, model: string): Candidate => ({
  id,
  cli,
  model,
  tools: [],
  minimum: "",
});
const first = candidate("first", "pi", "openai/luna"),
  second = candidate("second", "pi", "other/luna"),
  third = candidate("third", "claude", "haiku");
const role: Role = {
  id: "worker",
  name: "Worker",
  when: "work",
  limit: "2",
  reuse: true,
  split: true,
  candidates: { high: [first, second, third], medium: [third], low: [] },
  instruction: "",
  request: "",
  report: "",
};
test("candidate priority respects all concurrency scopes without crossing difficulty", () => {
  const available = new Set(["pi", "claude"]);
  const settings = {
    enabled: true,
    defaultTeam: "",
    limits: { [limitKey("pi", "provider", "openai")]: "1" },
  };
  const running = [{ cli: "pi", model: "openai/sol" }];
  assert.equal(
    chooseCandidate(role, "high", available, running, settings, "conversation")
      .candidate,
    second,
  );
  settings.limits[limitKey("pi", "model", "other/luna")] = "1";
  assert.equal(
    chooseCandidate(
      role,
      "high",
      available,
      [...running, { cli: "pi", model: "other/luna" }],
      settings,
      "conversation",
    ).candidate,
    third,
  );
  settings.limits[limitKey("pi", "cli")] = "1";
  assert.equal(
    chooseCandidate(
      role,
      "high",
      new Set(["pi"]),
      running,
      settings,
      "conversation",
    ).waiting,
    "capacity",
  );
  assert.equal(
    chooseCandidate(role, "low", available, [], settings, "conversation")
      .waiting,
    "candidates",
  );
  assert.equal(
    chooseCandidate(
      { ...role, split: false },
      "low",
      available,
      [],
      settings,
      "conversation",
    ).candidate,
    third,
  );
  assert.equal(
    chooseCandidate(
      role,
      "high",
      available,
      [
        { cli: "pi", conversation: "conversation", role: "worker" },
        { cli: "claude", conversation: "conversation", role: "worker" },
      ],
      settings,
      "conversation",
    ).waiting,
    "capacity",
  );
});
test("notices remain one line when externally supplied titles contain controls", () => {
  assert.equal(
    teamNotice("Worker\r", "title\nnext\u2028line", "reported"),
    '[iori] Worker  "title next line" reported. Run iori tasks and iori read to check.',
  );
});

test("usage minimum preserves priority at the boundary, skips depleted candidates and permits unknown usage", () => {
  const codex = { ...candidate("codex", "codex", "gpt-6-luna"), minimum: "25" };
  const choice = {
    ...role,
    split: false,
    candidates: { high: [], medium: [codex, third], low: [] },
  };
  const available = new Set(["codex", "claude"]);
  const settings = { enabled: true, defaultTeam: "", limits: {} };
  const choose = (
    windows: { remaining: number; minutes: number }[] | undefined,
  ) =>
    chooseCandidate(
      choice,
      "medium",
      available,
      [],
      settings,
      "conversation",
      new Map(windows ? [["codex", { windows }]] : []),
    );
  assert.equal(
    choose([
      { remaining: 25, minutes: 300 },
      { remaining: 80, minutes: 10080 },
    ]).candidate,
    codex,
  );
  assert.equal(
    choose([
      { remaining: 24, minutes: 300 },
      { remaining: 80, minutes: 10080 },
    ]).candidate,
    third,
  );
  assert.equal(
    choose([
      { remaining: 80, minutes: 300 },
      { remaining: 24, minutes: 10080 },
    ]).candidate,
    third,
  );
  assert.equal(choose(undefined).candidate, codex);
  assert.equal(
    chooseCandidate(
      choice,
      "medium",
      new Set(["codex"]),
      [],
      settings,
      "conversation",
      new Map([["codex", { windows: [{ remaining: 0, minutes: 300 }] }]]),
    ).waiting,
    "candidates",
  );
});
