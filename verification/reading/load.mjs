import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { startHostTest } from "../host/process.mjs";
import { prepareReadingTree } from "./responsiveness-fixture.mjs";

// Keep the one-minute load and response limit separate from ordinary E2E.
export async function readingLoad(client, root, record) {
  const samples = [],
    startups = [];
  const requests = {
    "files.list": { root, path: "inside", start: 0, count: 128 },
    "files.info": { root, path: "sample.txt" },
    "git.status": { root, start: 0, count: 128 },
  };
  const started = performance.now();
  while (performance.now() - started < 60000) {
    let watch,
      ready = false;
    const at = performance.now();
    const subscribing = client.readingWatch(root, "files").then((value) => {
      watch = value;
      return watch.waitFor((event) => {
        if (event.ok === false)
          throw new Error(`reading.watch: ${event.error.code}`);
        if (event.type === "reading.changed" && !event.paths) {
          ready = true;
          startups.push(performance.now() - at);
          return true;
        }
        return false;
      });
    });
    const readBatch = () =>
      Promise.all(
        Object.entries(requests).map(async ([method, params]) => {
          const overlapping = !ready;
          const sent = performance.now();
          await client.request(method, params);
          if (overlapping)
            samples.push({ method, ms: performance.now() - sent });
        }),
      );
    try {
      await Promise.all([
        subscribing,
        (async () => {
          do {
            await readBatch();
          } while (!ready);
        })(),
      ]);
      const failure = watch.values.find((event) => event.ok === false);
      if (failure) throw new Error(`reading.watch: ${failure.error.code}`);
    } finally {
      await watch?.close();
    }
  }
  const summary = {
    durationMs: performance.now() - started,
    limitMs: 500,
    watchStarts: startups.length,
    watchStartupMaxMs: Math.max(...startups),
    methods: Object.fromEntries(
      Object.keys(requests).map((method) => {
        const values = samples
          .filter((sample) => sample.method === method)
          .map((sample) => sample.ms)
          .sort((a, b) => a - b);
        return [
          method,
          {
            count: values.length,
            p50Ms: values[Math.floor(values.length * 0.5)],
            p99Ms: values[Math.floor(values.length * 0.99)],
            maxMs: values.at(-1),
          },
        ];
      }),
    ),
  };
  await record(summary);
  for (const [method, values] of Object.entries(summary.methods)) {
    assert.ok(values.count > 0, `${method}: 監視開始と重なる要求がありません`);
    assert.ok(
      values.maxMs < 500,
      `${method}: ${values.maxMs.toFixed(0)}ms (目標500ms未満)`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const cleanups = [];
  const evidence = resolve(
    process.env.IORI_VERIFICATION_EVIDENCE_ROOT ??
      ".local/evidence/reading-load",
    `run-${Date.now()}`,
  );
  await mkdir(evidence, { recursive: true });
  console.log(`evidence=${evidence}`);
  try {
    const { client, dataRoot } = await startHostTest({
      after: (cleanup) => cleanups.push(cleanup),
      diagnostic: console.error,
    });
    const root = join(dataRoot, "repository");
    await mkdir(root);
    await symlink(
      execFileSync("which", ["git"], { encoding: "utf8" }).trim(),
      join(dataRoot, "bin", "git"),
    );
    const git = (...args) =>
      execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
    git("init", "-b", "main");
    await writeFile(join(root, "sample.txt"), "変更前の行\n");
    git("add", "sample.txt");
    git(
      "-c",
      "user.name=iori E2E",
      "-c",
      "user.email=e2e@example.invalid",
      "commit",
      "-m",
      "Create reading fixture",
    );
    await writeFile(join(root, "sample.txt"), "ブラウザーからファイルを読む\n");
    await prepareReadingTree(root);
    await readingLoad(client, root, async (summary) => {
      const json = JSON.stringify(summary, null, 2) + "\n";
      await writeFile(join(evidence, "result.json"), json);
      console.log(json);
    });
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
}
