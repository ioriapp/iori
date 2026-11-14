/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { webhookScopes } from "./webhook-scope.ts";

test("WindowsのHostではWebhookの受信元をこのマシンだけにし、ほかはLAN・VPNを先頭に出す", () => {
  assert.deepEqual(webhookScopes("Windows"), ["local"]);
  assert.deepEqual(webhookScopes("Linux"), ["lan", "local"]);
  assert.deepEqual(webhookScopes(undefined), ["lan", "local"]);
});
