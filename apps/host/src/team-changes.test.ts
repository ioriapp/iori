import { test } from "node:test";
import assert from "node:assert/strict";
import { teamChanges } from "./team-changes.ts";
import { parseTeamDefinition, type TeamDefinition } from "@iori/protocol";

test("summaries distinguish fields, additions, removals and priority moves across all difficulties", () => {
  const candidate = (id: string) => ({
    id,
    cli: "codex",
    model: id,
    minimum: "",
    tools: [],
  });
  const before: TeamDefinition = {
    name: "Team",
    description: "Description",
    parent: candidate("parent"),
    instruction: "Instructions",
    roles: [
      {
        id: "worker",
        name: "Worker",
        when: "Implementation",
        limit: "2",
        reuse: true,
        split: true,
        instruction: "Implement",
        request: "Request",
        report: "Report",
        candidates: {
          high: [candidate("high-first"), candidate("high-second")],
          medium: [candidate("medium-first"), candidate("medium-second")],
          low: [candidate("low-first"), candidate("low-second")],
        },
      },
      {
        id: "advisor",
        name: "Advisor",
        when: "Advice",
        limit: "1",
        reuse: true,
        split: false,
        instruction: "Advise",
        request: "Request",
        report: "Report",
        candidates: { high: [], medium: [], low: [] },
      },
    ],
  };
  const receivedLimit = parseTeamDefinition(before);
  assert.deepEqual(teamChanges(before, receivedLimit), []);
  receivedLimit.roles[0]!.limit = "3";
  assert.deepEqual(teamChanges(before, receivedLimit), [
    { item: "Concurrency limit", name: "Worker", action: "changed" },
  ]);
  for (const difficulty of ["high", "medium", "low"] as const) {
    const received = parseTeamDefinition(before);
    received.roles[0]!.candidates[difficulty].reverse();
    assert.deepEqual(teamChanges(before, received), [
      { item: "Candidates", name: "Worker", action: "changed" },
    ]);
  }
  assert.equal("permission" in parseTeamDefinition(before).parent, false);
  const explicit = parseTeamDefinition(before);
  explicit.parent.permission = "none";
  explicit.parent.effort = "none";
  assert.equal(parseTeamDefinition(explicit).parent.effort, "none");
  assert.deepEqual(teamChanges(before, explicit), [
    { item: "Execution settings", name: "Parent", action: "changed" },
  ]);
  assert.deepEqual(teamChanges(before, structuredClone(before)), []);
  const after = structuredClone(before);
  after.name += " custom";
  after.description += " local";
  after.parent.model = "other-model";
  after.instruction += " revised";
  const worker = after.roles[0]!;
  worker.limit = "";
  worker.reuse = !worker.reuse;
  worker.request += " evidence";
  worker.candidates.high.reverse();
  worker.candidates.medium.shift();
  worker.candidates.low.push({
    ...structuredClone(worker.candidates.low[0]!),
    id: "new-candidate",
  });
  after.roles.pop();
  after.roles.push({
    ...structuredClone(worker),
    id: "new-role",
    name: "Writer",
  });
  const changes = teamChanges(before, after);
  for (const item of [
    "Name",
    "Description",
    "Execution settings",
    "Instructions",
  ])
    assert.equal(
      changes.some((c) => c.item === item && c.action === "changed"),
      true,
      item,
    );
  for (const item of [
    "Concurrency limit",
    "Reuse child sessions",
    "Request and report",
    "Candidates",
  ])
    assert.equal(
      changes.some(
        (c) => c.name === "Worker" && c.item === item && c.action === "changed",
      ),
      true,
      item,
    );
  for (const action of ["added", "removed"])
    assert.equal(
      changes.some(
        (c) =>
          c.name === "Worker" && c.item === "Candidates" && c.action === action,
      ),
      true,
      action,
    );
  assert.equal(
    changes.some((c) => c.item === "Advisor" && c.action === "removed"),
    true,
  );
  assert.equal(
    changes.some((c) => c.item === "Writer" && c.action === "added"),
    true,
  );
  const identity = structuredClone(before);
  identity.parent.id = "new-parent-id";
  assert.deepEqual(teamChanges(before, identity), []);
  const renamed = structuredClone(before);
  renamed.roles[0]!.name = "Builder";
  assert.deepEqual(teamChanges(before, renamed), [
    { item: "Name", name: "Builder", action: "changed" },
  ]);
});
