import assert from "node:assert/strict";
import { test } from "node:test";
import { ciResources } from "./ci-resources.mjs";

const gib = 1024 ** 3;
const host = { hostMemory: 40 * gib, hostCpus: 18 };

test("uses the RAM available to Docker when the host reports more", () => {
  assert.deepEqual(
    ciResources({ ...host, hostMemory: 120 * gib, dockerMemory: 40 * gib }),
    {
      memoryGiB: 20,
      cargoJobs: 4,
      parallelSuites: 1,
      testConcurrency: 9,
      playwrightWorkers: 5,
    },
  );
});

test("bounds and rounds down the automatic memory limit", () => {
  assert.equal(ciResources({ ...host, hostMemory: 96 * gib }).memoryGiB, 24);
  assert.equal(ciResources({ ...host, hostMemory: 33 * gib }).memoryGiB, 16);
  assert.equal(ciResources({ ...host, hostMemory: 12 * gib }).memoryGiB, 8);
});

test("uses the serial configuration when memory is unavailable", () => {
  assert.deepEqual(ciResources({ hostCpus: 18 }), {
    memoryGiB: 8,
    cargoJobs: 2,
    parallelSuites: 0,
    testConcurrency: 0,
    playwrightWorkers: 4,
  });
});

test("uses the memory override to choose between serial and parallel suites", () => {
  assert.equal(
    ciResources({ ...host, memoryOverride: "8g" }).parallelSuites,
    0,
  );
  assert.equal(
    ciResources({ hostCpus: 8, memoryOverride: "16384m" }).testConcurrency,
    3,
  );
});

test("keeps the suites serial when Docker has fewer than eight CPUs", () => {
  assert.equal(ciResources({ ...host, dockerCpus: 7 }).parallelSuites, 0);
});
