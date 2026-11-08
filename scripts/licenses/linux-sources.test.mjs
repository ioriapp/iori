import { test } from "node:test";
import assert from "node:assert/strict";
import { sourcesToDownload } from "./linux-sources.mjs";

test("reuse only source archives whose versioned name is already available", () => {
  const required = [
    { name: "ubuntu-example-1_2e0.tar", versioned: true },
    { name: "ubuntu-example-2_2e0.tar", versioned: true },
    { name: "runtime.tar.gz", versioned: false },
  ];
  assert.deepEqual(
    sourcesToDownload(required, ["ubuntu-example-1_2e0.tar", "runtime.tar.gz"]),
    ["ubuntu-example-2_2e0.tar", "runtime.tar.gz"],
  );
});
