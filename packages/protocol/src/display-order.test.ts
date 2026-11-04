import assert from "node:assert/strict";
import { test } from "node:test";
import { definitionOrder, roleOrder } from "./display-order.ts";

test("roles use the earliest team position, with removed roles after current definitions", () => {
  const teams = [
    { roles: [{ name: "Worker" }, { name: "Reviewer" }] },
    { roles: [{ name: "Planner" }, { name: "Worker" }] },
  ];
  const compare = definitionOrder(roleOrder(teams));
  const roles = ["Retired", "Reviewer", "Worker", "Planner"];
  assert.deepEqual(roles.sort(compare), [
    "Planner",
    "Worker",
    "Reviewer",
    "Retired",
  ]);
  assert.deepEqual(["Reviewer", "Worker"].sort(compare), [
    "Worker",
    "Reviewer",
  ]);
  assert.deepEqual(roleOrder(teams.toReversed()), roleOrder(teams));
});
