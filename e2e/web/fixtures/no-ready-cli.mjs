#!/usr/bin/env node
import { createInterface } from "node:readline";

if (process.argv.includes("--help") || process.argv.includes("--version")) {
  console.log("no-ready-cli 1.0.0");
} else {
  // A CLI that accepts plain input and emits neither hooks nor paste mode.
  process.stdin.setRawMode(true);
  const input = createInterface({ input: process.stdin, terminal: false });
  let requests = 0;
  input.on("line", (line) => {
    if (line.startsWith("[iori] Parent "))
      console.log(`INITIAL_INPUT_COUNT=${requests}`);
    else {
      requests++;
      console.log(`INITIAL_REQUEST_RECEIVED:${line}`);
    }
  });
  console.log("NO_READY_SCREEN");
}
