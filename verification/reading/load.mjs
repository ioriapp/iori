import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

// Dedicated type-4 load test. Reuse the real browser/bridge/Host setup and its
// cleanup; ordinary E2E and CI never set this mode.
export async function readingLoad(screen, record) {
  const result = await screen.evaluate(`(async () => {
    const { native } = await import('/src/native.ts');
    const requests = window.readingRequests;
    const samples = [], startups = [];
    const started = performance.now();
    const reading = requests['files.info'];
    let watch;
    const stopEvents = await native.onStream(({subscriptionId,json}) => {
      if (!watch || subscriptionId !== watch.id) return;
      const event = JSON.parse(json);
      if (event.ok === false) watch.failure = event.error.code;
      else if (event.type === 'reading.changed' && !event.paths && !watch.ready) {
        watch.ready = true;
        startups.push(performance.now() - watch.started);
      }
    });
    const readBatch = () => Promise.all(['files.list', 'files.info', 'git.status'].map(async method => {
      const {connectionId, params} = requests[method];
      const overlapping = !watch.ready;
      const at = performance.now();
      const response = JSON.parse(await native.request(connectionId, JSON.stringify({kind:'request',operationId:crypto.randomUUID(),method,params})));
      if (!response.ok) throw new Error(method + ': ' + response.error.code);
      if (overlapping) samples.push({method,ms:performance.now()-at});
    }));
    try {
      while (performance.now() - started < 60000) {
        watch = {id:crypto.randomUUID(),started:performance.now(),ready:false};
        try {
          const subscribing = native.subscribe(reading.connectionId, JSON.stringify({kind:'subscribe',operationId:watch.id,method:'reading.watch',params:{root:reading.params.root,scope:'files'}}), watch.id);
          await Promise.all([subscribing, readBatch()]);
          while (!watch.ready && !watch.failure) await readBatch();
          if (watch.failure) throw new Error('reading.watch: ' + watch.failure);
        } finally {
          await native.cancelStream(watch.id);
        }
        if (watch.failure) throw new Error('reading.watch: ' + watch.failure);
      }
      return {durationMs:performance.now()-started, samples, startups};
    } finally {
      stopEvents();
    }
  })()`);
  const summary = {
    durationMs: result.durationMs,
    limitMs: 500,
    watchStarts: result.startups.length,
    watchStartupMaxMs: Math.max(...result.startups),
    methods: Object.fromEntries(
      ["files.list", "files.info", "git.status"].map((method) => {
        const values = result.samples
          .filter((s) => s.method === method)
          .map((s) => s.ms)
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
  await record(`読み取りの1分負荷試験: ${JSON.stringify(summary)}`);
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
  const child = spawn(
    process.execPath,
    ["verification/web/run.mjs", "--only=reading-responsiveness"],
    {
      stdio: "inherit",
      env: { ...process.env, IORI_READING_LOAD_TEST: "1" },
    },
  );
  child.once("error", (error) => {
    throw error;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
