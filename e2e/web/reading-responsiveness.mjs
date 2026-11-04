import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";

// Observe the real watch stream's first full refresh, emitted after the Host
// has installed the recursive watcher. No product diagnostics or clock limit.
export async function readingResponsiveness({ screen, record, changeFile }) {
  await screen.evaluate(`(async () => {
    const { native } = await import('/src/native.ts');
    const original = WebSocket.prototype.send;
    const observed = new WeakSet();
    const requests = new Map();
    const watches = new Map();
    const probes = new Map();
    const sentAt = new WeakMap();
    let order = 0;
    window.readingTrace = [];
    window.readingRequests = {};
    WebSocket.prototype.send = function(data) {
      if (!observed.has(this)) {
        observed.add(this);
        this.addEventListener('message', ({data}) => {
          const response = JSON.parse(data);
          const request = requests.get(response.id);
          if (request) {
            requests.delete(response.id);
            request.completed = ++order;
            request.ms = performance.now() - sentAt.get(request);
            if (response.error) request.failure = response.error;
          }
          if (response.event === 'native://stream') {
            const event = JSON.parse(response.payload.json);
            const watch = watches.get(response.payload.subscriptionId);
            if (watch && event.ok === false) watch.failure = event.error.code;
            if (watch && !watch.ready && event.type === 'reading.changed' && !event.paths) {
              watch.ready = ++order;
              watch.ms = performance.now() - sentAt.get(watch);
            }
          }
        });
      }
      const message = JSON.parse(data);
      let startProbes;
      if (message.command === 'native_request' || message.command === 'native_subscribe') {
        const request = JSON.parse(message.args.json);
        if (request.method === 'reading.watch') {
          const watch = {scope:request.params.scope, started:++order};
          watches.set(request.operationId, watch);
          sentAt.set(watch, performance.now());
          window.readingTrace.push(watch);
          if (['files','git'].includes(request.params.scope)) startProbes = () => {
            const root = request.params.root;
            const reads = request.params.scope === 'git'
              ? [['git.status', {...window.readingRequests['git.status'].params, root}]]
              : [['files.list', {...window.readingRequests['files.list'].params, root, path:'inside'}], ['files.info', {root, path:'sample.txt'}]];
            for (const [method, params] of reads) {
              const operationId = crypto.randomUUID();
              probes.set(operationId, watch.started);
              void native.request(message.args.connectionId, JSON.stringify({kind:'request',operationId,method,params})).then(json => {
                const response = JSON.parse(json);
                if (!response.ok) watch.failure = response.error.code;
              }).catch(() => { watch.failure = '読み取りの通信が終了しました'; });
            }
          };
        } else if (/^(files|git)\\./.test(request.method)) {
          const entry = {method:request.method, started:++order, probeFor:probes.get(request.operationId)};
          probes.delete(request.operationId);
          sentAt.set(entry, performance.now());
          requests.set(message.id, entry);
          window.readingTrace.push(entry);
          window.readingRequests[request.method] = {connectionId:message.args.connectionId, params:request.params};
        }
      }
      const result = original.call(this, data);
      // Start real small reads alongside startup, before waiting for the UI.
      startProbes?.();
      return result;
    };
    return true;
  })()`);
  const check = async (phase, scope, methods, { initialScan = true } = {}) => {
    // The scan is work proportional to the tree; the outer runner bounds it.
    let trace;
    for (;;) {
      trace = await screen.evaluate("window.readingTrace");
      const latest = trace.findLast((entry) => entry.scope === scope);
      if (latest?.failure)
        throw new Error(`監視の開始に失敗しました: ${latest.failure}`);
      if (latest?.ready) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const watch = trace.findLast((entry) => entry.scope === scope);
    await record(`${phase}: ${JSON.stringify(trace)}`);
    for (const method of initialScan ? methods : [])
      assert.ok(
        trace.some(
          (entry) =>
            entry.method === method &&
            entry.probeFor === watch.started &&
            entry.completed < watch.ready,
        ),
        `${phase}: ${method}が監視の初回走査中に応答する`,
      );
    await screen.evaluate("window.readingTrace = []");
  };
  const body = () => screen.text('[data-iori-view="files"] .reading-body');
  const read = async (phase, open, options) => {
    await open();
    await screen.click('[data-iori-file="sample.txt"]');
    await waitFor(body, (text) =>
      text.includes("ブラウザーからファイルを読む"),
    );
    await screen.click('[data-iori-file="inside"]');
    await screen.wait('[data-iori-file="inside/small.txt"]');
    await check(phase, "files", ["files.list", "files.info"], options);
  };
  await read("Filesの初回に本文とフォルダー一覧を待たせない", () =>
    openWorkspaceView(screen, "files"),
  );
  // Changes after watching starts must reach the open file too.
  await changeFile("watch startup update\n");
  await waitFor(body, (text) => text.includes("watch startup update"));
  await changeFile("ブラウザーからファイルを読む\n");
  await waitFor(body, (text) => text.includes("ブラウザーからファイルを読む"));

  await openWorkspaceView(screen, "git");
  await screen.click(
    '[data-iori-action="git-change-select"][data-path="sample.txt"]',
  );
  await waitFor(
    () => screen.text('[data-iori-view="git"] [data-iori-scroll="git-diff"]'),
    (text) => text.includes("ブラウザーからファイルを読む"),
  );
  await check("Gitの初回に差分を待たせない", "git", ["git.status"]);
  // Collapse before switching away so returning can load a fresh folder page.
  await screen.click('button[data-iori-tab-kind="files"]');
  await screen.click('[data-iori-file="inside"]');
  await screen.click('button[data-iori-tab-kind="git"]');
  await read(
    "Filesへ戻った直後の本文と一覧を読む",
    () => screen.click('button[data-iori-tab-kind="files"]'),
    { initialScan: false },
  );
  if (process.env.IORI_READING_LOAD_TEST === "1") {
    const { readingLoad } = await import("../../verification/reading/load.mjs");
    await readingLoad(screen, record);
  }
}
