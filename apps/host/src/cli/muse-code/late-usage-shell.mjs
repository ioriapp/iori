#!/usr/bin/env node
import { connect } from "node:net";
import { createInterface } from "node:readline";

const [port, kind] = process.argv.at(-1).split(" ");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const museUsage = (usedPercent) => ({
  window: { usedPercent, windowDurationMins: 300 },
  weekly: { usedPercent, resetsAtMs: Date.now() + 3_600_000 },
});
const codexUsage = (usedPercent) => ({
  rateLimits: {
    primary: {
      usedPercent,
      windowDurationMins: 300,
      resetsAt: Date.now() / 1000 + 3600,
    },
  },
});
createInterface({ input: process.stdin }).on("line", (line) => {
  const value = JSON.parse(line);
  if (value.id === 1) send({ id: 1, result: { experimentalApi: true } });
  else if (value.id === 2)
    send({
      id: 2,
      result: kind === "muse" ? { usage: museUsage(5) } : codexUsage(5),
    });
});
process.on("SIGTERM", () => {
  setTimeout(() => {
    send(
      kind === "muse"
        ? { method: "usage/changed", params: museUsage(10) }
        : { method: "account/rateLimits/updated", params: codexUsage(10) },
    );
    setTimeout(
      () =>
        connect(Number(port), "127.0.0.1", function () {
          this.end(() => process.exit(0));
        }),
      20,
    );
  }, 10);
});
