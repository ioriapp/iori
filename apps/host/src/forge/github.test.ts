import assert from "node:assert/strict";
import test from "node:test";
import { storedAccountEnvironment } from "./github.ts";

test("the stored-account gh environment removes both inherited token keys", () => {
  const inherited = {
    GH_TOKEN: "primary",
    GITHUB_TOKEN: "fallback",
    Gh_Token: "windows-alias",
    GH_CONFIG_DIR: "isolated-config",
    PATH: "isolated-bin",
  };
  assert.deepEqual(storedAccountEnvironment(inherited), {
    GH_CONFIG_DIR: "isolated-config",
    PATH: "isolated-bin",
  });
  assert.equal(inherited.GH_TOKEN, "primary");
  assert.equal(inherited.GITHUB_TOKEN, "fallback");
});
