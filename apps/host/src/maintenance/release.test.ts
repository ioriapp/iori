import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedReleaseUrl } from "./release.ts";
import { readFileSync } from "node:fs";

const hosts: string[] = JSON.parse(
  readFileSync(
    new URL("../../../../release-redirect-hosts.json", import.meta.url),
    "utf8",
  ),
);
test("Release redirects allow HTTPS distribution origins and exact GitHub asset hosts", () => {
  const source = new URL("https://github.com/example/fork/releases");
  for (const [url, expected] of [
    [
      "https://github.com/example/fork/releases/download/v1.0.0/release.json",
      true,
    ],
    [
      "https://release-assets.githubusercontent.com/github-production-release-asset/123?signature=example",
      true,
    ],
    ["http://release-assets.githubusercontent.com/asset", false],
    ["https://release-assets.githubusercontent.com.attacker.test/asset", false],
    ["https://attacker.test/asset", false],
    ["https://release-assets.githubusercontent.com:444/asset", false],
    ["https://user@release-assets.githubusercontent.com/asset", false],
    [
      "http://github.com/example/fork/releases/download/v1.0.0/release.json",
      false,
    ],
  ] as const)
    assert.equal(allowedReleaseUrl(new URL(url), source, hosts), expected, url);
});
